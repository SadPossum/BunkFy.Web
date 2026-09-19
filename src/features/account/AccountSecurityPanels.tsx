import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { BadgeCheck, Copy, KeyRound, Link2, Mail, ShieldOff, Smartphone, Unlink } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  AuthenticationMethods,
  ExternalIdentity,
  MultiFactorCodeType,
  MultiFactorStatus,
  TotpEnrollment,
} from "../../api/types";
import type { CompositeSourceState } from "../../app/compositeSourceState";
import { useProductCapabilities } from "../../app/productCapabilities";
import { useSession } from "../../app/session";
import { CompositeSourceFallback } from "../../components/ui/CompositeSourceNotice";
import { ErrorState, StatusBadge } from "../../components/ui/primitives";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { authPasswordLengthHelp, authPasswordPolicy } from "../auth/authPasswordPolicy";

export type SecurityAction =
  | { kind: "set-password"; newPassword: string; currentPassword: string | null }
  | { kind: "remove-password"; currentPassword: string }
  | { kind: "request-verification"; emailId: string }
  | { kind: "confirm-verification"; code: string }
  | { kind: "unlink-provider"; identityId: string; currentPassword: string | null };

export type SecurityMutation = UseMutationResult<void, Error, SecurityAction>;

export function PasswordPanel({
  methods,
  action,
  mutation,
  canMutate,
  onAction,
}: {
  methods: AuthenticationMethods;
  action: "set" | "remove" | null;
  mutation: SecurityMutation;
  canMutate: boolean;
  onAction: (action: "set" | "remove" | null) => void;
}) {
  const [validationError, setValidationError] = useState("");
  const passwordError = mutation.variables?.kind === "set-password" || mutation.variables?.kind === "remove-password"
    ? mutation.error
    : null;

  function setPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) return;
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
      currentPassword: methods.hasPassword ? String(data.get("currentPassword") ?? "") : null,
    });
  }

  function removePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) return;
    mutation.mutate({
      kind: "remove-password",
      currentPassword: String(new FormData(event.currentTarget).get("currentPassword") ?? ""),
    });
  }

  const canRemove = methods.hasPassword && methods.externalIdentities.length > 0;
  return (
    <SecuritySection icon={<KeyRound />} title="Password" description={methods.hasPassword ? "A password is available for this account." : "This account currently signs in through an external provider."} status={methods.hasPassword ? "configured" : "not configured"}>
      {!action && (
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {canRemove && (
            <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => onAction("remove")} disabled={!canMutate}>
              <ShieldOff size={15} /> Remove password
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm text-white" onClick={() => onAction("set")} disabled={!canMutate}>
            <KeyRound size={15} /> {methods.hasPassword ? "Change password" : "Add password"}
          </button>
        </div>
      )}
      {action === "set" && (
        <form className="mt-5 space-y-4 rounded-lg border border-base-300 bg-base-200/35 p-4" onSubmit={setPassword}>
          {methods.hasPassword && <PasswordInput name="currentPassword" label="Current password" autoComplete="current-password" />}
          <PasswordInput name="newPassword" label="New password" autoComplete="new-password" showPolicy />
          <PasswordInput name="confirmPassword" label="Confirm new password" autoComplete="new-password" />
          {validationError && <div className="alert alert-error py-3 text-sm"><span>{validationError}</span></div>}
          {passwordError && <ErrorState error={passwordError} />}
          <SecurityActions onCancel={() => { setValidationError(""); onAction(null); mutation.reset(); }} submitting={mutation.isPending} submitLabel="Save password" disabled={!canMutate} />
        </form>
      )}
      {action === "remove" && (
        <form className="mt-5 space-y-4 rounded-lg border border-warning/30 bg-warning/10 p-4" onSubmit={removePassword}>
          <p className="text-sm leading-6">External sign-in will remain available, but password sign-in will stop immediately.</p>
          <PasswordInput name="currentPassword" label="Current password" autoComplete="current-password" />
          {passwordError && <ErrorState error={passwordError} />}
          <SecurityActions onCancel={() => { onAction(null); mutation.reset(); }} submitting={mutation.isPending} submitLabel="Remove password" submitClassName="btn-error text-white" disabled={!canMutate} />
        </form>
      )}
    </SecuritySection>
  );
}

