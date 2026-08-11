import { useMutation, useQuery } from "@tanstack/react-query";
import { DatabaseZap, MailPlus, Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  Organization,
  OrganizationMemberListResponse,
  OrganizationMembership,
} from "../../api/types";
import { useSession } from "../../app/session";
import {
  permissions,
  tenantAccessScope,
  usePermissions,
} from "../../app/permissions";
import { useWorkspace } from "../../app/workspace";
import { PageHeader } from "../../components/ui/primitives";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { WorkspaceInvitesSettings } from "./WorkspaceInvitesSettings";
import { WorkspaceMembersSettings } from "./WorkspaceMembersSettings";
import { RetentionHealthSettings } from "./RetentionHealthSettings";
import { WorkspaceRolesSettings } from "./WorkspaceRolesSettings";
import {
  canOpenWorkspaceSettingsTab,
  resolveWorkspaceSettingsCapabilities,
  type WorkspaceSettingsTab,
} from "./workspaceSettingsAccess";
import {
  clearWorkspaceUpdateAttempt,
  resolveWorkspaceUpdateAttempt,
  type WorkspaceUpdateAttempt,
  type WorkspaceUpdatePayload,
} from "./workspaceUpdateAttempt";

const MEMBERS_PAGE_SIZE = 25;

export function WorkspaceSettingsPage() {
  const { request, session } = useSession();
  const {
    selectedWorkspace,
    properties,
    refetchWorkspaces,
  } = useWorkspace();
  const [tab, setTab] = useState<WorkspaceSettingsTab>("general");
  const [memberPage, setMemberPage] = useState(1);
  const workspace = selectedWorkspace?.organization;
  const owner = isOwner(selectedWorkspace?.membership.role);
  const tenantScope = session ? tenantAccessScope(session.tenantId) : "";
  const permissionAccess = usePermissions(session && !owner
    ? [
      { permission: permissions.accessProfilesRead, scope: tenantScope },
      { permission: permissions.accessProfilesManage, scope: tenantScope },
      { permission: permissions.staffManage, scope: tenantScope },
      { permission: permissions.retentionRead, scope: tenantScope },
    ]
    : []);
  const permissionsLoading = !owner && permissionAccess.isLoading;
  const capabilities = resolveWorkspaceSettingsCapabilities({
    owner,
    profilesRead: permissionAccess.allows(permissions.accessProfilesRead, tenantScope),
    profilesManage: permissionAccess.allows(permissions.accessProfilesManage, tenantScope),
    staffManage: permissionAccess.allows(permissions.staffManage, tenantScope),
    retentionRead: permissionAccess.allows(permissions.retentionRead, tenantScope),
  });
  const members = useQuery({
    queryKey: ["organizations", workspace?.organizationId, "members", memberPage],
    queryFn: () => request<OrganizationMemberListResponse>(
      `/api/organizations/${workspace?.organizationId}/members?page=${memberPage}&pageSize=${MEMBERS_PAGE_SIZE}`,
    ),
    enabled: Boolean(workspace && owner && tab === "members"),
  });

  useEffect(() => setMemberPage(1), [workspace?.organizationId]);
  useEffect(() => {
    if (!permissionsLoading && !canOpenWorkspaceSettingsTab(tab, capabilities)) {
      setTab("general");
    }
  }, [capabilities, permissionsLoading, tab]);
  useEffect(() => {
    if (!members.isFetching && memberPage > 1 && members.data?.items.length === 0) {
      setMemberPage((current) => Math.max(1, current - 1));
    }
  }, [memberPage, members.data?.items.length, members.isFetching]);

  if (!workspace || !selectedWorkspace) return null;

  async function refreshWorkspace() {
    if (owner) {
      await Promise.all([refetchWorkspaces(), members.refetch()]);
      return;
    }

    await refetchWorkspaces();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace settings"
        title={workspace.name}
        description={`Manage team access and workspace identity for ${workspace.slug}.`}
        action={(
          <span className={`badge h-8 gap-2 border-0 px-3 font-semibold text-white ${owner ? "bg-primary" : "bg-neutral"}`}>
            <ShieldCheck size={15} />
            {owner ? "Owner" : "Member"}
          </span>
        )}
      />

      <section className="card overflow-visible border border-base-300 bg-base-100 shadow-sm">
        <div className="border-b border-base-300 p-3 sm:px-5">
          <SegmentedTabs
            value={tab}
            ariaLabel="Workspace settings"
            onValueChange={setTab}
            options={[
              { value: "general", label: "General", icon: <Settings2 size={15} /> },
              { value: "members", label: "Members", icon: <UsersRound size={15} />, disabled: !capabilities.canReadMembers },
              { value: "roles", label: "Roles", icon: <ShieldCheck size={15} />, disabled: permissionsLoading || !capabilities.canReadRoles },
              { value: "invites", label: "Invites", icon: <MailPlus size={15} />, disabled: permissionsLoading || !capabilities.canManageInvites },
              {
                value: "retention",
                label: "Retention",
                icon: <DatabaseZap size={15} />,
                disabled: permissionsLoading || !capabilities.canReadRetention,
              },
            ]}
          />
        </div>

        <div className="p-5 sm:p-6">
          {tab === "general" && (
            <GeneralSettings
              key={workspace.organizationId}
              workspace={workspace}
              accountId={session?.subjectId ?? ""}
              canManage={owner}
              onSaved={refetchWorkspaces}
            />
          )}
          {tab === "members" && capabilities.canReadMembers && (
            <WorkspaceMembersSettings
              workspace={workspace}
              currentMembership={selectedWorkspace.membership}
              memberships={members.data?.items ?? []}
              currentUsername={session?.username ?? ""}
              properties={properties}
              page={memberPage}
              pageSize={MEMBERS_PAGE_SIZE}
              hasMore={members.data?.hasMore}
              loading={members.isLoading}
              fetching={members.isFetching}
              error={members.error}
              onChanged={refreshWorkspace}
              onPageChange={setMemberPage}
            />
          )}
          {tab === "roles" && capabilities.canReadRoles && (
            <WorkspaceRolesSettings
              workspaceId={workspace.organizationId}
              canManage={capabilities.canManageRoles}
            />
          )}
          {tab === "invites" && capabilities.canManageInvites && (
            <WorkspaceInvitesSettings
              key={workspace.organizationId}
              workspaceId={workspace.organizationId}
              properties={properties}
              onMembershipChanged={refreshWorkspace}
            />
          )}
          {tab === "retention" && capabilities.canReadRetention && <RetentionHealthSettings />}
        </div>
      </section>
    </div>
  );
}

