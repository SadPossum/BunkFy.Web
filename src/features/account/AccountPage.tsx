import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  Clock3,
  KeyRound,
  Link2,
  LogOut,
  Mail,
  MonitorSmartphone,
  ShieldCheck,
  ShieldOff,
  Unlink,
  UserRound,
} from "lucide-react";

const emailVerificationEnabled =
  import.meta.env.VITE_BUNKFY_EMAIL_VERIFICATION_ENABLED === "true";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  AuthenticationMethods,
  AuthenticationSessions,
  ExternalAuthenticationProviderList,
  ExternalIdentity,
  StaffMember,
} from "../../api/types";
import { useSession } from "../../app/session";
import { focusedResourceClass, useTransientResourceFocus } from "../../app/resourceFocus";
import { useWorkspace } from "../../app/workspace";
import {
  ErrorState,
  InitialAvatar,
  LoadingState,
  PageHeader,
  StatusBadge,
} from "../../components/ui/primitives";
import { StaffProfileFields } from "../workspaces/StaffProfileFields";
import type { StaffProfileDraft } from "../workspaces/staffOnboarding";

type SecurityAction =
  | {
      kind: "set-password";
      newPassword: string;
      currentPassword: string | null;
    }
  | { kind: "remove-password"; currentPassword: string }
  | { kind: "request-verification"; emailId: string }
  | { kind: "confirm-verification"; code: string }
  | {
      kind: "unlink-provider";
      identityId: string;
      currentPassword: string | null;
    };

type SecurityMutation = UseMutationResult<void, Error, SecurityAction>;

