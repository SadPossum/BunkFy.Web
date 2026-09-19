import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  ClipboardCheck,
  Copy,
  Link2,
  MailPlus,
  QrCode,
  RefreshCw,
  UserX,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import type {
  IssueWorkspaceEnrollmentLinkRequest,
  Property,
  WorkspaceAccessProfile,
  WorkspaceAccessProfileListResponse,
  WorkspaceStaffJoinSource,
  WorkspaceStaffJoinSourceIssuance,
  WorkspaceStaffJoinSourceListResponse,
  WorkspaceStaffJoinSourceReplacement,
} from "../../api/types";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import { useProductCapabilities } from "../../app/productCapabilities";
import { useSession } from "../../app/session";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { ErrorState, Modal, ModalActions, StatusBadge } from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { AccessProfilePicker, PropertyScopeField } from "./WorkspaceAccessControls";
import {
  workspaceAccessActionAllowed,
  workspaceAccessSourcesCurrent,
} from "./workspaceAccessAuthority";
import { WorkspaceJoinRequestSettings } from "./WorkspaceJoinRequestSettings";
import { canReplaceJoinSource, isActiveJoinSource, joinSourceStatusLabel } from "./workspaceJoinSources";
import {
  workspaceJoiningView,
  type WorkspaceJoiningView,
} from "./workspaceSettingsAccess";

const ACTIVE_PROFILE_PAGE_SIZE = 100;
const SOURCE_PAGE_SIZE = 10;
const REUSABLE_PROFILE_KEYS = new Set(["front-desk", "housekeeping", "viewer"]);
const ENROLLMENT_APPROVAL_OPTIONS: Array<{
  value: IssueWorkspaceEnrollmentLinkRequest["approvalMode"];
  label: string;
}> = [
  { value: "requires-approval", label: "Owner approval" },
  { value: "automatic", label: "Automatic" },
];

type IssuedJoinLink = {
  kind: "invitation" | "enrollment";
  token: string;
  lifetimeHours: number;
};

