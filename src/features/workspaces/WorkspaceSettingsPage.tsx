import { useMutation, useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  Copy,
  Link2,
  MailPlus,
  QrCode,
  Settings2,
  ShieldCheck,
  UserMinus,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  Organization,
  OrganizationEnrollmentLinkIssued,
  OrganizationInvitationIssued,
  OrganizationMemberListResponse,
  OrganizationMembership,
  StaffListResponse,
} from "../../api/types";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { Modal, PageHeader } from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";

type IssuedJoinLink = { kind: "invitation" | "enrollment"; token: string; expiresAtUtc: string };
const MEMBERS_PAGE_SIZE = 25;

export function WorkspaceSettingsPage() {
  const { request, session } = useSession();
  const {
    selectedWorkspace,
    refetchWorkspaces,
  } = useWorkspace();
  const [tab, setTab] = useState<"general" | "members" | "invites">("general");
  const [issued, setIssued] = useState<IssuedJoinLink | null>(null);
  const [copied, setCopied] = useState(false);
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
  const staff = useQuery({
    queryKey: ["staff-members", workspace?.organizationId, "workspace-settings"],
    queryFn: () => request<StaffListResponse>("/api/staff/members?page=1&pageSize=100"),
    enabled: Boolean(workspace && owner && tab === "members"),
  });
  const staffBySubject = useMemo(
    () => new Map(
      (staff.data?.items ?? [])
        .filter((item) => item.authSubjectId)
        .map((item) => [item.authSubjectId!, item]),
    ),
    [staff.data?.items],
  );
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

  async function copyIssuedLink() {
    if (!issued) return;
    await navigator.clipboard.writeText(joinUrl(issued));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
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
            {owner ? "Owner" : "Front desk"}
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
              request={request}
              onSaved={refetchWorkspaces}
            />
          )}
          {tab === "members" && owner && (
            <MembersSettings
              workspace={workspace}
              currentMembership={selectedWorkspace.membership}
              memberships={members.data?.items ?? []}
              staffBySubject={staffBySubject}
              currentUsername={session?.username ?? ""}
              page={memberPage}
              pageSize={MEMBERS_PAGE_SIZE}
              loading={members.isLoading}
              fetching={members.isFetching}
              error={members.error}
              request={request}
              onChanged={refreshWorkspace}
              onPageChange={setMemberPage}
            />
          )}
          {tab === "invites" && owner && (
            <InviteSettings
              workspaceId={workspace.organizationId}
              request={request}
              onIssued={setIssued}
            />
          )}
        </div>
      </section>

      {issued && (
        <Modal
          open
          title={issued.kind === "invitation" ? "Invitation ready" : "Team QR ready"}
          description="Share this link only with the person or team you expect to join."
          onClose={() => setIssued(null)}
        >
          <div className="mx-auto w-fit rounded-lg bg-white p-4 shadow-xs">
            <QRCodeSVG value={joinUrl(issued)} size={208} level="M" />
          </div>
          <p className="mt-5 break-all rounded-lg bg-base-200 p-3 font-mono text-xs text-base-content/60">{joinUrl(issued)}</p>
          <p className="mt-2 text-xs text-base-content/45">
            Expires {new Date(issued.expiresAtUtc).toLocaleString()}
          </p>
          <button className="btn btn-primary mt-5 w-full text-white" onClick={() => void copyIssuedLink()}>
            {copied ? <Check size={17} /> : <Copy size={17} />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </Modal>
      )}
    </div>
  );
}