export function AccountPage() {
  const { beginExternalLink, logout, logoutAll, request, session } =
    useSession();
  const { selectedWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const methods = useQuery({
    queryKey: ["auth", "methods", session?.tenantId],
    queryFn: () => request<AuthenticationMethods>("/api/auth/methods"),
  });
  const providers = useQuery({
    queryKey: ["auth", "external-providers"],
    queryFn: () =>
      request<ExternalAuthenticationProviderList>(
        "/api/auth/external/providers",
      ),
    staleTime: 5 * 60_000,
  });
  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: () => request<AuthenticationSessions>("/api/auth/sessions"),
  });
  const staffProfile = useQuery({
    queryKey: ["staff", "me", session?.tenantId],
    queryFn: () => request<StaffMember>("/api/staff/me"),
    retry: false,
  });
  const focusedResourceId = useTransientResourceFocus(Boolean(staffProfile.data));
  const [confirmAll, setConfirmAll] = useState(false);
  const [submittingSession, setSubmittingSession] = useState<
    "current" | "all" | null
  >(null);
  const [sessionError, setSessionError] = useState<unknown>(null);
  const [passwordAction, setPasswordAction] = useState<"set" | "remove" | null>(
    null,
  );
  const [unlinkIdentity, setUnlinkIdentity] = useState<ExternalIdentity | null>(
    null,
  );
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    if (parameters.get("external") === "linked") {
      setNotice("External account linked.");
      window.history.replaceState(null, "", "/account");
      void queryClient.invalidateQueries({ queryKey: ["auth", "methods"] });
    }
  }, [queryClient]);

  const security = useMutation({
    mutationFn: async (action: SecurityAction) => {
      if (action.kind === "set-password") {
        return request<void>("/api/auth/password", {
          method: "PUT",
          body: JSON.stringify({
            newPassword: action.newPassword,
            currentPassword: action.currentPassword,
          }),
        });
      }
      if (action.kind === "remove-password") {
        return request<void>("/api/auth/password/remove", {
          method: "POST",
          body: JSON.stringify({ currentPassword: action.currentPassword }),
        });
      }
      if (action.kind === "request-verification") {
        return request<void>("/api/auth/email-verification", {
          method: "POST",
          body: JSON.stringify({ emailId: action.emailId }),
        });
      }
      if (action.kind === "confirm-verification") {
        return request<void>("/api/auth/email-verification/confirm", {
          method: "POST",
          body: JSON.stringify({ code: action.code }),
        });
      }
      return request<void>(
        `/api/auth/external-identities/${action.identityId}/unlink`,
        {
          method: "POST",
          body: JSON.stringify({ currentPassword: action.currentPassword }),
        },
      );
    },
    onSuccess: async (_result, action) => {
      setNotice(actionNotice(action.kind));
      setPasswordAction(null);
      setUnlinkIdentity(null);
      await queryClient.invalidateQueries({ queryKey: ["auth", "methods"] });
    },
  });
  const revokeSession = useMutation({
    mutationFn: (sessionId: string) => request<void>(
      `/api/auth/sessions/${sessionId}/sign-out`,
      { method: "POST" },
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
  });

  async function signOut(mode: "current" | "all") {
    setSubmittingSession(mode);
    setSessionError(null);
    try {
      if (mode === "all") await logoutAll();
      else await logout();
    } catch (caught) {
      setSessionError(caught);
      setSubmittingSession(null);
    }
  }

  async function linkProvider(provider: string) {
    setLinkingProvider(provider);
    security.reset();
    try {
      await beginExternalLink(provider);
    } catch (caught) {
      setLinkingProvider(null);
      setSessionError(caught);
    }
  }

  const authentication = methods.data;
  const linkedProviderCodes = new Set(
    authentication?.externalIdentities.map(
      (identity) => identity.providerCode,
    ) ?? [],
  );
  const availableProviders = (providers.data?.providers ?? []).filter(
    (provider) => !linkedProviderCodes.has(provider),
  );

  return (
    <>
      <PageHeader
        eyebrow="Personal settings"
        title="Account"
        description="Manage your profile, sign-in methods, and active sessions."
      />
      {notice && (
        <div className="alert border border-success/25 bg-success/8 text-sm">
          <BadgeCheck size={18} className="text-success" />
          <span>{notice}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs ml-auto"
            onClick={() => setNotice("")}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body p-6">
            <div className="flex items-center gap-4">
              <InitialAvatar name={session?.username} variant="solid" />
              <div className="min-w-0">
                <h2 className="truncate font-display text-xl font-semibold">
                  {session?.username}
                </h2>
                <p className="mt-1 text-sm text-base-content/50">Your BunkFy account</p>
              </div>
            </div>
            <div className="my-3 h-px bg-base-300" />
            <div className="space-y-3">
              <AccountRow
                icon={<UserRound />}
                label="Email address"
                value={session?.username || "Unknown"}
              />
              <AccountRow
                icon={<Building2 />}
                label="Current workspace"
                value={selectedWorkspace?.organization.name || "No workspace selected"}
              />
              <AccountRow
                icon={<ShieldCheck />}
                label="Staff profile"
                value={staffProfile.data?.displayName || (staffProfile.isLoading ? "Loading..." : "Not ready")}
              />
              <AccountRow
                icon={<Clock3 />}
                label="Member since"
                value={staffProfile.data ? new Date(staffProfile.data.createdAtUtc).toLocaleDateString() : "Unavailable"}
              />
            </div>
          </div>
        </section>

        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body p-6">
            <div className="flex items-start gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <MonitorSmartphone size={21} />
              </div>
              <div>
                <h2 className="font-display text-xl font-semibold">
                  Active sessions
                </h2>
                <p className="mt-1 text-sm leading-6 text-base-content/55">
                  Review where your account is signed in and sign out any device
                  you no longer use.
                </p>
              </div>
            </div>
            {Boolean(sessionError) && <ErrorState error={sessionError} />}
            {sessions.isLoading ? (
              <div className="mt-5"><LoadingState label="Loading active sessions" /></div>
            ) : sessions.error ? (
              <div className="mt-5"><ErrorState error={sessions.error} retry={() => void sessions.refetch()} /></div>
            ) : (
              <div className="mt-5 divide-y divide-base-300 rounded-lg border border-base-300">
                {(sessions.data?.sessions ?? []).map((item) => (
                  <div key={item.sessionId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{authenticationMethodLabel(item.authenticationMethod)}</p>
                        {item.isCurrent && <span className="badge badge-sm border-0 bg-primary font-semibold text-white">This browser</span>}
                      </div>
                      <p className="mt-1 text-xs text-base-content/50">
                        Signed in {new Date(item.loginDateTimeUtc).toLocaleString()} · active until {new Date(item.refreshTokenExpiresAtUtc).toLocaleDateString()}
                      </p>
                    </div>
                    {!item.isCurrent && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-error"
                        disabled={revokeSession.isPending}
                        onClick={() => revokeSession.mutate(item.sessionId)}
                      >
                        <LogOut size={15} />
                        Sign out
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {revokeSession.error && <div className="mt-4"><ErrorState error={revokeSession.error} /></div>}
            {!confirmAll ? (
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void signOut("current")}
                  disabled={submittingSession != null}
                >
                  <LogOut size={16} />
                  {submittingSession === "current"
                    ? "Signing out..."
                    : "Sign out this browser"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-error"
                  onClick={() => setConfirmAll(true)}
                  disabled={submittingSession != null}
                >
                  Sign out everywhere
                </button>
              </div>
            ) : (
              <div className="mt-6 border border-warning/30 bg-warning/8 p-4">
                <h3 className="font-semibold">Sign out on every device?</h3>
                <p className="mt-1 text-sm leading-6 text-base-content/60">
                  All refresh sessions will be revoked, including this browser.
                  You will need to sign in again everywhere.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setConfirmAll(false)}
                    disabled={submittingSession != null}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-error btn-sm"
                    onClick={() => void signOut("all")}
                    disabled={submittingSession != null}
                  >
                    {submittingSession === "all" && (
                      <span className="loading loading-spinner loading-xs" />
                    )}
                    Sign out everywhere
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {staffProfile.data && (
        <StaffProfilePanel
          member={staffProfile.data}
          focused={focusedResourceId === "workspace-profile"}
          request={request}
          onUpdated={(updated) => queryClient.setQueryData(["staff", "me", session?.tenantId], updated)}
        />
      )}

      {methods.isLoading ? (
        <LoadingState label="Loading account security" />
      ) : methods.error ? (
        <div className="mt-6">
          <ErrorState
            error={methods.error}
            retry={() => void methods.refetch()}
          />
        </div>
      ) : (
        authentication && (
          <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
            <PasswordPanel
              methods={authentication}
              action={passwordAction}
              mutation={security}
              onAction={setPasswordAction}
            />
            <EmailPanel methods={authentication} mutation={security} />
            <ProviderPanel
              methods={authentication}
              availableProviders={availableProviders}
              linkingProvider={linkingProvider}
              unlinkIdentity={unlinkIdentity}
              mutation={security}
              onLink={linkProvider}
              onUnlink={setUnlinkIdentity}
            />
          </div>
        )
      )}
    </>
  );
}

function StaffProfilePanel({
  member,
  focused,
  request,
  onUpdated,
}: {
  member: StaffMember;
  focused: boolean;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  onUpdated: (member: StaffMember) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState<StaffProfileDraft>(() => staffDraft(member));
  useEffect(() => setProfile(staffDraft(member)), [member]);
  const update = useMutation({
    mutationFn: () => request<StaffMember>("/api/staff/me", {
      method: "PUT",
      body: JSON.stringify({
        ...profile,
        legalName: profile.legalName.trim() || null,
        workEmail: profile.workEmail.trim() || null,
        workPhone: profile.workPhone.trim() || null,
        employeeNumber: member.employeeNumber ?? null,
        jobTitle: profile.jobTitle.trim() || null,
        department: profile.department.trim() || null,
        expectedVersion: member.version,
      }),
    }),
    onSuccess: (updated) => {
      onUpdated(updated);
      setEditing(false);
    },
  });

  return (
    <section className={`card mt-6 border border-base-300 bg-base-100 shadow-sm ${focused ? focusedResourceClass : ""}`}>
      <div className="flex flex-col gap-3 border-b border-base-300 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="font-display text-xl font-semibold">Workspace profile</h2>
          <p className="mt-1 text-sm text-base-content/50">Contact and role details visible to your team.</p>
        </div>
        {!editing && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>
            Edit profile
          </button>
        )}
      </div>
      <div className="p-5 sm:p-6">
        {editing ? (
          <form onSubmit={(event) => { event.preventDefault(); update.mutate(); }}>
            <StaffProfileFields value={profile} onChange={setProfile} />
            {update.error && <div className="mt-4"><ErrorState error={update.error} /></div>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => { setProfile(staffDraft(member)); setEditing(false); update.reset(); }} disabled={update.isPending}>Cancel</button>
              <button className="btn btn-primary" disabled={update.isPending || !profile.displayName.trim()}>
                {update.isPending && <span className="loading loading-spinner loading-sm" />}
                Save profile
              </button>
            </div>
          </form>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AccountRow icon={<UserRound />} label="Display name" value={member.displayName} />
            <AccountRow icon={<Mail />} label="Work email" value={member.workEmail || "Not provided"} />
            <AccountRow icon={<KeyRound />} label="Job title" value={member.jobTitle || "Not provided"} />
          </div>
        )}
      </div>
    </section>
  );
}

function staffDraft(member: StaffMember): StaffProfileDraft {
  return {
    displayName: member.displayName,
    legalName: member.legalName ?? "",
    workEmail: member.workEmail ?? "",
    workPhone: member.workPhone ?? "",
    jobTitle: member.jobTitle ?? "",
    department: member.department ?? "",
  };
}

function authenticationMethodLabel(value: string): string {
  return value.toLowerCase() === "password"
    ? "Password sign-in"
    : `${providerLabel(value)} sign-in`;
}

function PasswordPanel({
  methods,
  action,
  mutation,
  onAction,
}: {
  methods: AuthenticationMethods;
  action: "set" | "remove" | null;
  mutation: SecurityMutation;
  onAction: (action: "set" | "remove" | null) => void;
}) {
  const [validationError, setValidationError] = useState("");

  function setPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("newPassword") ?? "");
    if (password !== String(data.get("confirmPassword") ?? "")) {
      setValidationError("Passwords do not match.");
      return;
    }
    setValidationError("");
    mutation.mutate({
      kind: "set-password",
      newPassword: password,
      currentPassword: methods.hasPassword
        ? String(data.get("currentPassword") ?? "")
        : null,
    });
  }

  function removePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      kind: "remove-password",
      currentPassword: String(
        new FormData(event.currentTarget).get("currentPassword") ?? "",
      ),
    });
  }

  const canRemove =
    methods.hasPassword && methods.externalIdentities.length > 0;
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <KeyRound size={20} />
            </span>
            <div>
              <h2 className="font-display text-xl font-semibold">Password</h2>
              <p className="mt-1 text-sm leading-6 text-base-content/55">
              {methods.hasPassword
                ? "A password is configured for this account."
                : "This account currently signs in through an external provider."}
              </p>
            </div>
          </div>
          <StatusBadge
            status={methods.hasPassword ? "configured" : "not set"}
          />
        </div>
        {!action && (
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-5">
            {canRemove && (
              <button
                type="button"
                className="btn btn-ghost btn-sm text-error"
                onClick={() => onAction("remove")}
              >
                <ShieldOff size={15} />
                Remove password
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onAction("set")}
            >
              <KeyRound size={15} />
              {methods.hasPassword ? "Change password" : "Add password"}
            </button>
          </div>
        )}
        {action === "set" && (
          <form
            className="mt-6 space-y-4 border-t border-base-300 pt-5"
            onSubmit={setPassword}
          >
            {methods.hasPassword && (
              <PasswordInput
                name="currentPassword"
                label="Current password"
                autoComplete="current-password"
              />
            )}
            <PasswordInput
              name="newPassword"
              label="New password"
              autoComplete="new-password"
            />
            <PasswordInput
              name="confirmPassword"
              label="Confirm new password"
              autoComplete="new-password"
            />
            {validationError && (
              <div className="alert alert-error py-3 text-sm">
                <span>{validationError}</span>
              </div>
            )}
            {mutation.error && <ErrorState error={mutation.error} />}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setValidationError("");
                  onAction(null);
                  mutation.reset();
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={mutation.isPending}
              >
                {mutation.isPending && (
                  <span className="loading loading-spinner loading-xs" />
                )}
                Save password
              </button>
            </div>
          </form>
        )}
        {action === "remove" && (
          <form
            className="mt-6 space-y-4 border border-warning/30 bg-warning/8 p-4"
            onSubmit={removePassword}
          >
            <p className="text-sm leading-6">
              External sign-in will remain available, but password sign-in will
              stop immediately.
            </p>
            <PasswordInput
              name="currentPassword"
              label="Current password"
              autoComplete="current-password"
            />
            {mutation.error && <ErrorState error={mutation.error} />}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  onAction(null);
                  mutation.reset();
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-error btn-sm"
                disabled={mutation.isPending}
              >
                Remove password
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function EmailPanel({
  methods,
  mutation,
}: {
  methods: AuthenticationMethods;
  mutation: SecurityMutation;
}) {
  const [confirming, setConfirming] = useState(false);
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      kind: "confirm-verification",
      code: String(new FormData(event.currentTarget).get("code") ?? "").trim(),
    });
  }
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Mail size={20} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold">
              Email verification
            </h2>
            <p className="mt-1 text-sm leading-6 text-base-content/55">
              Verified addresses can receive security and account messages.
            </p>
          </div>
        </div>
        <div className="mt-5 divide-y divide-base-300 border-y border-base-300">
          {methods.emails.map((email) => (
            <div
              key={email.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{email.email}</p>
                <p className="mt-1 text-xs text-base-content/45">
                  {email.isActive ? "Active address" : "Inactive address"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge
                  status={email.isVerified ? "verified" : "unverified"}
                />
                {emailVerificationEnabled && !email.isVerified && email.isActive && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs text-primary"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        kind: "request-verification",
                        emailId: email.id,
                      })
                    }
                  >
                    <Mail size={14} />
                    Send code
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {!methods.emails.length && (
          <p className="mt-5 border border-dashed border-base-300 p-5 text-center text-sm text-base-content/50">
            No email address is attached to this account.
          </p>
        )}
        {mutation.error && (
          <div className="mt-4">
            <ErrorState error={mutation.error} />
          </div>
        )}
        {emailVerificationEnabled &&
          methods.emails.some((email) => !email.isVerified) &&
          (!confirming ? (
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setConfirming(true)}
              >
                <BadgeCheck size={15} />
                Enter verification code
              </button>
            </div>
          ) : (
            <form
              className="mt-5 border-t border-base-300 pt-5"
              onSubmit={confirm}
            >
              <label className="form-control block">
                <span className="label-text mb-1.5 block text-sm font-semibold">
                  Verification code
                </span>
                <input
                  name="code"
                  className="input input-bordered w-full font-mono"
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={mutation.isPending}
                >
                  Verify email
                </button>
              </div>
            </form>
          ))}
      </div>
    </section>
  );
}

function ProviderPanel({
  methods,
  availableProviders,
  linkingProvider,
  unlinkIdentity,
  mutation,
  onLink,
  onUnlink,
}: {
  methods: AuthenticationMethods;
  availableProviders: string[];
  linkingProvider: string | null;
  unlinkIdentity: ExternalIdentity | null;
  mutation: SecurityMutation;
  onLink: (provider: string) => Promise<void>;
  onUnlink: (identity: ExternalIdentity | null) => void;
}) {
  function unlink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unlinkIdentity) return;
    mutation.mutate({
      kind: "unlink-provider",
      identityId: unlinkIdentity.id,
      currentPassword: methods.hasPassword
        ? String(new FormData(event.currentTarget).get("currentPassword") ?? "")
        : null,
    });
  }
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm xl:col-span-2">
      <div className="card-body p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Link2 size={20} />
            </span>
            <div>
              <h2 className="font-display text-xl font-semibold">
                External accounts
              </h2>
              <p className="mt-1 text-sm leading-6 text-base-content/55">
                Link optional identity providers without merging accounts by
                email.
              </p>
            </div>
          </div>
          {availableProviders.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {availableProviders.map((provider) => (
                <button
                  key={provider}
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={linkingProvider !== null}
                  onClick={() => void onLink(provider)}
                >
                  {linkingProvider === provider ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <Link2 size={15} />
                  )}
                  Link {providerLabel(provider)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-5 divide-y divide-base-300 border-y border-base-300">
          {methods.externalIdentities.map((identity) => (
            <div
              key={identity.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div>
                <p className="font-semibold">
                  {providerLabel(identity.providerCode)}
                </p>
                <p className="mt-1 text-xs text-base-content/45">
                  Linked {formatDateTime(identity.linkedAtUtc)}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-error"
                onClick={() => onUnlink(identity)}
              >
                <Unlink size={15} />
                Unlink
              </button>
            </div>
          ))}
        </div>
        {!methods.externalIdentities.length && (
          <div className="mt-5 flex items-center gap-3 rounded-lg bg-base-200/70 p-4 text-sm text-base-content/55">
            <Link2 size={18} className="shrink-0 text-base-content/35" />
            No external accounts are linked.
          </div>
        )}
        {unlinkIdentity && (
          <form
            className="mt-5 border border-warning/30 bg-warning/8 p-4"
            onSubmit={unlink}
          >
            <h3 className="font-semibold">
              Unlink {providerLabel(unlinkIdentity.providerCode)}?
            </h3>
            <p className="mt-1 text-sm leading-6 text-base-content/60">
              BunkFy will reject this change if it would leave the account
              without a sign-in method.
            </p>
            {methods.hasPassword && (
              <div className="mt-4">
                <PasswordInput
                  name="currentPassword"
                  label="Current password"
                  autoComplete="current-password"
                />
              </div>
            )}
            {mutation.error && (
              <div className="mt-4">
                <ErrorState error={mutation.error} />
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  onUnlink(null);
                  mutation.reset();
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-error btn-sm"
                disabled={mutation.isPending}
              >
                Unlink account
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function PasswordInput({
  name,
  label,
  autoComplete,
}: {
  name: string;
  label: string;
  autoComplete: string;
}) {
  return (
    <label className="form-control block">
      <span className="label-text mb-1.5 block text-sm font-semibold">
        {label}
      </span>
      <input
        name={name}
        type="password"
        className="input input-bordered w-full"
        minLength={8}
        autoComplete={autoComplete}
        required
      />
    </label>
  );
}
function AccountRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-base-200/70 p-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-base-100 text-primary shadow-xs [&>svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-base-content/40">{label}</p>
        <p className="mt-1 break-all text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}
function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function actionNotice(kind: SecurityAction["kind"]): string {
  return (
    {
      "set-password": "Password updated.",
      "remove-password": "Password removed.",
      "request-verification": "Verification code requested.",
      "confirm-verification": "Email address verified.",
      "unlink-provider": "External account unlinked.",
    } as const
  )[kind];
}
