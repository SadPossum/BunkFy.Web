import { useMutation, useQuery } from "@tanstack/react-query";
import { MailPlus, Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  Organization,
  OrganizationMemberListResponse,
  OrganizationMembership,
} from "../../api/types";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { PageHeader } from "../../components/ui/primitives";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { WorkspaceInvitesSettings } from "./WorkspaceInvitesSettings";
import { WorkspaceMembersSettings } from "./WorkspaceMembersSettings";
import { WorkspaceRolesSettings } from "./WorkspaceRolesSettings";

const MEMBERS_PAGE_SIZE = 25;

export function WorkspaceSettingsPage() {
  const { request, session } = useSession();
  const {
    selectedWorkspace,
    properties,
    refetchWorkspaces,
  } = useWorkspace();
  const [tab, setTab] = useState<"general" | "members" | "roles" | "invites">("general");
  const [memberPage, setMemberPage] = useState(1);
  const workspace = selectedWorkspace?.organization;
  const owner = isOwner(selectedWorkspace?.membership.role);
  const members = useQuery({
    queryKey: ["organizations", workspace?.organizationId, "members", memberPage],
    queryFn: () => request<OrganizationMemberListResponse>(
      `/api/organizations/${workspace?.organizationId}/members?page=${memberPage}&pageSize=${MEMBERS_PAGE_SIZE}`,
    ),
    enabled: Boolean(workspace && owner && tab === "members"),
  });

  useEffect(() => setMemberPage(1), [workspace?.organizationId]);
  useEffect(() => {
    if (!members.isFetching && memberPage > 1 && members.data?.items.length === 0) {
      setMemberPage((current) => Math.max(1, current - 1));
    }
  }, [memberPage, members.data?.items.length, members.isFetching]);

  if (!workspace || !selectedWorkspace) return null;

  async function refreshWorkspace() {
    await Promise.all([refetchWorkspaces(), members.refetch()]);
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
              { value: "members", label: "Members", icon: <UsersRound size={15} />, disabled: !owner },
              { value: "roles", label: "Roles", icon: <ShieldCheck size={15} />, disabled: !owner },
              { value: "invites", label: "Invites", icon: <MailPlus size={15} />, disabled: !owner },
            ]}
          />
        </div>

        <div className="p-5 sm:p-6">
          {tab === "general" && (
            <GeneralSettings
              key={workspace.organizationId}
              workspace={workspace}
              canManage={owner}
              onSaved={refetchWorkspaces}
            />
          )}
          {tab === "members" && owner && (
            <WorkspaceMembersSettings
              workspace={workspace}
              currentMembership={selectedWorkspace.membership}
              memberships={members.data?.items ?? []}
              currentUsername={session?.username ?? ""}
              properties={properties}
              page={memberPage}
              pageSize={MEMBERS_PAGE_SIZE}
              loading={members.isLoading}
              fetching={members.isFetching}
              error={members.error}
              onChanged={refreshWorkspace}
              onPageChange={setMemberPage}
            />
          )}
          {tab === "roles" && owner && <WorkspaceRolesSettings workspaceId={workspace.organizationId} />}
          {tab === "invites" && owner && (
            <WorkspaceInvitesSettings
              workspaceId={workspace.organizationId}
              properties={properties}
              onMembershipChanged={refreshWorkspace}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function GeneralSettings({
  workspace,
  canManage,
  onSaved,
}: {
  workspace: Organization;
  canManage: boolean;
  onSaved: () => Promise<void>;
}) {
  const { request } = useSession();
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const update = useMutation({
    mutationFn: () => request(`/api/organizations/${workspace.organizationId}`, {
      method: "PUT",
      body: JSON.stringify({ name: name.trim(), slug: slug.trim(), expectedVersion: workspace.version }),
    }),
    onSuccess: onSaved,
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
  return role === 2 || String(role).toLowerCase() === "owner";
}
