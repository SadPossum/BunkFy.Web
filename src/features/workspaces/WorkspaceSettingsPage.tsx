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
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
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

type IssuedJoinLink = { kind: "invitation" | "enrollment"; token: string; expiresAtUtc: string };

export function WorkspaceSettingsPage() {
  const { request } = useSession();
  const {
    selectedWorkspace,
    refetchWorkspaces,
  } = useWorkspace();
  const [tab, setTab] = useState<"general" | "members" | "invites">("general");
  const [issued, setIssued] = useState<IssuedJoinLink | null>(null);
  const [copied, setCopied] = useState(false);
  const workspace = selectedWorkspace?.organization;
  const owner = isOwner(selectedWorkspace?.membership.role);
  const members = useQuery({
    queryKey: ["organizations", workspace?.organizationId, "members"],
    queryFn: () => request<OrganizationMemberListResponse>(
      `/api/organizations/${workspace?.organizationId}/members?page=1&pageSize=100`,
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
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase text-primary">Workspace</p>
          <h1 className="mt-2 font-display text-3xl font-semibold">{workspace.name}</h1>
          <p className="mt-2 text-sm text-base-content/50">{workspace.slug}</p>
        </div>
        <span className="badge badge-outline gap-2 py-3">
          <ShieldCheck size={14} />
          {owner ? "Owner" : "Member"}
        </span>
      </header>

      <div className="join" role="tablist" aria-label="Workspace settings">
        {([
          ["general", "General", Settings2],
          ["members", "Members", UsersRound],
          ["invites", "Invites", MailPlus],
        ] as const).map(([value, label, Icon]) => (
          <button
            key={value}
            className={`btn join-item btn-sm ${tab === value ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab(value)}
            disabled={!owner && value !== "general"}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

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
          loading={members.isLoading}
          error={members.error}
          request={request}
          onChanged={refreshWorkspace}
        />
      )}
      {tab === "invites" && owner && (
        <InviteSettings
          workspaceId={workspace.organizationId}
          request={request}
          onIssued={setIssued}
        />
      )}

      {issued && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-label="Workspace join link">
          <div className="modal-box max-w-md rounded-lg">
            <button
              className="btn btn-circle btn-ghost btn-sm absolute right-4 top-4"
              onClick={() => setIssued(null)}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <h2 className="font-display text-2xl font-semibold">
              {issued.kind === "invitation" ? "Invitation ready" : "Team QR ready"}
            </h2>
            <div className="mx-auto mt-6 w-fit bg-white p-4">
              <QRCodeSVG value={joinUrl(issued)} size={208} level="M" />
            </div>
            <p className="mt-5 break-all text-xs text-base-content/50">{joinUrl(issued)}</p>
            <p className="mt-2 text-xs text-base-content/40">
              Expires {new Date(issued.expiresAtUtc).toLocaleString()}
            </p>
            <button className="btn btn-primary mt-5 w-full" onClick={() => void copyIssuedLink()}>
              {copied ? <Check size={17} /> : <Copy size={17} />}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <button className="modal-backdrop" onClick={() => setIssued(null)} aria-label="Close" />
        </div>
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
    <section className="max-w-2xl border-t border-base-300 pt-6">
      <h2 className="font-display text-xl font-semibold">Workspace details</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label>
          <span className="mb-2 block text-sm font-semibold">Name</span>
          <input className="input input-bordered w-full" value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage} />
        </label>
        <label>
          <span className="mb-2 block text-sm font-semibold">Handle</span>
          <input className="input input-bordered w-full" value={slug} onChange={(event) => setSlug(event.target.value)} disabled={!canManage} />
        </label>
      </div>
      {update.error && <ErrorMessage error={update.error} />}
      {canManage && (
        <button className="btn btn-primary mt-5" onClick={() => update.mutate()} disabled={update.isPending}>
          {update.isPending && <span className="loading loading-spinner loading-sm" />}
          Save changes
        </button>
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
    <div className="grid gap-10 border-t border-base-300 pt-6 lg:grid-cols-2">
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); invite.mutate(); }}>
        <MailPlus className="text-primary" size={22} />
        <h2 className="mt-3 font-display text-xl font-semibold">Invite one person</h2>
        <p className="mt-2 text-sm leading-6 text-base-content/50">Bind the invite to a verified email for the safest handoff. The link can only be accepted once.</p>
        <label className="mt-5 block">
          <span className="mb-2 block text-sm font-semibold">Email</span>
          <input className="input input-bordered w-full" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="staff@example.com" />
        </label>
        {invite.error && <ErrorMessage error={invite.error} />}
        <button className="btn btn-primary mt-5" disabled={invite.isPending}>
          {invite.isPending && <span className="loading loading-spinner loading-sm" />}
          <Link2 size={17} />
          Create invite
        </button>
      </form>
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); enrollment.mutate(); }}>
        <QrCode className="text-primary" size={22} />
        <h2 className="mt-3 font-display text-xl font-semibold">Create a team QR</h2>
        <p className="mt-2 text-sm leading-6 text-base-content/50">A short-lived reusable link for supervised onboarding. Anyone with it can join until its limit is reached.</p>
        <label className="mt-5 block max-w-40">
          <span className="mb-2 block text-sm font-semibold">Maximum joins</span>
          <input className="input input-bordered w-full" type="number" min={1} max={100} value={maximumClaims} onChange={(event) => setMaximumClaims(Number(event.target.value))} />
        </label>
        {enrollment.error && <ErrorMessage error={enrollment.error} />}
        <button className="btn btn-outline mt-5" disabled={enrollment.isPending}>
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
  loading,
  error,
  request,
  onChanged,
}: {
  workspace: Organization;
  currentMembership: OrganizationMembership;
  memberships: OrganizationMembership[];
  staffBySubject: Map<string, StaffListResponse["items"][number]>;
  loading: boolean;
  error: unknown;
  request: ReturnType<typeof useSession>["request"];
  onChanged: () => Promise<void>;
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
    <section className="border-t border-base-300 pt-6">
      <h2 className="font-display text-xl font-semibold">Workspace members</h2>
      <div className="mt-5 divide-y divide-base-300 border-y border-base-300">
        {memberships.map((membership) => {
          const profile = staffBySubject.get(membership.subjectId);
          const self = membership.membershipId === currentMembership.membershipId;
          const active = isActive(membership.status);
          return (
            <article key={membership.membershipId} className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{profile?.displayName ?? membership.subjectId}</p>
                <p className="mt-1 truncate text-xs text-base-content/45">{profile?.workEmail ?? membership.subjectId}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge badge-outline">{isOwner(membership.role) ? "Owner" : active ? "Member" : statusLabel(membership.status)}</span>
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
