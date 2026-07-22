import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type {
  Organization,
  OrganizationMembership,
  Property,
  WorkspaceAccessProfile,
  WorkspaceAccessProfileListResponse,
  WorkspaceMemberAccess,
} from "../../api/types";
import { useSession } from "../../app/session";
import { Modal, ModalActions } from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { AccessProfilePicker, PropertyScopeField } from "./WorkspaceAccessControls";

const ACTIVE_PROFILE_PAGE_SIZE = 100;

export function WorkspaceMembersSettings({
  workspace,
  currentMembership,
  memberships,
  currentUsername,
  properties,
  page,
  pageSize,
  loading,
  fetching,
  error,
  onChanged,
  onPageChange,
}: {
  workspace: Organization;
  currentMembership: OrganizationMembership;
  memberships: OrganizationMembership[];
  currentUsername: string;
  properties: Property[];
  page: number;
  pageSize: number;
  loading: boolean;
  fetching: boolean;
  error: unknown;
  onChanged: () => Promise<void>;
  onPageChange: (page: number) => void;
}) {
  const { request } = useSession();
  const [editing, setEditing] = useState<OrganizationMembership | null>(null);
  const profiles = useQuery({
    queryKey: ["workspace-access", workspace.organizationId, "active-profiles"],
    queryFn: () => request<WorkspaceAccessProfileListResponse>(
      `/api/workspace-access/profiles?includeArchived=false&page=1&pageSize=${ACTIVE_PROFILE_PAGE_SIZE}`,
    ),
  });
  const transfer = useMutation({
    mutationFn: (membership: OrganizationMembership) =>
      request(`/api/organizations/${workspace.organizationId}/ownership/transfer`, {
        method: "POST",
        body: JSON.stringify({
          targetSubjectId: membership.subjectId,
          expectedOrganizationVersion: workspace.version,
          expectedCurrentOwnerVersion: currentMembership.version,
          expectedTargetVersion: membership.version,
        }),
      }),
    onSuccess: onChanged,
  });

  if (loading) return <div className="loading loading-spinner loading-md text-primary" />;
  if (error) return <SettingsError error={error} />;

  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <UsersRound size={20} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold">Workspace members</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-base-content/55">
              Assign one operational role across the whole workspace or selected properties.
            </p>
          </div>
        </div>
        <Link className="btn btn-outline btn-sm shrink-0" to="/staff">
          <UsersRound size={15} />Open Staff directory
        </Link>
      </div>

      {profiles.data?.hasMore && (
        <div className="alert alert-warning mt-5 py-3 text-sm">
          This workspace has more than {ACTIVE_PROFILE_PAGE_SIZE} active roles. Archive unused roles before assigning access.
        </div>
      )}
      {profiles.error && <SettingsError error={profiles.error} />}
      <div className="mt-5 divide-y divide-base-300 border-y border-base-300">
        {!memberships.length && <p className="py-8 text-center text-sm text-base-content/50">No members on this page.</p>}
        {memberships.map((membership) => {
          const self = membership.membershipId === currentMembership.membershipId;
          const active = isActive(membership.status);
          const owner = isOwner(membership.role);
          const displayName = self ? "You" : `Member ${shortSubject(membership.subjectId)}`;
          const accountLabel = self ? currentUsername : "Workspace identity";
          return (
            <article key={membership.membershipId} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-semibold">{displayName}</p>
                <p className="mt-1 truncate text-xs text-base-content/45">{accountLabel}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {self && <span className="badge border-0 bg-primary font-semibold text-white">Current account</span>}
                <span className="badge badge-outline">{owner ? "Owner" : active ? "Member" : statusLabel(membership.status)}</span>
                {!owner && active && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEditing(membership)}
                    disabled={profiles.isLoading || profiles.data?.hasMore}
                  >
                    <Settings2 size={15} />Manage access
                  </button>
                )}
                {!self && active && !owner && (
                  <button className="btn btn-ghost btn-sm" onClick={() => transfer.mutate(membership)} disabled={transfer.isPending}>
                    <ShieldCheck size={15} />Make owner
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <PaginationBar
        page={page}
        pageSize={pageSize}
        itemCount={memberships.length}
        itemLabel="member"
        disabled={fetching}
        onPageChange={onPageChange}
      />
      {transfer.error && <SettingsError error={transfer.error} />}

      {editing && profiles.data && (
        <MemberAccessEditor
          key={`${editing.membershipId}-${editing.version}`}
          workspaceId={workspace.organizationId}
          membership={editing}
          profiles={profiles.data.items.filter((profile) => profile.status === 1)}
          properties={properties}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function MemberAccessEditor({
  workspaceId,
  membership,
  profiles,
  properties,
  onClose,
}: {
  workspaceId: string;
  membership: OrganizationMembership;
  profiles: WorkspaceAccessProfile[];
  properties: Property[];
  onClose: () => void;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const access = useQuery({
    queryKey: ["workspace-access", workspaceId, "member", membership.subjectId],
    queryFn: () => request<WorkspaceMemberAccess>(
      `/api/workspace-access/members/${encodeURIComponent(membership.subjectId)}/access`,
    ),
  });
  const [profileId, setProfileId] = useState("");
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const existingSelection = useMemo(() => access.data ? memberSelection(access.data) : null, [access.data]);

  useEffect(() => {
    if (!access.data) return;
    setProfileId(existingSelection?.profileId ?? profiles[0]?.profileId ?? "");
    setPropertyIds(existingSelection?.propertyIds ?? []);
  }, [access.data, existingSelection, profiles]);

  const update = useMutation({
    mutationFn: () => request<WorkspaceMemberAccess>(
      `/api/workspace-access/members/${encodeURIComponent(membership.subjectId)}/access`,
      {
        method: "PUT",
        body: JSON.stringify({ profileId, propertyIds }),
      },
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-access", workspaceId] });
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate();
  }

  return (
    <Modal
      open
      title={`Access for member ${shortSubject(membership.subjectId)}`}
      description="Saving replaces this member's operational assignment exactly. Workspace ownership is not affected."
      onClose={onClose}
    >
      {access.isLoading && <div className="loading loading-spinner loading-md text-primary" />}
      {access.error && <SettingsError error={access.error} />}
      {access.data && (
        <form className="space-y-6" onSubmit={submit}>
          {new Set(access.data.assignments.map((assignment) => assignment.profileId)).size > 1 && (
            <div className="alert alert-warning py-3 text-sm">
              This member has multiple legacy role assignments. Saving will replace them with the single role below.
            </div>
          )}
          <AccessProfilePicker profiles={profiles} value={profileId} onValueChange={setProfileId} />
          <PropertyScopeField properties={properties} propertyIds={propertyIds} onChange={setPropertyIds} />
          {update.error && <SettingsError error={update.error} />}
          <ModalActions>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary min-w-32 text-white" disabled={update.isPending || !profileId}>
              {update.isPending && <span className="loading loading-spinner loading-sm" />}
              Save access
            </button>
          </ModalActions>
        </form>
      )}
    </Modal>
  );
}

function memberSelection(access: WorkspaceMemberAccess): { profileId: string; propertyIds: string[] } | null {
  const first = access.assignments[0];
  if (!first) return null;
  const wholeWorkspace = access.assignments.some((assignment) => assignment.propertyId == null);
  return {
    profileId: first.profileId,
    propertyIds: wholeWorkspace
      ? []
      : [...new Set(access.assignments.flatMap((assignment) => assignment.propertyId ? [assignment.propertyId] : []))],
  };
}

function SettingsError({ error }: { error: unknown }) {
  return (
    <div className="alert alert-error mt-5 py-3 text-sm">
      {error instanceof Error ? error.message : "The request could not be completed."}
    </div>
  );
}

function isOwner(role: OrganizationMembership["role"] | undefined): boolean {
  return role === 2 || String(role).toLowerCase() === "owner";
}

function isActive(status: OrganizationMembership["status"]): boolean {
  return status === 1 || String(status).toLowerCase() === "active";
}

function statusLabel(status: OrganizationMembership["status"]): string {
  return status === 2 || String(status).toLowerCase() === "suspended" ? "Suspended" : "Removed";
}

function shortSubject(subjectId: string): string {
  return subjectId.length <= 8 ? subjectId : subjectId.slice(0, 8);
}