function GeneralSettings({
  workspace,
  canManage,
  request,
  onSaved,
}: {
  workspace: Organization;
  canManage: boolean;
  request: ReturnType<typeof useSession>["request"];
  onSaved: () => Promise<void>;
}) {
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
          <p className="mt-1 text-sm leading-6 text-base-content/55">
            The name and handle shown throughout your team workspace.
          </p>
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
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" />
          Workspace identity can only be changed by the owner.
        </div>
      )}
      {update.error && <ErrorMessage error={update.error} />}
      {canManage && (
        <div className="mt-5 flex justify-end border-t border-base-300 pt-5">
          <button className="btn btn-primary text-white" onClick={() => update.mutate()} disabled={update.isPending || (!name.trim() || !slug.trim())}>
            {update.isPending && <span className="loading loading-spinner loading-sm" />}
            Save changes
          </button>
        </div>
      )}
    </section>
  );
}

function InviteSettings({ workspaceId, request, onIssued }: {
  workspaceId: string;
  request: ReturnType<typeof useSession>["request"];
  onIssued: (link: IssuedJoinLink) => void;
}) {
  const [email, setEmail] = useState("");
  const [maximumClaims, setMaximumClaims] = useState(20);
  const invite = useMutation({
    mutationFn: () => request<OrganizationInvitationIssued>(`/api/organizations/${workspaceId}/invitations`, {
      method: "POST",
      body: JSON.stringify({ recipientEmail: email.trim() || null, lifetimeHours: 72 }),
    }),
    onSuccess: (result) => onIssued({ kind: "invitation", token: result.token, expiresAtUtc: result.invitation.expiresAtUtc }),
  });
  const enrollment = useMutation({
    mutationFn: () => request<OrganizationEnrollmentLinkIssued>(`/api/organizations/${workspaceId}/enrollment-links`, {
      method: "POST",
      body: JSON.stringify({ lifetimeHours: 24, maximumClaims, approvalMode: 1 }),
    }),
    onSuccess: (result) => onIssued({ kind: "enrollment", token: result.token, expiresAtUtc: result.enrollmentLink.expiresAtUtc }),
  });
  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:divide-base-300">
      <form className="lg:pr-8" onSubmit={(event: FormEvent) => { event.preventDefault(); invite.mutate(); }}>
        <MailPlus className="text-primary" size={22} />
        <h2 className="mt-3 font-display text-xl font-semibold">Invite one person</h2>
        <p className="mt-2 text-sm leading-6 text-base-content/50">Bind the invite to a verified email for the safest handoff. The link can only be accepted once.</p>
        <label className="mt-5 block">
          <span className="mb-1.5 block text-sm font-semibold">Email</span>
          <input className="input input-bordered w-full" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="staff@example.com" />
        </label>
        {invite.error && <ErrorMessage error={invite.error} />}
        <button className="btn btn-primary mt-5 w-full text-white sm:w-auto" disabled={invite.isPending}>
          {invite.isPending && <span className="loading loading-spinner loading-sm" />}
          <Link2 size={17} />
          Create invite
        </button>
      </form>
      <form className="border-t border-base-300 pt-8 lg:border-t-0 lg:pl-8 lg:pt-0" onSubmit={(event: FormEvent) => { event.preventDefault(); enrollment.mutate(); }}>
        <QrCode className="text-primary" size={22} />
        <h2 className="mt-3 font-display text-xl font-semibold">Create a team QR</h2>
        <p className="mt-2 text-sm leading-6 text-base-content/50">A short-lived reusable link for supervised onboarding. Anyone with it can join until its limit is reached.</p>
        <label className="mt-5 block max-w-40">
          <span className="mb-1.5 block text-sm font-semibold">Maximum joins</span>
          <input className="input input-bordered w-full" type="number" min={1} max={100} value={maximumClaims} onChange={(event) => setMaximumClaims(Number(event.target.value))} />
        </label>
        {enrollment.error && <ErrorMessage error={enrollment.error} />}
        <button className="btn btn-outline mt-5 w-full sm:w-auto" disabled={enrollment.isPending}>
          {enrollment.isPending && <span className="loading loading-spinner loading-sm" />}
          <QrCode size={17} />
          Create QR
        </button>
      </form>
    </div>
  );
}

