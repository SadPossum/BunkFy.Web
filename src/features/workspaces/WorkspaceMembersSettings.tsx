import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type {
  Organization,
  OrganizationMembership,
  Property,
  StaffAccountDirectoryEntry,
  WorkspaceAccessProfile,
  WorkspaceAccessProfileListResponse,
  WorkspaceMemberAccess,
} from "../../api/types";
import { staffStatusLabel } from "../../api/labels";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { ErrorState, InitialAvatar, Modal, ModalActions, StatusBadge } from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { AccessProfilePicker, PropertyScopeField } from "./WorkspaceAccessControls";
import { workspaceAccessSourcesCurrent } from "./workspaceAccessAuthority";

const ACTIVE_PROFILE_PAGE_SIZE = 100;

type MemberAccessSelection = {
  profileId: string;
  propertyIds: string[];
};

export function WorkspaceMembersSettings({
  workspace,
  currentMembership,
  memberships,
  currentUsername,
  properties,
  propertySource,
  memberSource,
  accountDirectorySource,
  staffDirectory,
  authorityCurrent,
  page,
  pageSize,
  hasMore,
  onChanged,
  onPageChange,
}: {
  workspace: Organization;
  currentMembership: OrganizationMembership;
  memberships: OrganizationMembership[];
  currentUsername: string;
  properties: Property[];
  propertySource: CompositeSource;
  memberSource: CompositeSource;
  accountDirectorySource: CompositeSource | null;
  staffDirectory: StaffAccountDirectoryEntry[];
  authorityCurrent: boolean;
  page: number;
  pageSize: number;
  hasMore: boolean | undefined;
  onChanged: () => Promise<void>;
  onPageChange: (page: number) => void;
}) {
  const { request } = useSession();
  const [editing, setEditing] = useState<OrganizationMembership | null>(null);
  const [transferTargetSubjectId, setTransferTargetSubjectId] = useState<string | null>(null);
  const transferTarget = memberships.find(
    (membership) => membership.subjectId === transferTargetSubjectId,
  ) ?? null;
  const staffBySubject = useMemo(
    () => new Map(staffDirectory.map((staff) => [staff.authSubjectId, staff])),
    [staffDirectory],
  );
  const transferTargetStaff = transferTarget
    ? staffBySubject.get(transferTarget.subjectId)
    : undefined;
  const profiles = useQuery({
    queryKey: ["workspace-access", workspace.organizationId, "active-profiles"],
    queryFn: () => request<WorkspaceAccessProfileListResponse>(
      `/api/workspace-access/profiles?includeArchived=false&page=1&pageSize=${ACTIVE_PROFILE_PAGE_SIZE}`,
    ),
  });
  const profileSource = createCompositeSource({
    label: "Active roles",
    hasData: profiles.data !== undefined,
    isLoading: profiles.isLoading,
    error: profiles.error,
    isFetching: profiles.isFetching,
    refetch: () => profiles.refetch(),
  });
  const membersUsable = compositeSourceUsable(memberSource.state);
  const profilesUsable = compositeSourceUsable(profileSource.state);
  const membersCurrent = compositeSourceCurrent(memberSource);
  const accessDirectoriesCurrent = authorityCurrent && workspaceAccessSourcesCurrent([
    memberSource,
    profileSource,
    propertySource,
  ]) && !profiles.data?.hasMore;
  const transferAuthorityCurrent = authorityCurrent && membersCurrent;
  const transfer = useMutation({
    mutationFn: (membership: OrganizationMembership) => {
      if (!transferAuthorityCurrent) {
        throw new Error("Refresh workspace and member data before transferring ownership.");
      }
      return request(`/api/organizations/${workspace.organizationId}/ownership/transfer`, {
        method: "POST",
        body: JSON.stringify({
          targetSubjectId: membership.subjectId,
          expectedOrganizationVersion: workspace.version,
          expectedCurrentOwnerVersion: currentMembership.version,
          expectedTargetVersion: membership.version,
        }),
      });
    },
    onSuccess: async () => {
      await onChanged();
      setTransferTargetSubjectId(null);
    },
    onError: async () => {
      await onChanged();
    },
  });

  useEffect(() => {
    if (!transferTargetSubjectId) return;

    const refreshedTarget = memberships.find(
      (membership) => membership.subjectId === transferTargetSubjectId,
    );
    if (refreshedTarget && isOwner(refreshedTarget.role) && !isOwner(currentMembership.role)) {
      setTransferTargetSubjectId(null);
    }
  }, [currentMembership.role, memberships, transferTargetSubjectId]);

  function closeTransferConfirmation() {
    if (transfer.isPending) return;
    setTransferTargetSubjectId(null);
    transfer.reset();
  }

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
              Membership controls workspace governance. Staff employment and operational access stay separate.
            </p>
          </div>
        </div>
        <Link className="btn btn-outline btn-sm shrink-0" to="/staff">
          <UsersRound size={15} />Open Staff directory
        </Link>
      </div>

      <div className="mt-5">
        <CompositeSourceNotice
          sources={[
            memberSource,
            profileSource,
            propertySource,
            ...(accountDirectorySource ? [accountDirectorySource] : []),
          ]}
          title="Some member context is delayed"
        />
      </div>
      {profilesUsable && profiles.data?.hasMore && (
        <div className="alert alert-warning mt-5 py-3 text-sm">
          This workspace has more than {ACTIVE_PROFILE_PAGE_SIZE} active roles. Archive unused roles before assigning access.
        </div>
      )}
      {membersUsable ? (
        <>
          <div className="mt-5 divide-y divide-base-300 border-y border-base-300">
            {!memberships.length && <p className="py-8 text-center text-sm text-base-content/50">No members on this page.</p>}
            {memberships.map((membership) => {
              const self = membership.membershipId === currentMembership.membershipId;
              const active = isActive(membership.status);
              const owner = isOwner(membership.role);
              const staff = staffBySubject.get(membership.subjectId);
              const displayName = staff?.displayName ?? (self ? currentUsername : "Workspace member");
              const accountLabel = staff?.jobTitle ?? (staff ? "Staff profile" : "No linked Staff profile");
              return (
                <article key={membership.membershipId} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <InitialAvatar name={displayName} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">{displayName}</p>
                        {self && <span className="badge border-0 bg-primary font-semibold text-white">You</span>}
                      </div>
                      <p className="mt-1 truncate text-xs text-base-content/45">{accountLabel}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-outline">{owner ? "Owner" : active ? "Member" : statusLabel(membership.status)}</span>
                    {staff && <StatusBadge status={staffStatusLabel(staff.status)} />}
                    {staff && (
                      <Link
                        className="btn btn-ghost btn-sm"
                        to={`/staff?member=${encodeURIComponent(staff.staffMemberId)}`}
                      >
                        <ExternalLink size={15} />Staff profile
                      </Link>
                    )}
                    {!owner && active && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditing(membership)}
                        disabled={!accessDirectoriesCurrent}
                        title={!accessDirectoriesCurrent ? "Refresh members, roles, and properties before changing access." : undefined}
                      >
                        <Settings2 size={15} />Manage access
                      </button>
                    )}
                    {!self && active && !owner && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          transfer.reset();
                          setTransferTargetSubjectId(membership.subjectId);
                        }}
                        disabled={transfer.isPending || !transferAuthorityCurrent}
                      >
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
            hasMore={hasMore}
            disabled={!membersCurrent}
            onPageChange={onPageChange}
          />
        </>
      ) : (
        <CompositeSourceFallback state={memberSource.state} label="workspace members" />
      )}
      {editing && profilesUsable && profiles.data && (
        <MemberAccessEditor
          key={`${editing.membershipId}-${editing.version}`}
          workspaceId={workspace.organizationId}
          membership={editing}
          memberLabel={staffBySubject.get(editing.subjectId)?.displayName ?? "workspace member"}
          profiles={profiles.data.items.filter((profile) => profile.status === 1)}
          properties={properties}
          authorityCurrent={accessDirectoriesCurrent}
          authoritySources={[memberSource, profileSource, propertySource]}
          onClose={() => setEditing(null)}
        />
      )}

      {transferTarget && (
        <Modal
          open
          title={`Transfer ownership to ${transferTargetStaff?.displayName ?? "this member"}?`}
          description="This transfers the single workspace owner role. Operational roles and Staff employment are not changed."
          onClose={closeTransferConfirmation}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div className="rounded-lg border border-base-300 bg-base-200/55 p-4">
              <p className="text-xs font-bold uppercase text-base-content/45">Current account</p>
              <p className="mt-2 font-semibold">{currentUsername}</p>
              <p className="mt-1 text-sm text-base-content/55">Owner to member</p>
            </div>
            <ArrowRight className="mx-auto rotate-90 text-primary sm:rotate-0" size={20} />
            <div className="rounded-lg border border-primary/25 bg-primary/8 p-4">
              <p className="text-xs font-bold uppercase text-primary">New owner</p>
              <p className="mt-2 font-semibold">{transferTargetStaff?.displayName ?? "Workspace member"}</p>
              <p className="mt-1 text-sm text-base-content/55">Member to owner</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-base-content/65">
            You will lose owner-only workspace controls immediately. The new owner can manage members,
            invitations, roles, retention settings, and future ownership changes.
          </p>
          {!transferAuthorityCurrent && (
            <div className="alert alert-warning mt-4 py-3 text-sm">
              Refresh workspace and member data before confirming this ownership change.
            </div>
          )}
          {transfer.error && <SettingsError error={transfer.error} />}
          <ModalActions>
            <button type="button" className="btn btn-ghost" onClick={closeTransferConfirmation} disabled={transfer.isPending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary min-w-36 text-white"
              onClick={() => transfer.mutate(transferTarget)}
              disabled={transfer.isPending || !transferAuthorityCurrent}
            >
              {transfer.isPending && <span className="loading loading-spinner loading-sm" />}
              Transfer ownership
            </button>
          </ModalActions>
        </Modal>
      )}
    </section>
  );
}

function MemberAccessEditor({
  workspaceId,
  membership,
  memberLabel,
  profiles,
  properties,
  authorityCurrent,
  authoritySources,
  onClose,
}: {
  workspaceId: string;
  membership: OrganizationMembership;
  memberLabel: string;
  profiles: WorkspaceAccessProfile[];
  properties: Property[];
  authorityCurrent: boolean;
  authoritySources: CompositeSource[];
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
  const accessSource = createCompositeSource({
    label: "Member access",
    hasData: access.data !== undefined,
    isLoading: access.isLoading,
    error: access.error,
    isFetching: access.isFetching,
    refetch: () => access.refetch(),
  });
  const accessUsable = compositeSourceUsable(accessSource.state);
  const canSave = authorityCurrent && compositeSourceCurrent(accessSource);
  const initialSelection = access.data
    ? editableMemberSelection(access.data, profiles)
    : null;

  const update = useMutation({
    mutationFn: (selection: MemberAccessSelection) => {
      if (!canSave) {
        throw new Error("Refresh member access, roles, and properties before saving.");
      }
      return request<WorkspaceMemberAccess>(
        `/api/workspace-access/members/${encodeURIComponent(membership.subjectId)}/access`,
        {
          method: "PUT",
          body: JSON.stringify(selection),
        },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-access", workspaceId] });
      onClose();
    },
  });

  return (
    <Modal
      open
      title={`Access for ${memberLabel}`}
      description="Saving replaces this member's operational assignment exactly. Workspace ownership is not affected."
      onClose={onClose}
    >
      <CompositeSourceNotice
        sources={[...authoritySources, accessSource]}
        title="Some assignment data is delayed"
      />
      {accessUsable && access.data && initialSelection ? (
        <MemberAccessEditorForm
          key={memberAccessSnapshotKey(access.data, initialSelection)}
          access={access.data}
          initialSelection={initialSelection}
          profiles={profiles}
          properties={properties}
          canSave={canSave}
          submitting={update.isPending}
          error={update.error}
          onClose={onClose}
          onSubmit={(selection) => update.mutate(selection)}
        />
      ) : (
        <CompositeSourceFallback state={accessSource.state} label="member access" />
      )}
    </Modal>
  );
}

function MemberAccessEditorForm({
  access,
  initialSelection,
  profiles,
  properties,
  canSave,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  access: WorkspaceMemberAccess;
  initialSelection: MemberAccessSelection;
  profiles: WorkspaceAccessProfile[];
  properties: Property[];
  canSave: boolean;
  submitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (selection: MemberAccessSelection) => void;
}) {
  const [selection, setSelection] = useState(initialSelection);
  const pendingSelection = useRef(initialSelection);

  function replaceSelection(nextSelection: MemberAccessSelection) {
    pendingSelection.current = nextSelection;
    setSelection(nextSelection);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    onSubmit({
      profileId: pendingSelection.current.profileId,
      propertyIds: [...pendingSelection.current.propertyIds],
    });
  }

  return (
    <form className="space-y-6" onSubmit={submit}>
      {new Set(access.assignments.map((assignment) => assignment.profileId)).size > 1 && (
        <div className="alert alert-warning py-3 text-sm">
          This member has multiple legacy role assignments. Saving will replace them with the single role below.
        </div>
      )}
      <AccessProfilePicker
        profiles={profiles}
        value={selection.profileId}
        onValueChange={(profileId) => replaceSelection({
          ...pendingSelection.current,
          profileId,
        })}
        disabled={!canSave}
      />
      <PropertyScopeField
        properties={properties}
        propertyIds={selection.propertyIds}
        onChange={(propertyIds) => replaceSelection({
          ...pendingSelection.current,
          propertyIds,
        })}
        disabled={!canSave}
      />
      {error != null && <SettingsError error={error} />}
      <ModalActions>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button
          type="submit"
          className="btn btn-primary min-w-32 text-white"
          disabled={submitting || !selection.profileId || !canSave}
        >
          {submitting && <span className="loading loading-spinner loading-sm" />}
          Save access
        </button>
      </ModalActions>
    </form>
  );
}

function editableMemberSelection(
  access: WorkspaceMemberAccess,
  profiles: WorkspaceAccessProfile[],
): MemberAccessSelection {
  const existing = memberSelection(access);
  const existingProfileAvailable = profiles.some(
    (profile) => profile.profileId === existing?.profileId,
  );
  return {
    profileId: existingProfileAvailable
      ? existing?.profileId ?? ""
      : profiles[0]?.profileId ?? "",
    propertyIds: existing?.propertyIds ?? [],
  };
}

function memberAccessSnapshotKey(
  access: WorkspaceMemberAccess,
  selection: MemberAccessSelection,
): string {
  const assignments = access.assignments
    .map((assignment) => `${assignment.profileId}:${assignment.profileVersion}:${assignment.propertyId ?? "*"}`)
    .sort()
    .join("|");
  return `${selection.profileId}:${assignments}`;
}

function memberSelection(access: WorkspaceMemberAccess): MemberAccessSelection | null {
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
  return <div className="mt-5"><ErrorState error={error} /></div>;
}

function isOwner(role: OrganizationMembership["role"] | undefined): boolean {
  return role === "owner";
}

function isActive(status: OrganizationMembership["status"]): boolean {
  return status === "active";
}

function statusLabel(status: OrganizationMembership["status"]): string {
  return status === "suspended" ? "Suspended" : "Removed";
}
