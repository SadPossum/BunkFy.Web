import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  Copy,
  Link2,
  MailPlus,
  QrCode,
  RefreshCw,
  UserX,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  Property,
  WorkspaceAccessProfile,
  WorkspaceAccessProfileListResponse,
  WorkspaceStaffJoinSource,
  WorkspaceStaffJoinSourceIssuance,
  WorkspaceStaffJoinSourceListResponse,
  WorkspaceStaffJoinSourceReplacement,
} from "../../api/types";
import { emailVerificationEnabled } from "../../app/environment";
import { useSession } from "../../app/session";
import { Modal, ModalActions, StatusBadge } from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { AccessProfilePicker, PropertyScopeField } from "./WorkspaceAccessControls";
import { WorkspaceJoinRequestSettings } from "./WorkspaceJoinRequestSettings";
import { canReplaceJoinSource, isActiveJoinSource, joinSourceStatusLabel } from "./workspaceJoinSources";

const ACTIVE_PROFILE_PAGE_SIZE = 100;
const SOURCE_PAGE_SIZE = 10;
const REUSABLE_PROFILE_KEYS = new Set(["front-desk", "housekeeping", "viewer"]);

type IssuedJoinLink = {
  kind: "invitation" | "enrollment";
  token: string;
  lifetimeHours: number;
};

export function WorkspaceInvitesSettings({
  workspaceId,
  properties,
  onMembershipChanged,
}: {
  workspaceId: string;
  properties: Property[];
  onMembershipChanged: () => Promise<void>;
}) {
  const { request } = useSession();
  const [issued, setIssued] = useState<IssuedJoinLink | null>(null);
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);
  const profiles = useQuery({
    queryKey: ["workspace-access", workspaceId, "active-profiles"],
    queryFn: () => request<WorkspaceAccessProfileListResponse>(
      `/api/workspace-access/profiles?includeArchived=false&page=1&pageSize=${ACTIVE_PROFILE_PAGE_SIZE}`,
    ),
  });

  return (
    <div className="space-y-10">
      {profiles.data?.hasMore && (
        <div className="alert alert-warning py-3 text-sm">
          This workspace has more than {ACTIVE_PROFILE_PAGE_SIZE} active roles. Archive unused roles before issuing new access.
        </div>
      )}
      {profiles.error && <SettingsError error={profiles.error} />}
      {profiles.isLoading && <div className="loading loading-spinner loading-md text-primary" />}
      {profiles.data && !profiles.data.hasMore && (
        <>
          <JoinSourceCreation
            workspaceId={workspaceId}
            profiles={profiles.data.items.filter((profile) => profile.status === 1)}
            properties={properties}
            onIssued={(kind, issuance, lifetimeHours) => {
              if (!issuance.token) {
                setTokenNotice("This source was already issued, so its one-time token cannot be shown again. Replace it to create a new link.");
                return;
              }
              setTokenNotice(null);
              setIssued({ kind, token: issuance.token, lifetimeHours });
            }}
          />
          {tokenNotice && <div className="alert alert-warning py-3 text-sm">{tokenNotice}</div>}
          <JoinSourceLifecycle
            workspaceId={workspaceId}
            profiles={profiles.data.items}
            properties={properties}
            onIssued={(kind, issuance, lifetimeHours) => {
              if (!issuance.token) {
                setTokenNotice("The replacement exists, but its one-time token was already returned and cannot be replayed. Replace it again if the link was lost.");
                return;
              }
              setTokenNotice(null);
              setIssued({ kind, token: issuance.token, lifetimeHours });
            }}
          />
        </>
      )}
      <WorkspaceJoinRequestSettings workspaceId={workspaceId} onMembershipChanged={onMembershipChanged} />
      {issued && <IssuedJoinLinkModal issued={issued} onClose={() => setIssued(null)} />}
    </div>
  );
}

