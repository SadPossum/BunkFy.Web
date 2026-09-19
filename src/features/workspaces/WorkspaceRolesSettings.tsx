import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronDown, Eye, LockKeyhole, Pencil, Plus, ShieldCheck, UsersRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  WorkspaceAccessCatalogue,
  WorkspaceAccessProfile,
  WorkspaceAccessProfileListResponse,
} from "../../api/types";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
} from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { ErrorState, Modal, ModalActions, StatusBadge } from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { groupPermissions, updatePermissionSelection } from "./workspaceAccessPermissions";

const PROFILE_PAGE_SIZE = 25;

export function WorkspaceRolesSettings({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<WorkspaceAccessProfile | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<WorkspaceAccessProfile | null>(null);
  const catalogue = useQuery({
    queryKey: ["workspace-access", workspaceId, "catalogue"],
    queryFn: () => request<WorkspaceAccessCatalogue>("/api/workspace-access/catalogue"),
  });
  const profiles = useQuery({
    queryKey: ["workspace-access", workspaceId, "profiles", includeArchived, page, PROFILE_PAGE_SIZE],
    queryFn: () => request<WorkspaceAccessProfileListResponse>(
      `/api/workspace-access/profiles?includeArchived=${includeArchived}&page=${page}&pageSize=${PROFILE_PAGE_SIZE}`,
    ),
  });
  const catalogueSource = createCompositeSource({
    label: "Permission catalogue",
    hasData: catalogue.data !== undefined,
    isLoading: catalogue.isLoading,
    error: catalogue.error,
    isFetching: catalogue.isFetching,
    refetch: () => catalogue.refetch(),
  });
  const profileSource = createCompositeSource({
    label: "Workspace roles",
    hasData: profiles.data !== undefined,
    isLoading: profiles.isLoading,
    error: profiles.error,
    isFetching: profiles.isFetching,
    refetch: () => profiles.refetch(),
  });
  const catalogueCurrent = compositeSourceCurrent(catalogueSource);
  const profilesCurrent = compositeSourceCurrent(profileSource);
  const profilesUsable = compositeSourceUsable(profileSource.state);
  const archiveProfile = useMutation({
    mutationFn: (profile: WorkspaceAccessProfile) => request<void>(
      `/api/workspace-access/profiles/${profile.profileId}/archive`,
      { method: "POST", body: JSON.stringify({ expectedVersion: profile.version }) },
    ),
    onSuccess: async () => {
      setArchiveTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["workspace-access", workspaceId] });
    },
  });

  useEffect(() => setPage(1), [includeArchived, workspaceId]);
  useEffect(() => {
    if (!catalogueCurrent || !profilesCurrent || (!canManage && editing === "new")) {
      setEditing(null);
    }
    if (!canManage || !profilesCurrent) {
      setArchiveTarget(null);
    }
  }, [canManage, catalogueCurrent, editing, profilesCurrent]);
  useEffect(() => {
    if (!profiles.isFetching && page > 1 && profiles.data?.items.length === 0) {
      setPage((current) => Math.max(1, current - 1));
    }
  }, [page, profiles.data?.items.length, profiles.isFetching]);

  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold">Access roles</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-base-content/55">
              Set operational access without changing workspace ownership.
            </p>
          </div>
        </div>
        {canManage && (
          <button
            className="btn btn-primary btn-sm shrink-0 text-white"
            disabled={!catalogueCurrent || !profilesCurrent}
            title={!catalogueCurrent || !profilesCurrent ? "Refresh roles and permissions before creating access." : undefined}
            onClick={() => setEditing("new")}
          >
            <Plus size={16} />New role
          </button>
        )}
      </div>

      <label className="mt-5 flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="toggle toggle-primary toggle-sm"
          checked={includeArchived}
          onChange={(event) => setIncludeArchived(event.target.checked)}
        />
        Show archived
      </label>

      <div className="mt-5">
        <CompositeSourceNotice
          sources={[catalogueSource, profileSource]}
          title="Some role data is delayed"
        />
      </div>
      {profilesUsable ? (
        <>
          <div className="mt-5 divide-y divide-base-300 border-y border-base-300">
            {!profiles.data?.items.length && (
              <p className="py-10 text-center text-sm text-base-content/50">No roles on this page.</p>
            )}
            {(profiles.data?.items ?? []).map((profile) => (
              <article key={profile.profileId} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{profile.displayName}</h3>
                    {profile.isSeed && <span className="badge badge-outline badge-sm">Built in</span>}
                    {profile.status === 2 && <StatusBadge status="archived" />}
                  </div>
                  <p className="mt-1 max-w-3xl text-sm text-base-content/55">{profile.description || "No description"}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/45">
                    <span>{profile.permissions.length} permission{profile.permissions.length === 1 ? "" : "s"}</span>
                    <span className="inline-flex items-center gap-1"><UsersRound size={13} />{profile.assignmentCount} assignment{profile.assignmentCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!catalogueCurrent || !profilesCurrent}
                    title={!catalogueCurrent || !profilesCurrent ? "Refresh roles and permissions before opening this role." : undefined}
                    onClick={() => setEditing(profile)}
                  >
                    {profile.isSeed || !canManage || profile.status !== 1
                      ? <><Eye size={15} />View</>
                      : <><Pencil size={15} />Edit</>}
                  </button>
                  {canManage && profile.status === 1 && !profile.isSeed && (
                      <button
                        className="btn btn-ghost btn-sm text-error"
                        disabled={profile.assignmentCount > 0 || !profilesCurrent}
                        title={profile.assignmentCount > 0
                          ? "Move members to another role before archiving."
                          : !profilesCurrent
                            ? "Refresh roles before archiving."
                            : undefined}
                        onClick={() => setArchiveTarget(profile)}
                      >
                        <Archive size={15} />Archive
                      </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          <PaginationBar
            page={page}
            pageSize={PROFILE_PAGE_SIZE}
            itemCount={profiles.data?.items.length ?? 0}
            itemLabel="role"
            hasMore={profiles.data?.hasMore}
            disabled={!profilesCurrent}
            onPageChange={setPage}
          />
        </>
      ) : (
        <CompositeSourceFallback state={profileSource.state} label="workspace roles" />
      )}

      {editing && catalogue.data && catalogueCurrent && profilesCurrent && (
        <ProfileEditor
          key={editing === "new" ? "new" : `${editing.profileId}-${editing.version}`}
          profile={editing === "new" ? null : editing}
          catalogue={catalogue.data}
          request={request}
          readOnly={editing !== "new" && (editing.isSeed || !canManage || editing.status !== 1)}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ["workspace-access", workspaceId] });
          }}
        />
      )}

      {canManage && archiveTarget && profilesCurrent && (
        <Modal
          open
          title={`Archive ${archiveTarget.displayName}?`}
          description="Archived roles cannot be assigned to new members. Existing assignments must be moved first."
          onClose={() => setArchiveTarget(null)}
        >
          {archiveProfile.error && <SettingsError error={archiveProfile.error} />}
          <ModalActions>
            <button className="btn btn-ghost" onClick={() => setArchiveTarget(null)}>Cancel</button>
            <button
              className="btn btn-error text-white"
              disabled={archiveProfile.isPending}
              onClick={() => archiveProfile.mutate(archiveTarget)}
            >
              {archiveProfile.isPending && <span className="loading loading-spinner loading-sm" />}
              Archive role
            </button>
          </ModalActions>
        </Modal>
      )}
    </section>
  );
}