export function MultiFactorPanel({ status, sourceState, canMutate }: { status: MultiFactorStatus | undefined; sourceState: CompositeSourceState; canMutate: boolean }) {
  const { activateTotp, disableTotp, request } = useSession();
  const queryClient = useQueryClient();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disabling, setDisabling] = useState(false);
  const [disableCodeType, setDisableCodeType] = useState<MultiFactorCodeType>("totp");
  const usable = sourceState === "ready" || sourceState === "stale";
  useEffect(() => {
    if (canMutate) return;
    setEnrollment(null);
    setDisabling(false);
  }, [canMutate]);

  const beginEnrollment = useMutation({
    mutationFn: () => request<TotpEnrollment>("/api/auth/mfa/totp/enrollment", { method: "POST" }),
    onSuccess: (result) => { setEnrollment(result); setRecoveryCodes([]); },
  });
  const activate = useMutation({
    mutationFn: (code: string) => activateTotp(code),
    onSuccess: async (codes) => {
      setEnrollment(null);
      setRecoveryCodes(codes);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["auth", "mfa"] }),
        queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] }),
      ]);
    },
  });
  const disable = useMutation({
    mutationFn: ({ codeType, code }: { codeType: MultiFactorCodeType; code: string }) => disableTotp(codeType, code),
  });

  function activateEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) return;
    activate.mutate(String(new FormData(event.currentTarget).get("code") ?? "").trim());
  }

  function disableAuthentication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) return;
    const data = new FormData(event.currentTarget);
    disable.mutate({ codeType: disableCodeType, code: String(data.get("code") ?? "").trim() });
  }

  return (
    <SecuritySection icon={<Smartphone />} title="Multi-factor authentication" description="Protect sensitive actions with an authenticator or one-time recovery code." status={status ? status.isActive ? "active" : "not configured" : undefined}>
      {!usable ? (
        <div className="mt-5"><CompositeSourceFallback state={sourceState} label="multi-factor status" /></div>
      ) : status && !status.providerAvailable ? (
        <p className="mt-5 rounded-lg bg-base-200/60 p-4 text-sm text-base-content/55">An authenticator provider is not available in this environment.</p>
      ) : status?.isActive && recoveryCodes.length === 0 ? (
        <>
          <div className="mt-5 rounded-lg bg-success/10 p-4">
            <p className="text-sm font-semibold">Authenticator enabled</p>
            <p className="mt-1 text-xs leading-5 text-base-content/55">{status.unusedRecoveryCodeCount} recovery code{status.unusedRecoveryCodeCount === 1 ? "" : "s"} remain. Sensitive downloads require a recent MFA sign-in.</p>
          </div>
          {!disabling ? (
            <div className="mt-5 flex justify-end"><button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => setDisabling(true)} disabled={!canMutate}><ShieldOff size={15} />Disable MFA</button></div>
          ) : (
            <form className="mt-5 space-y-4 rounded-lg border border-warning/30 bg-warning/10 p-4" onSubmit={disableAuthentication}>
              <label className="form-control block"><span className="mb-1.5 block text-sm font-semibold">Verification method</span><SelectPicker ariaLabel="Verification method" className="w-full" value={disableCodeType} onValueChange={(value) => setDisableCodeType(value as MultiFactorCodeType)} options={[{ value: "totp", label: "Authenticator code" }, { value: "recovery-code", label: "Recovery code" }]} /></label>
              <CodeInput label="Verification code" />
              {disable.error && <ErrorState error={disable.error} />}
              <SecurityActions onCancel={() => { setDisabling(false); setDisableCodeType("totp"); disable.reset(); }} submitting={disable.isPending} submitLabel="Disable and sign out" submitClassName="btn-error text-white" disabled={!canMutate} />
            </form>
          )}
        </>
      ) : enrollment ? (
        <form className="mt-5 space-y-5 rounded-lg border border-base-300 bg-base-200/35 p-4" onSubmit={activateEnrollment}>
          <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <div className="w-fit rounded-lg border border-base-300 bg-white p-3"><QRCodeSVG value={enrollment.provisioningUri} size={152} level="M" /></div>
            <div><p className="text-sm font-semibold">Scan with your authenticator</p><p className="mt-1 text-xs leading-5 text-base-content/55">Or enter this setup key manually:</p><code className="mt-2 block break-all rounded-lg bg-base-100 px-3 py-2 text-xs">{enrollment.secret}</code><p className="mt-2 text-xs text-base-content/45">Setup expires {new Date(enrollment.expiresAtUtc).toLocaleTimeString()}.</p></div>
          </div>
          <CodeInput label="Six-digit code" numeric />
          {activate.error && <ErrorState error={activate.error} />}
          <SecurityActions onCancel={() => { setEnrollment(null); activate.reset(); }} submitting={activate.isPending} submitLabel="Enable MFA" disabled={!canMutate} />
        </form>
      ) : recoveryCodes.length > 0 ? (
        <div className="mt-5 rounded-lg border border-warning/30 bg-warning/10 p-4">
          <p className="text-sm font-semibold">Save these recovery codes now</p>
          <p className="mt-1 text-xs leading-5 text-base-content/55">Each code works once. They will not be shown again.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">{recoveryCodes.map((code) => <code key={code} className="rounded bg-base-100 px-3 py-2">{code}</code>)}</div>
          <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" className="btn btn-outline btn-sm" onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}><Copy size={15} />Copy codes</button><button type="button" className="btn btn-primary btn-sm text-white" onClick={() => setRecoveryCodes([])}>I saved them</button></div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-4 rounded-lg bg-base-200/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-base-content/60">Use any TOTP-compatible authenticator. BunkFy will issue one-time recovery codes after setup.</p>
          <button type="button" className="btn btn-primary btn-sm shrink-0 text-white" disabled={beginEnrollment.isPending || !canMutate} onClick={() => beginEnrollment.mutate()}><KeyRound size={15} />Set up MFA</button>
        </div>
      )}
      {sourceState === "stale" && <p className="mt-4 rounded-lg bg-warning/10 px-4 py-3 text-sm text-warning-content">This is a saved security view. Refresh it before changing MFA.</p>}
      {beginEnrollment.error && <div className="mt-4"><ErrorState error={beginEnrollment.error} /></div>}
    </SecuritySection>
  );
}