function MembersSettings({
  workspace,
  currentMembership,
  memberships,
  staffBySubject,
  currentUsername,
  page,
  pageSize,
  loading,
  fetching,
  error,
  request,
  onChanged,
  onPageChange,
}: {
  workspace: Organization;
  currentMembership: OrganizationMembership;
  memberships: OrganizationMembership[];
  staffBySubject: Map<string, StaffListResponse["items"][number]>;
  currentUsername: string;
  page: number;
  pageSize: number;
  loading: boolean;
  fetching: boolean;
  error: unknown;
  request: ReturnType<typeof useSession>["request"];
  onChanged: () => Promise<void>;
  onPageChange: (page: number) => void;
}) {
  const action = useMutation({
    mutationFn: ({ membership, actionName }: { membership: OrganizationMembership; actionName: "suspend" | "resume" | "remove" | "owner" }) => {
      if (actionName === "owner") {
        return request(`/api/organizations/${workspace.organizationId}/ownership/transfer`, {
          method: "POST",
          body: JSON.stringify({
            targetSubjectId: membership.subjectId,
            expectedOrganizationVersion: workspace.version,
            expectedCurrentOwnerVersion: currentMembership.version,
            expectedTargetVersion: membership.version,
          }),
        });
      }
      return request(`/api/organizations/${workspace.organizationId}/members/${actionName}`, {
        method: "POST",
        body: JSON.stringify({
          targetSubjectId: membership.subjectId,
          expectedOrganizationVersion: workspace.version,
          expectedMembershipVersion: membership.version,
        }),
      });
    },
    onSuccess: onChanged,
  });

  if (loading) return <div className="loading loading-spinner loading-md text-primary" />;
  if (error) return <ErrorMessage error={error} />;
  return (
    <section>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <UsersRound size={20} />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold">Workspace members</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-base-content/55">
            Front desk staff can manage reservations and guest records, block inventory,
            view properties and rooms, and use the Staff directory. Workspace setup and
            team administration remain owner-only.
          </p>
        </div>
      </div>
      <div className="mt-5 divide-y divide-base-300 border-y border-base-300">
        {!memberships.length && <p className="py-8 text-center text-sm text-base-content/50">No members on this page.</p>}
        {memberships.map((membership) => {
          const profile = staffBySubject.get(membership.subjectId);
          const self = membership.membershipId === currentMembership.membershipId;
          const active = isActive(membership.status);
          const displayName = self ? "You" : profile?.displayName ?? "Workspace member";
          const accountLabel = self ? currentUsername : profile?.workEmail ?? membership.subjectId;
          return (
            <article key={membership.membershipId} className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{displayName}</p>
                <p className="mt-1 truncate text-xs text-base-content/45">{accountLabel}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {self && <span className="badge border-0 bg-primary font-semibold text-white">Current account</span>}
                <span className="badge badge-outline">{isOwner(membership.role) ? "Owner" : active ? "Front desk" : statusLabel(membership.status)}</span>
                {!self && active && !isOwner(membership.role) && (
                  <button className="btn btn-ghost btn-sm" onClick={() => action.mutate({ membership, actionName: "owner" })} disabled={action.isPending}>
                    <ShieldCheck size={15} />Make owner
                  </button>
                )}
                {!self && (
                  <button
                    className="btn btn-ghost btn-sm text-error"
                    onClick={() => action.mutate({ membership, actionName: active ? "suspend" : "resume" })}
                    disabled={action.isPending}
                  >
                    <UserMinus size={15} />{active ? "Suspend" : "Resume"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <PaginationBar page={page} pageSize={pageSize} itemCount={memberships.length} itemLabel="member" disabled={fetching} onPageChange={onPageChange} />
      {action.error && <ErrorMessage error={action.error} />}
    </section>
  );
}

function ErrorMessage({ error }: { error: unknown }) {
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

function joinUrl(link: IssuedJoinLink): string {
  const url = new URL("/join", window.location.origin);
  url.hash = new URLSearchParams({ [link.kind]: link.token }).toString();
  return url.toString();
}
