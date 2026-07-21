import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock3,
  Link2,
  LogOut,
  MailCheck,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import type {
  AuthenticationMethods,
  OrganizationEnrollmentOutcome,
  OrganizationEnrollmentPreview,
  OrganizationInvitationAcceptance,
  OrganizationInvitationPreview,
  WorkspaceStaffOnboarding,
} from "../../api/types";
import { emailVerificationEnabled } from "../../app/environment";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { StaffProfileFields } from "./StaffProfileFields";
import {
  clearInviteStaffDraft,
  readInviteStaffDraft,
  saveInviteStaffDraft,
  type StaffProfileDraft,
} from "./staffOnboarding";
import { waitForWorkspaceAccess } from "./workspaceAccess";
import {
  clearPreservedWorkspaceJoinSecret,
  isWorkspaceStaffOnboardingInProgress,
  isWorkspaceStaffOnboardingTerminallyDenied,
  parseWorkspaceJoinSecret,
  readPreservedWorkspaceJoinSecret,
  resolveEnrollmentJoin,
  workspaceJoinSourceKind,
  type WorkspaceJoinSecret,
  type WorkspaceJoinResolution,
} from "./workspaceJoin";

const PENDING_ENROLLMENT_KEY = "bunkfy.join.pending-enrollment.v2";