export function EmailPanel({ methods, mutation, canMutate }: { methods: AuthenticationMethods; mutation: SecurityMutation; canMutate: boolean }) {
  const { emailVerificationEnabled } = useProductCapabilities();
  const [confirming, setConfirming] = useState(false);
  const emailError = mutation.variables?.kind === "request-verification" || mutation.variables?.kind === "confirm-verification" ? mutation.error : null;
  useEffect(() => { if (!canMutate) setConfirming(false); }, [canMutate]);
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) return;
    mutation.mutate({ kind: "confirm-verification", code: String(new FormData(event.currentTarget).get("code") ?? "").trim() });
  }
  return (
    <SecuritySection icon={<Mail />} title="Email verification" description="Verified addresses can receive security and account messages.">
      <div className="mt-5 divide-y divide-base-300 border-y border-base-300">
        {methods.emails.map((email) => (
          <div key={email.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="break-all text-sm font-semibold">{email.email}</p><p className="mt-1 text-xs text-base-content/45">{email.isActive ? "Active address" : "Inactive address"}</p></div>
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={email.isVerified ? "verified" : "unverified"} />{emailVerificationEnabled && !email.isVerified && email.isActive && <button type="button" className="btn btn-ghost btn-xs text-primary" disabled={mutation.isPending || !canMutate} onClick={() => mutation.mutate({ kind: "request-verification", emailId: email.id })}><Mail size={14} />Send code</button>}</div>
          </div>
        ))}
      </div>
      {!methods.emails.length && <p className="mt-5 rounded-lg border border-dashed border-base-300 p-5 text-center text-sm text-base-content/50">No email address is attached to this account.</p>}
      {emailError && <div className="mt-4"><ErrorState error={emailError} /></div>}
      {emailVerificationEnabled && methods.emails.some((email) => !email.isVerified) && (!confirming ? (
        <div className="mt-5 flex justify-end"><button type="button" className="btn btn-outline btn-sm" onClick={() => { mutation.reset(); setConfirming(true); }} disabled={!canMutate}><BadgeCheck size={15} />Enter verification code</button></div>
      ) : (
        <form className="mt-5 rounded-lg border border-base-300 bg-base-200/35 p-4" onSubmit={confirm}>
          <CodeInput label="Verification code" />
          <SecurityActions onCancel={() => { setConfirming(false); mutation.reset(); }} submitting={mutation.isPending} submitLabel="Verify email" disabled={!canMutate} />
        </form>
      ))}
    </SecuritySection>
  );
}

