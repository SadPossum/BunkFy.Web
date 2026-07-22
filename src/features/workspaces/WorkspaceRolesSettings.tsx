import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, LockKeyhole, Pencil, Plus, ShieldCheck, UsersRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  WorkspaceAccessCatalogue,
  WorkspaceAccessProfile,
  WorkspaceAccessProfileListResponse,
} from "../../api/types";
import { useSession } from "../../app/session";
import { Modal, ModalActions, StatusBadge } from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { groupPermissions, updatePermissionSelection } from "./workspaceAccessPermissions";

const PROFILE_PAGE_SIZE = 25;

export function WorkspaceRolesSettings({ workspaceId }: { workspaceId: string }) {
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
            <h2 className="font-display text-xl font-semibold">Roles and permissions</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-base-content/55">
              Set operational access without changing workspace ownership.
            </p>
          </div>
        </div>
        <button className="btn btn-primary btn-sm shrink-0 text-white" onClick={() => setEditing("new")}>
          <Plus size={16} />New role
        </button>
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

      {catalogue.error && <SettingsError error={catalogue.error} />}
      {profiles.error && <SettingsError error={profiles.error} />}
      {(catalogue.isLoading || profiles.isLoading) && (
        <div className="loading loading-spinner loading-md mt-6 text-primary" />
      )}
      {!profiles.isLoading && !profiles.error && (
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
                {profile.status === 1 && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(profile)}>
                      <Pencil size={15} />Edit
                    </button>
                    {!profile.isSeed && (
                      <button
                        className="btn btn-ghost btn-sm text-error"
                        disabled={profile.assignmentCount > 0}
                        title={profile.assignmentCount > 0 ? "Move members to another role before archiving." : undefined}
                        onClick={() => setArchiveTarget(profile)}
                      >
                        <Archive size={15} />Archive
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          <PaginationBar
            page={page}
            pageSize={PROFILE_PAGE_SIZE}
            itemCount={profiles.data?.items.length ?? 0}
            itemLabel="role"
            hasMore={profiles.data?.hasMore}
            disabled={profiles.isFetching}
            onPageChange={setPage}
          />
        </>
      )}

      {editing && catalogue.data && (
        <ProfileEditor
          key={editing === "new" ? "new" : `${editing.profileId}-${editing.version}`}
          profile={editing === "new" ? null : editing}
          catalogue={catalogue.data}
          request={request}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ["workspace-access", workspaceId] });
          }}
        />
      )}

      {archiveTarget && (
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
  onClose,
  onSaved,
}: {
  profile: WorkspaceAccessProfile | null;
  catalogue: WorkspaceAccessCatalogue;
  request: ReturnType<typeof useSession>["request"];
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
    save.mutate();
  }

  return (
    <Modal
      open
      size="lg"
      title={profile ? `Edit ${profile.displayName}` : "New workspace role"}
      description="Permissions are constrained by your own access and the BunkFy product catalogue."
      onClose={onClose}
    >
      <form onSubmit={submit}>
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
        <div className="divide-y divide-base-300">
          {groups.map((group) => (
            <fieldset key={group.group} className="py-5">
              <legend className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-base-content/45">{group.group}</legend>
              <div className="grid gap-2 lg:grid-cols-2">
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
            </fieldset>
          ))}
        </div>

        {save.error && <SettingsError error={save.error} />}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary min-w-32 text-white" disabled={save.isPending || !displayName.trim()}>
            {save.isPending && <span className="loading loading-spinner loading-sm" />}
            {profile ? "Save role" : "Create role"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

function SettingsError({ error }: { error: unknown }) {
  return (
    <div className="alert alert-error mt-5 py-3 text-sm">
      {error instanceof Error ? error.message : "The request could not be completed."}
    </div>
  );
}