function JoinSourceCreation({
  workspaceId,
  profiles,
  properties,
  onIssued,
}: {
  workspaceId: string;
  profiles: WorkspaceAccessProfile[];
  properties: Property[];
  onIssued: (kind: IssuedJoinLink["kind"], issuance: WorkspaceStaffJoinSourceIssuance, lifetimeHours: number) => void;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const reusableProfiles = profiles.filter((profile) => REUSABLE_PROFILE_KEYS.has(profile.key));
  const [email, setEmail] = useState("");
  const [inviteProfileId, setInviteProfileId] = useState("");
  const [invitePropertyIds, setInvitePropertyIds] = useState<string[]>([]);
  const [inviteLifetimeHours, setInviteLifetimeHours] = useState(72);
  const [inviteSourceId, setInviteSourceId] = useState(() => crypto.randomUUID());
  const [enrollmentProfileId, setEnrollmentProfileId] = useState("");
  const [enrollmentPropertyIds, setEnrollmentPropertyIds] = useState<string[]>([]);
  const [enrollmentLifetimeHours, setEnrollmentLifetimeHours] = useState(24);
  const [maximumClaims, setMaximumClaims] = useState(20);
  const [approvalMode, setApprovalMode] = useState("2");
  const [enrollmentSourceId, setEnrollmentSourceId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!profiles.some((profile) => profile.profileId === inviteProfileId)) {
      setInviteProfileId(profiles[0]?.profileId ?? "");
    }
  }, [inviteProfileId, profiles]);
  useEffect(() => {
    if (!reusableProfiles.some((profile) => profile.profileId === enrollmentProfileId)) {
      setEnrollmentProfileId(reusableProfiles[0]?.profileId ?? "");
    }
  }, [enrollmentProfileId, reusableProfiles]);

  const invite = useMutation({
    mutationFn: () => {
      const profile = profiles.find((item) => item.profileId === inviteProfileId);
      if (!profile) throw new Error("Choose a role for this invitation.");
      return request<WorkspaceStaffJoinSourceIssuance>("/api/workspace-staff-enrollment/sources/invitations", {
        method: "POST",
        body: JSON.stringify({
          sourceId: inviteSourceId,
          recipientEmail: email.trim() || null,
          lifetimeHours: inviteLifetimeHours,
          profileKey: profile.key,
          propertyIds: invitePropertyIds,
        }),
      });
    },
    onSuccess: async (result) => {
      onIssued("invitation", result, inviteLifetimeHours);
      setInviteSourceId(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ["workspace-access", workspaceId, "join-sources"] });
    },
  });
  const enrollment = useMutation({
    mutationFn: () => {
      const profile = reusableProfiles.find((item) => item.profileId === enrollmentProfileId);
      if (!profile) throw new Error("Choose a reusable low-privilege role.");
      return request<WorkspaceStaffJoinSourceIssuance>("/api/workspace-staff-enrollment/sources/enrollment-links", {
        method: "POST",
        body: JSON.stringify({
          sourceId: enrollmentSourceId,
          lifetimeHours: enrollmentLifetimeHours,
          maximumClaims,
          approvalMode: Number(approvalMode),
          profileKey: profile.key,
          propertyIds: enrollmentPropertyIds,
        }),
      });
    },
    onSuccess: async (result) => {
      onIssued("enrollment", result, enrollmentLifetimeHours);
      setEnrollmentSourceId(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ["workspace-access", workspaceId, "join-sources"] });
    },
  });

  function changeInviteProfile(value: string) {
    setInviteProfileId(value);
    setInviteSourceId(crypto.randomUUID());
  }

  function changeEnrollmentProfile(value: string) {
    setEnrollmentProfileId(value);
    setEnrollmentSourceId(crypto.randomUUID());
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:divide-base-300">
      <form className="space-y-5 lg:pr-8" onSubmit={(event: FormEvent) => { event.preventDefault(); invite.mutate(); }}>
        <div>
          <MailPlus className="text-primary" size={22} />
          <h2 className="mt-3 font-display text-xl font-semibold">Invite one person</h2>
          <p className="mt-2 text-sm leading-6 text-base-content/50">Create a recipient-aware single-use link with its role already constrained.</p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Recipient email (optional)</span>
          <input
            className="input input-bordered w-full"
            type="email"
            value={email}
            onChange={(event) => { setEmail(event.target.value); setInviteSourceId(crypto.randomUUID()); }}
            placeholder="staff@example.com"
          />
        </label>
        {!emailVerificationEnabled && email.trim() && (
          <p className="text-xs leading-5 text-warning">
            Email verification is disabled here. A recipient-bound link requires an account whose email is already verified by the configured identity provider.
          </p>
        )}
        <AccessProfilePicker profiles={profiles} value={inviteProfileId} onValueChange={changeInviteProfile} />
        <PropertyScopeField
          properties={properties}
          propertyIds={invitePropertyIds}
          onChange={(ids) => { setInvitePropertyIds(ids); setInviteSourceId(crypto.randomUUID()); }}
        />
        <LifetimeField value={inviteLifetimeHours} onChange={(value) => { setInviteLifetimeHours(value); setInviteSourceId(crypto.randomUUID()); }} />
        {invite.error && <SettingsError error={invite.error} />}
        <button className="btn btn-primary w-full text-white sm:w-auto" disabled={invite.isPending || !inviteProfileId}>
          {invite.isPending && <span className="loading loading-spinner loading-sm" />}
          <Link2 size={17} />Create invite
        </button>
      </form>

      <form className="space-y-5 border-t border-base-300 pt-8 lg:border-t-0 lg:pl-8 lg:pt-0" onSubmit={(event: FormEvent) => { event.preventDefault(); enrollment.mutate(); }}>
        <div>
          <QrCode className="text-primary" size={22} />
          <h2 className="mt-3 font-display text-xl font-semibold">Create a team QR</h2>
          <p className="mt-2 text-sm leading-6 text-base-content/50">Reusable enrollment is limited to built-in low-privilege roles.</p>
        </div>
        <AccessProfilePicker profiles={reusableProfiles} value={enrollmentProfileId} onValueChange={changeEnrollmentProfile} />
        <PropertyScopeField
          properties={properties}
          propertyIds={enrollmentPropertyIds}
          onChange={(ids) => { setEnrollmentPropertyIds(ids); setEnrollmentSourceId(crypto.randomUUID()); }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Maximum joins</span>
            <input
              className="input input-bordered w-full"
              type="number"
              min={1}
              max={1000}
              value={maximumClaims}
              onChange={(event) => { setMaximumClaims(Number(event.target.value)); setEnrollmentSourceId(crypto.randomUUID()); }}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Approval</span>
            <SelectPicker
              value={approvalMode}
              onValueChange={(value) => { setApprovalMode(value); setEnrollmentSourceId(crypto.randomUUID()); }}
              ariaLabel="Enrollment approval"
              options={[
                { value: "2", label: "Owner approval" },
                { value: "1", label: "Automatic" },
              ]}
            />
          </label>
        </div>
        <LifetimeField value={enrollmentLifetimeHours} onChange={(value) => { setEnrollmentLifetimeHours(value); setEnrollmentSourceId(crypto.randomUUID()); }} />
        {enrollment.error && <SettingsError error={enrollment.error} />}
        <button className="btn btn-outline w-full sm:w-auto" disabled={enrollment.isPending || !enrollmentProfileId}>
          {enrollment.isPending && <span className="loading loading-spinner loading-sm" />}
          <QrCode size={17} />Create QR
        </button>
      </form>
    </div>
  );
}