export function ProviderPanel({ methods, availableProviders, catalogueState, linkingProvider, unlinkIdentity, mutation, canLink, canUnlink, linkError, onLink, onUnlink }: { methods: AuthenticationMethods; availableProviders: string[]; catalogueState: CompositeSourceState; linkingProvider: string | null; unlinkIdentity: ExternalIdentity | null; mutation: SecurityMutation; canLink: boolean; canUnlink: boolean; linkError: unknown; onLink: (provider: string) => Promise<void>; onUnlink: (identity: ExternalIdentity | null) => void }) {
  const unlinkError = mutation.variables?.kind === "unlink-provider" ? mutation.error : null;
  function unlink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unlinkIdentity || !canUnlink) return;
    mutation.mutate({ kind: "unlink-provider", identityId: unlinkIdentity.id, currentPassword: methods.hasPassword ? String(new FormData(event.currentTarget).get("currentPassword") ?? "") : null });
  }
  return (
    <SecuritySection icon={<Link2 />} title="External accounts" description="Link optional identity providers without merging accounts by email.">
      {(catalogueState === "loading" || catalogueState === "unavailable") && <div className="mt-5"><CompositeSourceFallback state={catalogueState} label="external providers" /></div>}
      {availableProviders.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{availableProviders.map((provider) => <button key={provider} type="button" className="btn btn-outline btn-sm" disabled={linkingProvider !== null || !canLink} onClick={() => void onLink(provider)}>{linkingProvider === provider ? <span className="loading loading-spinner loading-xs" /> : <Link2 size={15} />}Link {providerLabel(provider)}</button>)}</div>}
      {Boolean(linkError) && <div className="mt-4"><ErrorState error={linkError} /></div>}
      <div className="mt-5 divide-y divide-base-300 border-y border-base-300">{methods.externalIdentities.map((identity) => <div key={identity.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-semibold">{providerLabel(identity.providerCode)}</p><p className="mt-1 text-xs text-base-content/45">Linked {formatDateTime(identity.linkedAtUtc)}</p></div><button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => onUnlink(identity)} disabled={!canUnlink || mutation.isPending}><Unlink size={15} />Unlink</button></div>)}</div>
      {!methods.externalIdentities.length && <div className="mt-5 flex items-center gap-3 rounded-lg bg-base-200/60 p-4 text-sm text-base-content/55"><Link2 size={18} className="shrink-0 text-base-content/35" />No external accounts are linked.</div>}
      {catalogueState === "stale" && <p className="mt-4 rounded-lg bg-warning/10 px-4 py-3 text-sm text-warning-content">Available providers are a saved view. Refresh before linking another account.</p>}
      {unlinkIdentity && canUnlink && <form className="mt-5 rounded-lg border border-warning/30 bg-warning/10 p-4" onSubmit={unlink}><h3 className="font-semibold">Unlink {providerLabel(unlinkIdentity.providerCode)}?</h3><p className="mt-1 text-sm leading-6 text-base-content/60">BunkFy will reject this change if it would leave the account without a sign-in method.</p>{methods.hasPassword && <div className="mt-4"><PasswordInput name="currentPassword" label="Current password" autoComplete="current-password" /></div>}{unlinkError && <div className="mt-4"><ErrorState error={unlinkError} /></div>}<SecurityActions onCancel={() => { onUnlink(null); mutation.reset(); }} submitting={mutation.isPending} submitLabel="Unlink account" submitClassName="btn-error text-white" disabled={!canUnlink} /></form>}
    </SecuritySection>
  );
}

function SecuritySection({ icon, title, description, status, children }: { icon: ReactNode; title: string; description: string; status?: string; children: ReactNode }) {
  return <section className="border-b border-base-300 py-6 first:pt-0 last:border-b-0 last:pb-0"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&>svg]:size-5">{icon}</span><div><h3 className="font-display text-xl font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-base-content/55">{description}</p></div></div>{status && <StatusBadge status={status} />}</div>{children}</section>;
}

function PasswordInput({ name, label, autoComplete, showPolicy = false }: { name: string; label: string; autoComplete: string; showPolicy?: boolean }) {
  return <label className="form-control block"><span className="mb-1.5 block text-sm font-semibold">{label}</span><input name={name} type="password" className="input input-bordered w-full" minLength={showPolicy ? authPasswordPolicy.minimumLength : undefined} maxLength={authPasswordPolicy.maximumLength} autoComplete={autoComplete} required />{showPolicy && <span className="mt-1.5 block text-xs text-base-content/50">Use {authPasswordLengthHelp()}. A password manager is recommended.</span>}</label>;
}

function CodeInput({ label, numeric = false }: { label: string; numeric?: boolean }) {
  return <label className="form-control block"><span className="mb-1.5 block text-sm font-semibold">{label}</span><input name="code" className="input input-bordered w-full font-mono" inputMode={numeric ? "numeric" : undefined} autoComplete="one-time-code" required /></label>;
}

function SecurityActions({ onCancel, submitting, submitLabel, submitClassName = "btn-primary text-white", disabled }: { onCancel: () => void; submitting: boolean; submitLabel: string; submitClassName?: string; disabled: boolean }) {
  return <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-4"><button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={submitting}>Cancel</button><button type="submit" className={`btn btn-sm ${submitClassName}`} disabled={submitting || disabled}>{submitting && <span className="loading loading-spinner loading-xs" />}{submitLabel}</button></div>;
}

function providerLabel(provider: string): string { return provider.charAt(0).toUpperCase() + provider.slice(1); }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