export function JoinWorkspacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, request, selectWorkspace, session } = useSession();
  const {
    refetchWorkspaces,
    setSelectedWorkspaceId,
    workspaces,
  } = useWorkspace();
  const secret: WorkspaceJoinSecret | null =
    parseWorkspaceJoinSecret(location.hash) ?? readPreservedWorkspaceJoinSecret();
  const secretKey = secret ? `${secret.kind}:${secret.token}` : "missing";
  const accountKey = session?.username ?? "";
  const isEnrollment = secret?.kind === "enrollment";
  const [staffProfile, setStaffProfile] = useState(() =>
    readInviteStaffDraft(session?.username),
  );
  const [pendingApproval, setPendingApproval] = useState(() =>
    secret?.kind === "enrollment" &&
      hasPendingEnrollment(secret.token, accountKey),
  );
  const preview = useQuery<
    OrganizationInvitationPreview | OrganizationEnrollmentPreview
  >({
    queryKey: ["workspace-join-preview", secret?.kind, secret?.token],
    queryFn: () => {
      if (!secret) throw new Error("This invitation link is incomplete.");
      return secret.kind === "invitation"
        ? request<OrganizationInvitationPreview>(
            "/api/organization-invitations/preview",
            {
              method: "POST",
              body: JSON.stringify({ token: secret.token }),
            },
          )
        : request<OrganizationEnrollmentPreview>(
            "/api/organization-enrollment/preview",
            {
              method: "POST",
              body: JSON.stringify({ token: secret.token }),
            },
          );
    },
    enabled: Boolean(secret),
    retry: false,
  });
  const data = preview.data;
  const sourceId = data && secret
    ? secret.kind === "invitation"
      ? (data as OrganizationInvitationPreview).invitationId
      : (data as OrganizationEnrollmentPreview).enrollmentLinkId
    : null;
  const staffApplication = useQuery<WorkspaceStaffOnboarding>({
    queryKey: [
      "workspace-staff-onboarding",
      data?.organizationId,
      secret?.kind,
      sourceId,
      accountKey,
    ],
    queryFn: () => request<WorkspaceStaffOnboarding>(
      `/api/workspace-staff-enrollment/${data?.organizationId}/applications/current` +
        `?sourceKind=${workspaceJoinSourceKind(secret!.kind)}&sourceId=${sourceId}`,
    ),
    enabled: Boolean(isEnrollment && data?.organizationId && sourceId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (pendingApproval || isWorkspaceStaffOnboardingInProgress(status)) return 15_000;
      return status === 6 ? 30_000 : false;
    },
    refetchIntervalInBackground: false,
  });
  const join = useMutation<WorkspaceJoinResolution>({
    mutationFn: async () => {
      if (!secret) throw new Error("This invitation link is incomplete.");

      await request<WorkspaceStaffOnboarding>(
        "/api/workspace-staff-enrollment/applications",
        {
          method: "POST",
          body: JSON.stringify({
            sourceKind: workspaceJoinSourceKind(secret.kind),
            token: secret.token,
            displayName: staffProfile.displayName.trim(),
            legalName: emptyToNull(staffProfile.legalName),
            workEmail: emptyToNull(staffProfile.workEmail),
            workPhone: emptyToNull(staffProfile.workPhone),
            employeeNumber: null,
            jobTitle: emptyToNull(staffProfile.jobTitle),
            department: emptyToNull(staffProfile.department),
          }),
        },
      );

      if (secret.kind === "invitation") {
        const acceptance = await request<OrganizationInvitationAcceptance>(
          "/api/organization-invitations/accept",
          {
            method: "POST",
            body: JSON.stringify({ token: secret.token }),
          },
        );
        const workspaceId = acceptance.membership.organization.organizationId;
        await activateWorkspace(workspaceId);
        return { kind: "joined", workspaceId };
      }

      const outcome = await request<OrganizationEnrollmentOutcome>(
        "/api/organization-enrollment/claim",
        {
          method: "POST",
          body: JSON.stringify({ token: secret.token }),
        },
      );
      const resolution = resolveEnrollmentJoin(outcome);
      if (resolution.kind === "joined") {
        await activateWorkspace(resolution.workspaceId);
      }
      return resolution;
    },
    onSuccess: (resolution) => {
      if (resolution.kind === "pending-approval") {
        rememberPendingEnrollment(secret?.token, accountKey);
        setPendingApproval(true);
        void staffApplication.refetch();
        return;
      }

      forgetPendingEnrollment(secret?.token, accountKey);
      setPendingApproval(false);
      clearPreservedWorkspaceJoinSecret();
      window.history.replaceState(null, "", "/");
      navigate("/", { replace: true });
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.code === "Organizations.EnrollmentClaimUnavailable"
      ) {
        forgetPendingEnrollment(secret?.token, accountKey);
        setPendingApproval(false);
      }
    },
  });
  const approvedActivation = useMutation({
    mutationFn: async (workspaceId: string) => {
      await activateWorkspace(workspaceId);
      return workspaceId;
    },
    onSuccess: () => {
      forgetPendingEnrollment(secret?.token, accountKey);
      setPendingApproval(false);
      clearPreservedWorkspaceJoinSecret();
      window.history.replaceState(null, "", "/");
      navigate("/", { replace: true });
    },
  });
  const resetJoin = join.reset;
  const resetApprovedActivation = approvedActivation.reset;

  useEffect(() => {
    setPendingApproval(
      secret?.kind === "enrollment" &&
        hasPendingEnrollment(secret.token, accountKey),
    );
    resetJoin();
    resetApprovedActivation();
  }, [accountKey, resetApprovedActivation, resetJoin, secret?.kind, secret?.token, secretKey]);

  useEffect(() => {
    const application = staffApplication.data;
    if (!application) return;

    if (isWorkspaceStaffOnboardingInProgress(application.status)) {
      setPendingApproval(true);
      return;
    }

    if (isWorkspaceStaffOnboardingTerminallyDenied(application.status)) {
      forgetPendingEnrollment(secret?.token, accountKey);
      setPendingApproval(false);
      clearPreservedWorkspaceJoinSecret();
      return;
    }

    if (application.status === 6) {
      setPendingApproval(false);
      return;
    }

    if (
      application.status === 5 &&
      !approvedActivation.isPending &&
      !approvedActivation.isSuccess
    ) {
      approvedActivation.mutate(application.organizationId);
    }
  }, [
    accountKey,
    approvedActivation,
    secret?.token,
    staffApplication.data,
  ]);

  async function activateWorkspace(workspaceId: string) {
    selectWorkspace(workspaceId);
    await waitForWorkspaceAccess(request, workspaceId);
    await refetchWorkspaces();
    setSelectedWorkspaceId(workspaceId);
    clearInviteStaffDraft(accountKey);
  }

  const alreadyJoined =
    join.error instanceof ApiError &&
    join.error.code === "Organizations.MembershipConflict";
  const verificationRequired =
    join.error instanceof ApiError &&
    (join.error.code === "Organizations.RecipientVerificationRequired" ||
      join.error.code === "Workspaces.VerifiedIdentityRequired");
  const requestRejected =
    (join.error instanceof ApiError &&
      join.error.code === "Organizations.EnrollmentClaimUnavailable") ||
    isWorkspaceStaffOnboardingTerminallyDenied(staffApplication.data?.status);
  const provisioningFailed = staffApplication.data?.status === 6;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    join.mutate();
  }

  function updateStaffProfile(profile: StaffProfileDraft) {
    setStaffProfile(profile);
    saveInviteStaffDraft(profile, accountKey);
  }

  function openWorkspace() {
    const workspaceId = data?.organizationId;
    if (
      workspaceId &&
      workspaces.some(
        (item) => item.organization.organizationId === workspaceId,
      )
    ) {
      selectWorkspace(workspaceId);
      setSelectedWorkspaceId(workspaceId);
    }
    clearPreservedWorkspaceJoinSecret();
    navigate("/", { replace: true });
  }

  function leaveJoin() {
    clearPreservedWorkspaceJoinSecret();
    navigate("/", { replace: true });
  }

  return (
    <main className="min-h-screen bg-base-200 p-4 sm:p-8">
      <section className="mx-auto w-full max-w-2xl border border-base-300 bg-base-100 p-7 shadow-sm sm:p-10">
        <div className="flex items-center justify-between gap-3">
          <button
            className="btn btn-circle btn-ghost btn-sm"
            onClick={leaveJoin}
            aria-label="Back to BunkFy"
          >
            <ArrowLeft size={19} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void logout()}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
        <div className="mt-6 flex items-center gap-3 text-primary">
          {data ? <Building2 size={26} /> : <Link2 size={26} />}
          <p className="text-xs font-bold uppercase">
            {isEnrollment ? "Team access" : "Workspace invitation"}
          </p>
        </div>
        <h1 className="mt-4 font-display text-3xl font-semibold">
          {data ? `Join ${data.organizationName}` : "Open an invitation"}
        </h1>

        {!secret && (
          <p className="mt-4 text-sm leading-6 text-base-content/60">
            Open the complete link or scan the QR code provided by your
            workspace owner.
          </p>
        )}
        {preview.isLoading && (
          <div className="mt-8 flex items-center gap-3 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" />
            Checking the invitation
          </div>
        )}
        {preview.error && (
          <div className="alert alert-error mt-6 text-sm">
            {preview.error instanceof Error
              ? preview.error.message
              : "The invitation is unavailable."}
          </div>
        )}
        {data && (
          <form className="mt-6" onSubmit={submit}>
            <div className="border-y border-base-300 py-5">
              <p className="font-semibold">{data.organizationName}</p>
              <p className="mt-1 text-sm text-base-content/50">
                {data.organizationSlug}
              </p>
              <p className="mt-3 text-xs text-base-content/45">
                {isEnrollment ? "Team link" : "Invitation"} expires{" "}
                {new Date(data.expiresAtUtc).toLocaleString()}
              </p>
            </div>
            <div className="py-6">
              <h2 className="font-display text-xl font-semibold">
                Your staff profile
              </h2>
              <p className="mb-5 mt-1 text-sm leading-6 text-base-content/50">
                Review the contact details your team will see after you join.
              </p>
              <StaffProfileFields
                value={staffProfile}
                onChange={updateStaffProfile}
              />
            </div>

            {pendingApproval && (
              <div className="rounded-lg border border-info/25 bg-info/8 p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-info/12 text-info">
                    <Clock3 size={19} />
                  </span>
                  <div>
                    <h2 className="font-display text-lg font-semibold">
                      Request sent
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-base-content/60">
                      A workspace owner must approve this QR request. BunkFy
                      checks periodically while this page is open.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm mt-4"
                  onClick={() => void staffApplication.refetch()}
                  disabled={staffApplication.isFetching}
                >
                  {staffApplication.isFetching && (
                    <span className="loading loading-spinner loading-xs" />
                  )}
                  Check approval now
                </button>
              </div>
            )}

            {provisioningFailed && (
              <div className="rounded-lg border border-warning/30 bg-warning/8 p-5 text-sm text-base-content">
                <p>
                  Staff access could not be finished automatically. A workspace
                  owner can retry this request from Workspace settings.
                </p>
                <button
                  type="button"
                  className="btn btn-outline btn-sm mt-4"
                  onClick={() => void staffApplication.refetch()}
                  disabled={staffApplication.isFetching}
                >
                  {staffApplication.isFetching && (
                    <span className="loading loading-spinner loading-xs" />
                  )}
                  Check status
                </button>
              </div>
            )}

            {verificationRequired && (
              <InvitationVerificationRecovery
                request={request}
                onVerified={() => {
                  resetJoin();
                  join.mutate();
                }}
              />
            )}
            {requestRejected && (
              <div className="alert alert-error text-sm">
                This access request is no longer available. Ask the workspace
                owner to create a new team QR.
              </div>
            )}
            {join.error &&
              !verificationRequired &&
              !requestRejected &&
              !pendingApproval && (
                <div className="alert alert-error text-sm">
                  {alreadyJoined
                    ? "You already belong to this workspace."
                    : join.error.message}
                </div>
              )}
            {approvedActivation.error && (
              <div className="alert alert-error text-sm">
                {approvedActivation.error.message}
              </div>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => navigate("/", { replace: true })}
              >
                Back to BunkFy
              </button>
              {alreadyJoined ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={openWorkspace}
                >
                  Open workspace
                </button>
              ) : !pendingApproval && !requestRejected ? (
                <button
                  className="btn btn-primary"
                  disabled={
                    join.isPending ||
                    approvedActivation.isPending ||
                    !staffProfile.displayName.trim()
                  }
                >
                  {join.isPending ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                  {isEnrollment ? "Request access" : "Join workspace"}
                </button>
              ) : null}
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

type VerificationAction =
  | { kind: "send"; emailId: string }
  | { kind: "confirm"; code: string };

function InvitationVerificationRecovery({
  request,
  onVerified,
}: {
  request: ReturnType<typeof useSession>["request"];
  onVerified: () => void;
}) {
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const methods = useQuery({
    queryKey: ["auth", "methods", "workspace-invitation"],
    queryFn: () => request<AuthenticationMethods>("/api/auth/methods"),
    enabled: emailVerificationEnabled,
    retry: false,
  });
  const activeEmail = methods.data?.emails.find(
    (email) => email.isActive && !email.isVerified,
  );
  const verification = useMutation({
    mutationFn: (action: VerificationAction) =>
      action.kind === "send"
        ? request<void>("/api/auth/email-verification", {
            method: "POST",
            body: JSON.stringify({ emailId: action.emailId }),
          })
        : request<void>("/api/auth/email-verification/confirm", {
            method: "POST",
            body: JSON.stringify({ code: action.code }),
          }),
    onSuccess: async (_result, action) => {
      if (action.kind === "send") {
        setCodeSent(true);
        return;
      }
      await methods.refetch();
      onVerified();
    },
  });

  if (!emailVerificationEnabled) {
    return (
      <div className="alert border border-warning/30 bg-warning/8 text-sm text-base-content">
        <MailCheck className="text-warning" size={19} />
        <span>
          This link is restricted to a verified email, but email delivery is
          disabled in this deployment. Ask the owner for an invite without an
          email restriction, or use the team QR.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/8 p-5">
      <div className="flex items-start gap-3">
        <MailCheck className="mt-0.5 shrink-0 text-warning" size={19} />
        <div>
          <h2 className="font-display text-lg font-semibold">
            Verify your invited email
          </h2>
          <p className="mt-1 text-sm leading-6 text-base-content/60">
            This invitation is email-bound. Verify the active address on this
            account, then BunkFy will continue joining the workspace.
          </p>
        </div>
      </div>

      {methods.isLoading && (
        <span className="loading loading-spinner loading-sm mt-4 text-primary" />
      )}
      {methods.error && (
        <div className="alert alert-error mt-4 text-sm">
          {methods.error.message}
        </div>
      )}
      {!methods.isLoading && !activeEmail && (
        <p className="mt-4 text-sm leading-6 text-base-content/60">
          This account has no active unverified email. Sign out and use the
          invited account, or ask the owner to issue another link.
        </p>
      )}
      {activeEmail && !codeSent && (
        <button
          type="button"
          className="btn btn-outline btn-sm mt-4"
          disabled={verification.isPending}
          onClick={() =>
            verification.mutate({ kind: "send", emailId: activeEmail.id })
          }
        >
          {verification.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Send code to {activeEmail.email}
        </button>
      )}
      {activeEmail && codeSent && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            className="input input-bordered flex-1 bg-base-100"
            aria-label="Verification code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Verification code"
            autoComplete="one-time-code"
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={verification.isPending || !code.trim()}
            onClick={() =>
              verification.mutate({ kind: "confirm", code: code.trim() })
            }
          >
            {verification.isPending && (
              <span className="loading loading-spinner loading-xs" />
            )}
            Verify and continue
          </button>
        </div>
      )}
      {verification.error && (
        <div className="alert alert-error mt-4 text-sm">
          {verification.error.message}
        </div>
      )}
    </div>
  );
}

function hasPendingEnrollment(token: string, identity: string): boolean {
  return window.sessionStorage.getItem(pendingEnrollmentKey(identity)) === token;
}

function rememberPendingEnrollment(
  token: string | undefined,
  identity: string,
): void {
  if (token) {
    window.sessionStorage.setItem(pendingEnrollmentKey(identity), token);
  }
}

function forgetPendingEnrollment(
  token: string | undefined,
  identity: string,
): void {
  if (token && hasPendingEnrollment(token, identity)) {
    window.sessionStorage.removeItem(pendingEnrollmentKey(identity));
  }
}

function pendingEnrollmentKey(identity: string): string {
  const account = identity.trim().toLowerCase() || "anonymous";
  return `${PENDING_ENROLLMENT_KEY}:${encodeURIComponent(account)}`;
}

function emptyToNull(value: string): string | null {
  return value.trim() || null;
}