function GeneralSettings({
  workspace,
  accountId,
  canManage,
  onSaved,
}: {
  workspace: Organization;
  accountId: string;
  canManage: boolean;
  onSaved: () => Promise<void>;
}) {
  const { request } = useSession();
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const updateAttempt = useRef<WorkspaceUpdateAttempt | null>(null);
  const update = useMutation({
    mutationFn: async () => {
      if (!accountId) throw new Error("You are signed out.");
      const payload: WorkspaceUpdatePayload = {
        organizationId: workspace.organizationId,
        expectedVersion: workspace.version,
        name,
        slug,
      };
      updateAttempt.current = await resolveWorkspaceUpdateAttempt(
        updateAttempt.current,
        accountId,
        payload,
      );
      const result = await request<Organization>(
        `/api/organizations/${workspace.organizationId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            operationId: updateAttempt.current.operationId,
            name: name.trim(),
            slug: slug.trim(),
            expectedVersion: workspace.version,
          }),
        },
      );
      await clearWorkspaceUpdateAttempt(accountId, workspace.organizationId);
      updateAttempt.current = null;
      return result;
    },
    onSuccess: async () => {
      await onSaved();
    },
  });
  return (
    <section className="max-w-3xl">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Settings2 size={20} />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold">Workspace details</h2>
          <p className="mt-1 text-sm leading-6 text-base-content/55">The name and handle shown throughout your team workspace.</p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="form-control block">
          <span className="mb-1.5 block text-sm font-semibold">Name</span>
          <input className="input input-bordered w-full" value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage} />
        </label>
        <label className="form-control block">
          <span className="mb-1.5 block text-sm font-semibold">Handle</span>
          <input className="input input-bordered w-full" value={slug} onChange={(event) => setSlug(event.target.value)} disabled={!canManage} />
        </label>
      </div>
      {!canManage && (
        <div className="mt-5 flex items-start gap-3 rounded-lg bg-base-200/70 p-4 text-sm text-base-content/60">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" />Workspace identity can only be changed by the owner.
        </div>
      )}
      {update.error && <SettingsError error={update.error} />}
      {canManage && (
        <div className="mt-5 flex justify-end border-t border-base-300 pt-5">
          <button className="btn btn-primary text-white" onClick={() => update.mutate()} disabled={update.isPending || !name.trim() || !slug.trim()}>
            {update.isPending && <span className="loading loading-spinner loading-sm" />}Save changes
          </button>
        </div>
      )}
    </section>
  );
}

function SettingsError({ error }: { error: unknown }) {
  return <div className="alert alert-error mt-5 py-3 text-sm">{error instanceof Error ? error.message : "The request could not be completed."}</div>;
}

function isOwner(role: OrganizationMembership["role"] | undefined): boolean {
  return role === "owner";
}