export function WorkspaceInvitesSettings({
  workspaceId,
  properties,
  propertySource,
  canGrant,
  onMembershipChanged,
}: {
  workspaceId: string;
  properties: Property[];
  propertySource: CompositeSource;
  canGrant: boolean;
  onMembershipChanged: () => Promise<void>;
}) {
  const { request } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = workspaceJoiningView(searchParams.get("joining"));
  const [issued, setIssued] = useState<IssuedJoinLink | null>(null);
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);
  const profiles = useQuery({
    queryKey: ["workspace-access", workspaceId, "active-profiles"],
    queryFn: () => request<WorkspaceAccessProfileListResponse>(
      `/api/workspace-access/profiles?includeArchived=false&page=1&pageSize=${ACTIVE_PROFILE_PAGE_SIZE}`,
    ),
    enabled: view !== "requests",
  });
  const profileSource = createCompositeSource({
    label: "Active roles",
    hasData: profiles.data !== undefined,
    isLoading: profiles.isLoading,
    error: profiles.error,
    isFetching: profiles.isFetching,
    refetch: () => profiles.refetch(),
  });
  const profilesUsable = compositeSourceUsable(profileSource.state);
  const propertiesUsable = compositeSourceUsable(propertySource.state);
  const grantSourcesCurrent = canGrant && workspaceAccessSourcesCurrent([
    profileSource,
    propertySource,
  ]);

  function setView(nextView: WorkspaceJoiningView) {
    const next = new URLSearchParams(searchParams);
    if (nextView === "invite") next.delete("joining");
    else next.set("joining", nextView);
    setSearchParams(next, { replace: true });
  }

  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <MailPlus size={20} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold">Joining people</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-base-content/55">
              Issue constrained access, manage link lifecycle, and review team requests.
            </p>
          </div>
        </div>
      </div>
      <SegmentedTabs
        stretch
        className="mt-5"
        value={view}
        ariaLabel="Joining workflow"
        onValueChange={setView}
        options={[
          { value: "invite", label: "Invite", icon: <MailPlus size={15} /> },
          { value: "qr", label: "Team QR", icon: <QrCode size={15} /> },
          { value: "requests", label: "Requests", icon: <ClipboardCheck size={15} /> },
        ]}
      />

      {view !== "requests" && (
        <div className="mt-6 space-y-6">
          <CompositeSourceNotice
            sources={[profileSource, propertySource]}
            title="Some joining data is delayed"
          />
          {profilesUsable && profiles.data?.hasMore && (
            <div className="alert alert-warning py-3 text-sm">
              This workspace has more than {ACTIVE_PROFILE_PAGE_SIZE} active roles. Archive unused roles before issuing new access.
            </div>
          )}
          {profilesUsable && profiles.data && !profiles.data.hasMore ? (
            <JoinSourceCreation
              kind={view === "invite" ? "invitation" : "enrollment"}
              workspaceId={workspaceId}
              profiles={profiles.data.items.filter((profile) => profile.status === 1)}
              properties={properties}
              canCreate={grantSourcesCurrent}
              onIssued={(kind, issuance, lifetimeHours) => {
                if (!issuance.token) {
                  setTokenNotice("This source was already issued, so its one-time token cannot be shown again. Replace it to create a new link.");
                  return;
                }
                setTokenNotice(null);
                setIssued({ kind, token: issuance.token, lifetimeHours });
              }}
            />
          ) : !profilesUsable ? (
            <CompositeSourceFallback state={profileSource.state} label="active roles for new access" />
          ) : null}
          {tokenNotice && <div className="alert alert-warning py-3 text-sm">{tokenNotice}</div>}
          <JoinSourceLifecycle
            kind={view === "invite" ? "invitation" : "enrollment"}
            workspaceId={workspaceId}
            profiles={profilesUsable ? profiles.data?.items ?? [] : []}
            properties={propertiesUsable ? properties : []}
            canReplace={canGrant}
            onIssued={(kind, issuance, lifetimeHours) => {
              if (!issuance.token) {
                setTokenNotice("The replacement exists, but its one-time token was already returned and cannot be replayed. Replace it again if the link was lost.");
                return;
              }
              setTokenNotice(null);
              setIssued({ kind, token: issuance.token, lifetimeHours });
            }}
          />
        </div>
      )}
      {view === "requests" && (
        <WorkspaceJoinRequestSettings
          workspaceId={workspaceId}
          canGrant={canGrant}
          onMembershipChanged={onMembershipChanged}
        />
      )}
      {issued && <IssuedJoinLinkModal issued={issued} onClose={() => setIssued(null)} />}
    </section>
  );
}