function JoinSourceLifecycle({
  workspaceId,
  profiles,
  properties,
  onIssued,
}: {
  workspaceId: string;
  profiles: WorkspaceAccessProfile[];
  properties: Property[];
  onIssued: (kind: IssuedJoinLink["kind"], issuance: WorkspaceStaffJoinSourceIssuance, lifetimeHours: number) => void;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const replacementIds = useRef(new Map<string, string>());
  const [kind, setKind] = useState<"invitation" | "enrollment">("invitation");
  const [page, setPage] = useState(1);
  const sourceKind = kind === "invitation" ? 1 : 2;
  const sources = useQuery({
    queryKey: ["workspace-access", workspaceId, "join-sources", sourceKind, page],
    queryFn: () => request<WorkspaceStaffJoinSourceListResponse>(
      `/api/workspace-staff-enrollment/sources?sourceKind=${sourceKind}&page=${page}&pageSize=${SOURCE_PAGE_SIZE}`,
    ),
  });
  const management = useMutation({
    mutationFn: async ({ source, action }: { source: WorkspaceStaffJoinSource; action: "deny" | "replace" }) => {
      const base = source.sourceKind === 1 ? "invitations" : "enrollment-links";
      if (action === "replace") {
        let replacementSourceId = replacementIds.current.get(source.sourceId);
        if (!replacementSourceId) {
          replacementSourceId = crypto.randomUUID();
          replacementIds.current.set(source.sourceId, replacementSourceId);
        }
        return request<WorkspaceStaffJoinSourceReplacement>(
          `/api/workspace-staff-enrollment/sources/${base}/${source.sourceId}/replace`,
          {
            method: "POST",
            body: JSON.stringify({ replacementSourceId, expectedVersion: source.version, lifetimeHours: source.sourceKind === 1 ? 72 : 24 }),
          },
        );
      }
      const actionName = source.sourceKind === 1 ? "revoke" : "disable";
      return request<WorkspaceStaffJoinSource>(
        `/api/workspace-staff-enrollment/sources/${base}/${source.sourceId}/${actionName}`,
        { method: "POST", body: JSON.stringify({ expectedVersion: source.version }) },
      );
    },
    onSuccess: async (result, variables) => {
      if (variables.action === "replace" && "replacement" in result) {
        replacementIds.current.delete(variables.source.sourceId);
        onIssued(variables.source.sourceKind === 1 ? "invitation" : "enrollment", result.replacement, variables.source.sourceKind === 1 ? 72 : 24);
      }
      await queryClient.invalidateQueries({ queryKey: ["workspace-access", workspaceId, "join-sources"] });
    },
  });

  useEffect(() => setPage(1), [kind, workspaceId]);
  useEffect(() => {
    if (!sources.isFetching && page > 1 && sources.data?.items.length === 0) {
      setPage((current) => Math.max(1, current - 1));
    }
  }, [page, sources.data?.items.length, sources.isFetching]);

  return (
    <section className="border-t border-base-300 pt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Issued access links</h2>
          <p className="mt-1 text-sm leading-6 text-base-content/55">Review lifecycle and replace a lost or unusable source safely.</p>
        </div>
        <SegmentedTabs
          value={kind}
          ariaLabel="Join source type"
          onValueChange={setKind}
          options={[
            { value: "invitation", label: "Invitations", icon: <MailPlus size={15} /> },
            { value: "enrollment", label: "Team QR", icon: <QrCode size={15} /> },
          ]}
        />
      </div>
      {sources.isLoading && <div className="loading loading-spinner loading-md mt-6 text-primary" />}
      {sources.error && <SettingsError error={sources.error} />}
      {!sources.isLoading && !sources.error && (
        <>
          <div className="mt-5 divide-y divide-base-300 border-y border-base-300">
            {!sources.data?.items.length && <p className="py-8 text-center text-sm text-base-content/50">No issued sources on this page.</p>}
            {(sources.data?.items ?? []).map((source) => (
              <JoinSourceRow
                key={source.sourceId}
                source={source}
                profiles={profiles}
                properties={properties}
                pending={management.isPending}
                onAction={(action) => management.mutate({ source, action })}
              />
            ))}
          </div>
          <PaginationBar
            page={page}
            pageSize={SOURCE_PAGE_SIZE}
            itemCount={sources.data?.items.length ?? 0}
            itemLabel={kind === "invitation" ? "invitation" : "QR link"}
            disabled={sources.isFetching || management.isPending}
            onPageChange={setPage}
          />
          {management.error && <SettingsError error={management.error} />}
        </>
      )}
    </section>
  );
}

function JoinSourceRow({
  source,
  profiles,
  properties,
  pending,
  onAction,
}: {
  source: WorkspaceStaffJoinSource;
  profiles: WorkspaceAccessProfile[];
  properties: Property[];
  pending: boolean;
  onAction: (action: "deny" | "replace") => void;
}) {
  const profile = source.accessPlan
    ? profiles.find((item) => item.profileId === source.accessPlan?.profileId)
    : undefined;
  const propertyNames = (source.accessPlan?.propertyIds ?? [])
    .map((id) => properties.find((property) => property.propertyId === id)?.name ?? id.slice(0, 8));
  return (
    <article className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{source.recipientEmail || (source.sourceKind === 1 ? "Open invitation" : "Team QR")}</p>
          <StatusBadge status={joinSourceStatusLabel(source.status)} />
        </div>
        {source.accessPlan ? (
          <p className="mt-1 text-sm text-base-content/55">
            {profile?.displayName ?? formatProfileKey(source.accessPlan.profileKey)} / {propertyNames.length ? propertyNames.join(", ") : "All properties"}
          </p>
        ) : (
          <p className="mt-1 text-sm text-warning">Legacy invitation / no operational role</p>
        )}
        <p className="mt-1 text-xs text-base-content/45">
          Expires {new Date(source.expiresAtUtc).toLocaleString()}
          {source.maximumClaims != null ? ` / ${source.reservedClaims ?? 0} of ${source.maximumClaims} reserved` : ""}
          {source.approvalMode ? ` / ${formatProfileKey(source.approvalMode)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {isActiveJoinSource(source.status) && (
          <button className="btn btn-ghost btn-sm text-error" disabled={pending} onClick={() => onAction("deny")}>
            <UserX size={15} />{source.sourceKind === 1 ? "Revoke" : "Disable"}
          </button>
        )}
        {source.accessPlan && canReplaceJoinSource(source.sourceKind, source.status) && (
          <button className="btn btn-outline btn-sm" disabled={pending} onClick={() => onAction("replace")}>
            <RefreshCw size={15} />Replace
          </button>
        )}
      </div>
    </article>
  );
}

function IssuedJoinLinkModal({ issued, onClose }: { issued: IssuedJoinLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = joinUrl(issued);
  async function copyLink() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <Modal
      open
      title={issued.kind === "invitation" ? "Invitation ready" : "Team QR ready"}
      description="This token is shown once. Store or share it now; replacing the source is the only recovery path."
      onClose={onClose}
    >
      <div className="mx-auto w-fit rounded-lg bg-white p-4 shadow-xs">
        <QRCodeSVG value={url} size={208} level="M" />
      </div>
      <p className="mt-5 break-all rounded-lg bg-base-200 p-3 font-mono text-xs text-base-content/60">{url}</p>
      <p className="mt-2 text-xs text-base-content/45">Configured lifetime: {issued.lifetimeHours} hours.</p>
      <ModalActions>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        <button className="btn btn-primary text-white" onClick={() => void copyLink()}>
          {copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Copied" : "Copy link"}
        </button>
      </ModalActions>
    </Modal>
  );
}

function LifetimeField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <label className="block max-w-48">
      <span className="mb-1.5 block text-sm font-semibold">Lifetime (hours)</span>
      <input className="input input-bordered w-full" type="number" min={1} max={720} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function SettingsError({ error }: { error: unknown }) {
  return <div className="alert alert-error mt-5 py-3 text-sm">{error instanceof Error ? error.message : "The request could not be completed."}</div>;
}

function joinUrl(link: Pick<IssuedJoinLink, "kind" | "token">): string {
  const url = new URL("/join", window.location.origin);
  url.hash = new URLSearchParams({ [link.kind]: link.token }).toString();
  return url.toString();
}

function formatProfileKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("-", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