function ProfileEditor({
  profile,
  catalogue,
  request,
  readOnly,
  onClose,
  onSaved,
}: {
  profile: WorkspaceAccessProfile | null;
  catalogue: WorkspaceAccessCatalogue;
  request: ReturnType<typeof useSession>["request"];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [selectedPermissions, setSelectedPermissions] = useState(profile?.permissions ?? []);
  const [requestId] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: () => profile
      ? request<WorkspaceAccessProfile>(`/api/workspace-access/profiles/${profile.profileId}`, {
        method: "PUT",
        body: JSON.stringify({
          displayName: displayName.trim(),
          description: description.trim(),
          permissions: selectedPermissions,
          expectedVersion: profile.version,
        }),
      })
      : request<WorkspaceAccessProfile>("/api/workspace-access/profiles", {
        method: "POST",
        body: JSON.stringify({
          requestId,
          displayName: displayName.trim(),
          description: description.trim(),
          permissions: selectedPermissions,
        }),
      }),
    onSuccess: onSaved,
  });
  const groups = groupPermissions(catalogue.permissions);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    save.mutate();
  }

  return (
    <Modal
      open
      size="lg"
      title={profile ? (readOnly ? profile.displayName : `Edit ${profile.displayName}`) : "New workspace role"}
      description={readOnly
        ? "Review the permissions this role grants. Built-in roles are protected by BunkFy."
        : "Permissions are constrained by your own access and the BunkFy product catalogue."}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {readOnly && profile?.isSeed && (
          <div className="mb-5 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/8 p-4 text-sm text-base-content/65">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" />
            Built-in roles cannot be edited or archived. Create a custom role when this permission set does not fit.
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="form-control block">
            <span className="mb-1.5 block text-sm font-semibold">Role name</span>
            <input
              className="input input-bordered w-full"
              value={displayName}
              maxLength={100}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Night manager"
              autoFocus
              disabled={readOnly}
            />
          </label>
          <label className="form-control block">
            <span className="mb-1.5 block text-sm font-semibold">Description</span>
            <input
              className="input input-bordered w-full"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this role is for"
              disabled={readOnly}
            />
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 border-b border-base-300 pb-3">
          <div>
            <h3 className="font-semibold">Permissions</h3>
            <p className="mt-0.5 text-xs text-base-content/50">Required permissions are selected automatically.</p>
          </div>
          <span className="badge badge-outline shrink-0">{selectedPermissions.length} selected</span>
        </div>
        <div className="mt-4 space-y-2">
          {groups.map((group) => {
            const selectedCount = group.permissions.filter((permission) =>
              selectedPermissions.includes(permission.code)).length;
            return (
            <details key={group.group} className="group overflow-hidden rounded-lg border border-base-300 bg-base-100" open={selectedCount > 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-base-200/65">
                <span>
                  <span className="block text-sm font-semibold">{group.group}</span>
                  <span className="mt-0.5 block text-xs text-base-content/45">
                    {selectedCount} of {group.permissions.length} selected
                  </span>
                </span>
                <ChevronDown size={17} className="shrink-0 text-base-content/45 transition group-open:rotate-180" />
              </summary>
              <div className="grid gap-2 border-t border-base-300 p-3 lg:grid-cols-2">
                {group.permissions.map((permission) => {
                  const checked = selectedPermissions.includes(permission.code);
                  return (
                    <label
                      key={permission.code}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${checked ? "border-primary/45 bg-primary/5" : "border-base-300 hover:border-primary/25"}`}
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-primary checkbox-sm mt-0.5"
                        checked={checked}
                        disabled={readOnly}
                        onChange={(event) => setSelectedPermissions((current) => updatePermissionSelection(
                          current,
                          permission.code,
                          event.target.checked,
                          catalogue.permissions,
                        ))}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          {permission.label}
                          {permission.isSensitive && (
                            <span className="badge badge-sm border-0 bg-warning-content text-white"><LockKeyhole size={11} />Sensitive</span>
                          )}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-base-content/50">{permission.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </details>
            );
          })}
        </div>

        {save.error && <SettingsError error={save.error} />}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{readOnly ? "Close" : "Cancel"}</button>
          {!readOnly && (
            <button type="submit" className="btn btn-primary min-w-32 text-white" disabled={save.isPending || !displayName.trim()}>
              {save.isPending && <span className="loading loading-spinner loading-sm" />}
              {profile ? "Save role" : "Create role"}
            </button>
          )}
        </ModalActions>
      </form>
    </Modal>
  );
}

function SettingsError({ error }: { error: unknown }) {
  return <div className="mt-5"><ErrorState error={error} /></div>;
}