function JoinSourceCreation({
  kind,
  workspaceId,
  profiles,
  properties,
  canCreate,
  onIssued,
}: {
  kind: IssuedJoinLink["kind"];
  workspaceId: string;
  profiles: WorkspaceAccessProfile[];
  properties: Property[];
  canCreate: boolean;
  onIssued: (kind: IssuedJoinLink["kind"], issuance: WorkspaceStaffJoinSourceIssuance, lifetimeHours: number) => void;
}) {
  const { emailVerificationEnabled } = useProductCapabilities();
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
  const [approvalMode, setApprovalMode] = useState<
    IssueWorkspaceEnrollmentLinkRequest["approvalMode"]
  >("requires-approval");
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
      if (!canCreate) {
        throw new Error("Refresh roles, properties, and workspace authority before creating an invitation.");
      }
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
      if (!canCreate) {
        throw new Error("Refresh roles, properties, and workspace authority before creating a team QR.");
      }
      const profile = reusableProfiles.find((item) => item.profileId === enrollmentProfileId);
      if (!profile) throw new Error("Choose a reusable low-privilege role.");
      const payload: IssueWorkspaceEnrollmentLinkRequest = {
        sourceId: enrollmentSourceId,
        lifetimeHours: enrollmentLifetimeHours,
        maximumClaims,
        approvalMode,
        profileKey: profile.key,
        propertyIds: enrollmentPropertyIds,
      };
      return request<WorkspaceStaffJoinSourceIssuance>("/api/workspace-staff-enrollment/sources/enrollment-links", {
        method: "POST",
        body: JSON.stringify(payload),
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
    <div className="space-y-6">
      {!canCreate && (
        <div className="alert alert-warning py-3 text-sm">
          Refresh roles, properties, and workspace authority before issuing new access.
        </div>
      )}
      {kind === "invitation" ? (
        <form className="max-w-2xl space-y-5" onSubmit={(event: FormEvent) => { event.preventDefault(); invite.mutate(); }}>
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
              disabled={!canCreate}
              onChange={(event) => { setEmail(event.target.value); setInviteSourceId(crypto.randomUUID()); }}
              placeholder="staff@example.com"
            />
          </label>
          {!emailVerificationEnabled && email.trim() && (
            <p className="text-xs leading-5 text-warning">
              Email verification is disabled here. A recipient-bound link requires an account whose email is already verified by the configured identity provider.
            </p>
          )}
          <AccessProfilePicker
            profiles={profiles}
            value={inviteProfileId}
            onValueChange={changeInviteProfile}
            disabled={!canCreate}
          />
          <PropertyScopeField
            properties={properties}
            propertyIds={invitePropertyIds}
            onChange={(ids) => { setInvitePropertyIds(ids); setInviteSourceId(crypto.randomUUID()); }}
            disabled={!canCreate}
          />
          <LifetimeField
            value={inviteLifetimeHours}
            onChange={(value) => { setInviteLifetimeHours(value); setInviteSourceId(crypto.randomUUID()); }}
            disabled={!canCreate}
          />
          {invite.error && <SettingsError error={invite.error} />}
          <button className="btn btn-primary w-full text-white sm:w-auto" disabled={invite.isPending || !inviteProfileId || !canCreate}>
            {invite.isPending && <span className="loading loading-spinner loading-sm" />}
            <Link2 size={17} />Create invite
          </button>
        </form>
      ) : (
        <form className="max-w-2xl space-y-5" onSubmit={(event: FormEvent) => { event.preventDefault(); enrollment.mutate(); }}>
          <div>
            <QrCode className="text-primary" size={22} />
            <h2 className="mt-3 font-display text-xl font-semibold">Create a team QR</h2>
            <p className="mt-2 text-sm leading-6 text-base-content/50">Reusable enrollment is limited to built-in low-privilege roles.</p>
          </div>
          <AccessProfilePicker
            profiles={reusableProfiles}
            value={enrollmentProfileId}
            onValueChange={changeEnrollmentProfile}
            disabled={!canCreate}
          />
          <PropertyScopeField
            properties={properties}
            propertyIds={enrollmentPropertyIds}
            onChange={(ids) => { setEnrollmentPropertyIds(ids); setEnrollmentSourceId(crypto.randomUUID()); }}
            disabled={!canCreate}
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
                disabled={!canCreate}
                onChange={(event) => { setMaximumClaims(Number(event.target.value)); setEnrollmentSourceId(crypto.randomUUID()); }}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Approval</span>
              <SelectPicker
                value={approvalMode}
                onValueChange={(value) => {
                  const selected = ENROLLMENT_APPROVAL_OPTIONS.find((option) => option.value === value);
                  if (!selected) return;
                  setApprovalMode(selected.value);
                  setEnrollmentSourceId(crypto.randomUUID());
                }}
                ariaLabel="Enrollment approval"
                disabled={!canCreate}
                options={ENROLLMENT_APPROVAL_OPTIONS}
              />
            </label>
          </div>
          <LifetimeField
            value={enrollmentLifetimeHours}
            onChange={(value) => { setEnrollmentLifetimeHours(value); setEnrollmentSourceId(crypto.randomUUID()); }}
            disabled={!canCreate}
          />
          {enrollment.error && <SettingsError error={enrollment.error} />}
          <button className="btn btn-outline w-full sm:w-auto" disabled={enrollment.isPending || !enrollmentProfileId || !canCreate}>
            {enrollment.isPending && <span className="loading loading-spinner loading-sm" />}
            <QrCode size={17} />Create QR
          </button>
        </form>
      )}
    </div>
  );
}

function JoinSourceLifecycle({
  kind,
  workspaceId,
  profiles,
  properties,
  canReplace,
  onIssued,
}: {
  kind: IssuedJoinLink["kind"];
  workspaceId: string;
  profiles: WorkspaceAccessProfile[];
  properties: Property[];
  canReplace: boolean;
  onIssued: (kind: IssuedJoinLink["kind"], issuance: WorkspaceStaffJoinSourceIssuance, lifetimeHours: number) => void;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const replacementIds = useRef(new Map<string, string>());
  const [page, setPage] = useState(1);
  const sourceKind = kind === "invitation" ? 1 : 2;
  const sources = useQuery({
    queryKey: ["workspace-access", workspaceId, "join-sources", sourceKind, page],
    queryFn: () => request<WorkspaceStaffJoinSourceListResponse>(
      `/api/workspace-staff-enrollment/sources?sourceKind=${sourceKind}&page=${page}&pageSize=${SOURCE_PAGE_SIZE}`,
    ),
  });
  const sourceState = createCompositeSource({
    label: kind === "invitation" ? "Issued invitations" : "Issued team QR links",
    hasData: sources.data !== undefined,
    isLoading: sources.isLoading,
    error: sources.error,
    isFetching: sources.isFetching,
    refetch: () => sources.refetch(),
  });
  const sourcesUsable = compositeSourceUsable(sourceState.state);
  const sourcesCurrent = compositeSourceCurrent(sourceState);
  const replacementAllowed = workspaceAccessActionAllowed(
    "grant",
    canReplace,
    sourcesCurrent,
  );
  const management = useMutation({
    mutationFn: async ({ source, action }: { source: WorkspaceStaffJoinSource; action: "deny" | "replace" }) => {
      const base = source.sourceKind === 1 ? "invitations" : "enrollment-links";
      if (action === "replace") {
        if (!replacementAllowed) {
          throw new Error("Refresh the issued source and workspace authority before replacing it.");
        }
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
    <section className="border-t border-base-300 pt-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">
            {kind === "invitation" ? "Issued invitations" : "Issued team QR links"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-base-content/55">
            {kind === "invitation"
              ? "Review recipient links, revoke access, or replace a lost invitation safely."
              : "Review reusable links, disable enrollment, or replace a lost QR safely."}
          </p>
        </div>
      </div>
      <div className="mt-5">
        <CompositeSourceNotice
          sources={[sourceState]}
          title="Issued access links are delayed"
        />
      </div>
      {sourcesUsable ? (
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
                replacementAllowed={replacementAllowed}
                onAction={(action) => management.mutate({ source, action })}
              />
            ))}
          </div>
          <PaginationBar
            page={page}
            pageSize={SOURCE_PAGE_SIZE}
            itemCount={sources.data?.items.length ?? 0}
            itemLabel={kind === "invitation" ? "invitation" : "QR link"}
            hasMore={sources.data?.hasMore}
            disabled={!sourcesCurrent || management.isPending}
            onPageChange={setPage}
          />
          {management.error && <SettingsError error={management.error} />}
        </>
      ) : (
        <CompositeSourceFallback state={sourceState.state} label="issued access links" />
      )}
    </section>
  );
}

function JoinSourceRow({
  source,
  profiles,
  properties,
  pending,
  replacementAllowed,
  onAction,
}: {
  source: WorkspaceStaffJoinSource;
  profiles: WorkspaceAccessProfile[];
  properties: Property[];
  pending: boolean;
  replacementAllowed: boolean;
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
          <button
            className="btn btn-outline btn-sm"
            disabled={pending || !replacementAllowed}
            title={!replacementAllowed ? "Refresh the source and workspace authority before replacing it." : undefined}
            onClick={() => onAction("replace")}
          >
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

function LifetimeField({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block max-w-48">
      <span className="mb-1.5 block text-sm font-semibold">Lifetime (hours)</span>
      <input
        className="input input-bordered w-full"
        type="number"
        min={1}
        max={720}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function SettingsError({ error }: { error: unknown }) {
  return <div className="mt-5"><ErrorState error={error} /></div>;
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
