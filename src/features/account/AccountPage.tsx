import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  BadgeCheck,
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
  ExternalAuthenticationProviderList,
  ExternalIdentity,
} from "../../api/types";
import { useSession } from "../../app/session";
import {
  ErrorState,
  InitialAvatar,
  LoadingState,
  PageHeader,
  StatusBadge,
} from "../../components/ui/primitives";

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
  const queryClient = useQueryClient();
  const tenant = useQuery({
    queryKey: ["tenant-current", session?.tenantId],
    queryFn: () =>
      request<{ tenantId: string; isEnabled: boolean }>("/api/tenants/current"),
  });
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
        description="Review your workspace identity, authentication methods, and signed-in sessions."
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

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <section className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body p-6">
            <div className="flex items-center gap-4">
              <InitialAvatar name={session?.username} variant="solid" />
              <div className="min-w-0">
                <h2 className="truncate font-display text-xl font-semibold">
                  {session?.username}
                </h2>
                <p className="mt-1 text-sm text-base-content/50">
                  Current sign-in identity
                </p>
              </div>
            </div>
            <div className="my-3 h-px bg-base-300" />
            <div className="space-y-3">
              <AccountRow
                icon={<UserRound />}
                label="Username"
                value={session?.username || "Unknown"}
              />
              <AccountRow
                icon={<ShieldCheck />}
                label="Tenant"
                value={tenant.data?.tenantId || session?.tenantId || "Unknown"}
              />
              <AccountRow
                icon={<ShieldCheck />}
                label="Tenant scoping"
                value={
                  tenant.isLoading
                    ? "Checking..."
                    : tenant.data?.isEnabled
                      ? "Enabled"
                      : "Unavailable"
                }
              />
              <AccountRow
                icon={<KeyRound />}
                label="Session storage"
                value="Secure browser cookie + in-memory access"
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
                  Signed-in sessions
                </h2>
                <p className="mt-1 text-sm leading-6 text-base-content/55">
                  Sign out this browser, or revoke every active refresh session
                  for your account.
                </p>
              </div>
            </div>
            {Boolean(sessionError) && <ErrorState error={sessionError} />}
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
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
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
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">Password</h2>
            <p className="mt-1 text-sm text-base-content/55">
              {methods.hasPassword
                ? "A password is configured for this account."
                : "This account currently signs in through an external provider."}
            </p>
          </div>
          <StatusBadge
            status={methods.hasPassword ? "configured" : "not set"}
          />
        </div>
        {!action && (
          <div className="mt-6 flex flex-wrap justify-end gap-2">
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
        <div>
          <h2 className="font-display text-xl font-semibold">
            Email verification
          </h2>
          <p className="mt-1 text-sm text-base-content/55">
            Verified addresses can receive security and account messages.
          </p>
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
                <span className="label-text mb-2 block text-sm font-semibold">
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">
              External accounts
            </h2>
            <p className="mt-1 text-sm text-base-content/55">
              Link optional identity providers without merging accounts by
              email.
            </p>
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
          <p className="mt-5 border border-dashed border-base-300 p-5 text-center text-sm text-base-content/50">
            No external accounts are linked.
          </p>
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
      <span className="label-text mb-2 block text-sm font-semibold">
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
    <div className="flex items-start gap-3 border border-base-300 p-4">
      <span className="mt-0.5 text-primary">{icon}</span>
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
