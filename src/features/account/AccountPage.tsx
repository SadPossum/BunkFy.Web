import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  CircleUserRound,
  MonitorSmartphone,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type {
  AuthenticationMethods,
  AuthenticationSessions,
  ExternalAuthenticationProviderList,
  ExternalIdentity,
  MultiFactorStatus,
  StaffMember,
} from "../../api/types";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSourceState,
} from "../../app/compositeSourceState";
import { useTransientResourceFocus } from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { PageHeader } from "../../components/ui/primitives";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { AccountOverview } from "./AccountOverview";
import {
  EmailPanel,
  MultiFactorPanel,
  PasswordPanel,
  ProviderPanel,
  type SecurityAction,
} from "./AccountSecurityPanels";
import { AccountSessionsPanel } from "./AccountSessionsPanel";
import { AccountStaffProfilePanel } from "./AccountStaffProfilePanel";
import {
  accountSection,
  accountSectionSearchParams,
  type AccountSection,
} from "./accountSections";

export function AccountPage() {
  const { beginExternalLink, logout, logoutAll, request, session } = useSession();
  const { selectedWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusRequested = searchParams.get("focus") === "workspace-profile" && Boolean(selectedWorkspace);
  const requestedSection = accountSection(searchParams.get("section"), Boolean(selectedWorkspace));
  const section: AccountSection = focusRequested ? "profile" : requestedSection;

  const needsMethods = section === "overview" || section === "security";
  const needsProviders = section === "security";
  const needsSessions = section === "overview" || section === "sessions";
  const needsMfa = section === "overview" || section === "security";
  const needsStaffProfile = Boolean(selectedWorkspace) && (section === "overview" || section === "profile");

  const methods = useQuery({
    queryKey: ["auth", "methods", session?.tenantId],
    queryFn: () => request<AuthenticationMethods>("/api/auth/methods"),
    enabled: needsMethods,
  });
  const providers = useQuery({
    queryKey: ["auth", "external-providers"],
    queryFn: () => request<ExternalAuthenticationProviderList>("/api/auth/external/providers"),
    enabled: needsProviders,
    staleTime: 5 * 60_000,
  });
  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: () => request<AuthenticationSessions>("/api/auth/sessions"),
    enabled: needsSessions,
  });
  const mfaStatus = useQuery({
    queryKey: ["auth", "mfa"],
    queryFn: () => request<MultiFactorStatus>("/api/auth/mfa"),
    enabled: needsMfa,
  });
  const staffProfile = useQuery({
    queryKey: ["staff", "me", session?.tenantId],
    queryFn: () => request<StaffMember>("/api/staff/me"),
    enabled: needsStaffProfile,
    retry: false,
  });

  const methodsSource = createCompositeSource({ label: "Sign-in methods", hasData: methods.data !== undefined, isLoading: methods.isLoading, error: methods.error, isFetching: methods.isFetching, refetch: () => methods.refetch() });
  const providerSource = createCompositeSource({ label: "External providers", hasData: providers.data !== undefined, isLoading: providers.isLoading, error: providers.error, isFetching: providers.isFetching, refetch: () => providers.refetch() });
  const sessionSource = createCompositeSource({ label: "Active sessions", hasData: sessions.data !== undefined, isLoading: sessions.isLoading, error: sessions.error, isFetching: sessions.isFetching, refetch: () => sessions.refetch() });
  const mfaSource = createCompositeSource({ label: "Multi-factor status", hasData: mfaStatus.data !== undefined, isLoading: mfaStatus.isLoading, error: mfaStatus.error, isFetching: mfaStatus.isFetching, refetch: () => mfaStatus.refetch() });
  const staffProfileSource = createCompositeSource({ label: "Workspace profile", hasData: staffProfile.data !== undefined, isLoading: staffProfile.isLoading, error: staffProfile.error, isFetching: staffProfile.isFetching, refetch: () => staffProfile.refetch() });

  const activeSources = section === "overview"
    ? [methodsSource, mfaSource, sessionSource, ...(selectedWorkspace ? [staffProfileSource] : [])]
    : section === "security"
      ? [methodsSource, mfaSource, providerSource]
      : section === "sessions"
        ? [sessionSource]
        : [staffProfileSource];

  const methodsUsable = compositeSourceUsable(methodsSource.state);
  const providersUsable = compositeSourceUsable(providerSource.state);
  const sessionsUsable = compositeSourceUsable(sessionSource.state);
  const mfaUsable = compositeSourceUsable(mfaSource.state);
  const staffProfileUsable = compositeSourceUsable(staffProfileSource.state);
  const methodsCurrent = compositeSourceCurrent(methodsSource);
  const providersCurrent = compositeSourceCurrent(providerSource);
  const sessionsCurrent = compositeSourceCurrent(sessionSource);
  const mfaCurrent = compositeSourceCurrent(mfaSource);
  const staffProfileCurrent = compositeSourceCurrent(staffProfileSource);
  const focusedResourceId = useTransientResourceFocus(Boolean(staffProfile.data));

  const [confirmAll, setConfirmAll] = useState(false);
  const [submittingSession, setSubmittingSession] = useState<"current" | "all" | null>(null);
  const [signOutError, setSignOutError] = useState<unknown>(null);
  const [providerLinkError, setProviderLinkError] = useState<unknown>(null);
  const [passwordAction, setPasswordAction] = useState<"set" | "remove" | null>(null);
  const [unlinkIdentity, setUnlinkIdentity] = useState<ExternalIdentity | null>(null);
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const selectSection = useCallback((nextSection: AccountSection) => {
    setSearchParams(accountSectionSearchParams(searchParams, nextSection), { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!focusRequested || searchParams.get("section") === "profile") return;
    const next = new URLSearchParams(searchParams);
    next.set("section", "profile");
    setSearchParams(next, { replace: true });
  }, [focusRequested, searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get("external") !== "linked") return;
    setNotice("External account linked.");
    const next = new URLSearchParams(searchParams);
    next.delete("external");
    next.set("section", "security");
    setSearchParams(next, { replace: true });
    void queryClient.invalidateQueries({ queryKey: ["auth", "methods"] });
  }, [queryClient, searchParams, setSearchParams]);

  const security = useMutation({
    mutationFn: async (action: SecurityAction) => {
      if (!methodsCurrent) throw new Error("Refresh account security before making this change.");
      if (action.kind === "set-password") {
        return request<void>("/api/auth/password", { method: "PUT", body: JSON.stringify({ newPassword: action.newPassword, currentPassword: action.currentPassword }) });
      }
      if (action.kind === "remove-password") {
        return request<void>("/api/auth/password/remove", { method: "POST", body: JSON.stringify({ currentPassword: action.currentPassword }) });
      }
      if (action.kind === "request-verification") {
        return request<void>("/api/auth/email-verification", { method: "POST", body: JSON.stringify({ emailId: action.emailId }) });
      }
      if (action.kind === "confirm-verification") {
        return request<void>("/api/auth/email-verification/confirm", { method: "POST", body: JSON.stringify({ code: action.code }) });
      }
      return request<void>(`/api/auth/external-identities/${action.identityId}/unlink`, { method: "POST", body: JSON.stringify({ currentPassword: action.currentPassword }) });
    },
    onSuccess: async (_result, action) => {
      setNotice(actionNotice(action.kind));
      setPasswordAction(null);
      setUnlinkIdentity(null);
      await queryClient.invalidateQueries({ queryKey: ["auth", "methods"] });
    },
  });
  const revokeSession = useMutation({
    mutationFn: (sessionId: string) => request<void>(`/api/auth/sessions/${sessionId}/sign-out`, { method: "POST" }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] }),
  });
  const resetSecurity = security.reset;

  useEffect(() => {
    if (methodsCurrent) return;
    setPasswordAction(null);
    setUnlinkIdentity(null);
  }, [methodsCurrent]);
  useEffect(() => {
    if (section === "security") return;
    setPasswordAction(null);
    setUnlinkIdentity(null);
    setProviderLinkError(null);
    resetSecurity();
  }, [resetSecurity, section]);

  async function signOut(mode: "current" | "all") {
    setSubmittingSession(mode);
    setSignOutError(null);
    try {
      if (mode === "all") await logoutAll();
      else await logout();
    } catch (caught) {
      setSignOutError(caught);
      setSubmittingSession(null);
    }
  }

  async function linkProvider(provider: string) {
    if (!methodsCurrent || !providersCurrent) return;
    setLinkingProvider(provider);
    setProviderLinkError(null);
    security.reset();
    try {
      await beginExternalLink(provider);
    } catch (caught) {
      setLinkingProvider(null);
      setProviderLinkError(caught);
    }
  }

  function openPasswordAction(action: "set" | "remove" | null) {
    security.reset();
    setPasswordAction(action);
  }

  function openUnlink(identity: ExternalIdentity | null) {
    security.reset();
    setUnlinkIdentity(identity);
  }

  const authentication = methodsUsable ? methods.data : undefined;
  const linkedProviderCodes = new Set(authentication?.externalIdentities.map((identity) => identity.providerCode) ?? []);
  const availableProviders = (providersUsable ? providers.data?.providers ?? [] : []).filter((provider) => !linkedProviderCodes.has(provider));
  const navigation = [
    { value: "overview" as const, label: "Overview", description: "Identity and security", icon: CircleUserRound, visible: true },
    { value: "profile" as const, label: "Workspace profile", description: "Contact and work details", icon: Building2, visible: Boolean(selectedWorkspace) },
    { value: "security" as const, label: "Sign-in & recovery", description: "Password, email, MFA", icon: ShieldCheck, visible: true },
    { value: "sessions" as const, label: "Sessions", description: "Browsers and revocation", icon: MonitorSmartphone, visible: true },
  ].filter((item) => item.visible);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Personal settings"
        title="Account"
        description="Review your identity, workspace profile, sign-in safeguards, and active browser sessions."
        action={<span className="badge h-8 gap-2 border-0 bg-primary px-3 font-semibold text-white"><ShieldCheck size={15} />Signed in</span>}
      />
      <CompositeSourceNotice sources={activeSources} title="Some account data is delayed" />
      {notice && (
        <div className="alert border border-success/25 bg-success/10 text-sm">
          <BadgeCheck size={18} className="text-success" />
          <span>{notice}</span>
          <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[252px_minmax(0,1fr)] xl:items-start">
        <div className="min-w-0">
          <div className="xl:hidden">
            <label className="form-control block">
              <span className="mb-1.5 block text-sm font-semibold">Account section</span>
              <SelectPicker
                value={section}
                onValueChange={(value) => selectSection(accountSection(value, Boolean(selectedWorkspace)))}
                ariaLabel="Account section"
                options={navigation.map((item) => ({ value: item.value, label: item.label, description: item.description }))}
              />
            </label>
          </div>
          <aside className="hidden rounded-lg border border-base-300 bg-base-100 p-2 shadow-sm xl:sticky xl:top-20 xl:block" aria-label="Account sections">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = section === item.value;
              return (
                <button key={item.value} type="button" aria-current={active ? "page" : undefined} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${active ? "bg-primary/10 text-primary shadow-[inset_3px_0_0_var(--color-primary)]" : "text-base-content hover:bg-base-200"}`} onClick={() => selectSection(item.value)}>
                  <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${active ? "bg-primary text-white" : "bg-base-200 text-base-content/55"}`}><Icon size={17} /></span>
                  <span className="min-w-0"><span className="block text-sm font-semibold">{item.label}</span><span className="mt-0.5 block truncate text-xs opacity-55">{item.description}</span></span>
                </button>
              );
            })}
          </aside>
        </div>

        <section className="min-w-0 overflow-visible rounded-lg border border-base-300 bg-base-100 shadow-sm">
          <div className="p-5 sm:p-6">
            {section === "overview" && (
              <AccountOverview
                username={session?.username ?? "Unknown account"}
                workspaceName={selectedWorkspace?.organization.name ?? null}
                staffProfile={staffProfileUsable ? staffProfile.data : undefined}
                staffProfileState={staffProfileSource.state}
                methods={authentication}
                methodsState={methodsSource.state}
                mfaStatus={mfaUsable ? mfaStatus.data : undefined}
                mfaState={mfaSource.state}
                sessions={sessionsUsable ? sessions.data : undefined}
                sessionsState={sessionSource.state}
                onOpenSection={selectSection}
              />
            )}

            {section === "profile" && selectedWorkspace && (
              staffProfileUsable && staffProfile.data ? (
                <AccountStaffProfilePanel
                  member={staffProfile.data}
                  focused={focusedResourceId === "workspace-profile"}
                  canMutate={staffProfileCurrent}
                  request={request}
                  onUpdated={(updated) => queryClient.setQueryData(["staff", "me", session?.tenantId], updated)}
                />
              ) : (
                <AccountSourcePanel title="Workspace profile" description="Contact and work details visible to your team." state={staffProfileSource.state} label="workspace profile" />
              )
            )}

            {section === "security" && (
              <div className="max-w-5xl">
                <div className="mb-6 flex items-start gap-3 border-b border-base-300 pb-5">
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><ShieldCheck size={20} /></span>
                  <div><h2 className="font-display text-xl font-semibold">Sign-in and recovery</h2><p className="mt-1 text-sm leading-6 text-base-content/55">Account-owned safeguards stay separate from workspace roles and Staff profile details.</p></div>
                </div>
                <div className="divide-y divide-base-300">
                  {authentication ? <PasswordPanel methods={authentication} action={passwordAction} mutation={security} canMutate={methodsCurrent} onAction={openPasswordAction} /> : <AccountSourcePanel title="Password" description="Password sign-in status and changes." state={methodsSource.state} label="sign-in methods" />}
                  <MultiFactorPanel status={mfaUsable ? mfaStatus.data : undefined} sourceState={mfaSource.state} canMutate={mfaCurrent} />
                  {authentication && <EmailPanel methods={authentication} mutation={security} canMutate={methodsCurrent} />}
                  {authentication && <ProviderPanel methods={authentication} availableProviders={availableProviders} catalogueState={providerSource.state} linkingProvider={linkingProvider} unlinkIdentity={unlinkIdentity} mutation={security} canLink={methodsCurrent && providersCurrent} canUnlink={methodsCurrent} linkError={providerLinkError} onLink={linkProvider} onUnlink={openUnlink} />}
                </div>
              </div>
            )}

            {section === "sessions" && (
              <AccountSessionsPanel
                sessions={sessionsUsable ? sessions.data?.sessions ?? [] : []}
                sourceState={sessionSource.state}
                canRevoke={sessionsCurrent}
                revokePending={revokeSession.isPending}
                revokeError={revokeSession.error}
                signOutError={signOutError}
                submitting={submittingSession}
                confirmAll={confirmAll}
                onConfirmAll={setConfirmAll}
                onRevoke={(sessionId) => revokeSession.mutate(sessionId)}
                onSignOut={(mode) => void signOut(mode)}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function AccountSourcePanel({ title, description, state, label }: { title: string; description: string; state: CompositeSourceState; label: string }) {
  return (
    <section>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-base-content/50">{description}</p>
      <div className="mt-5"><CompositeSourceFallback state={state} label={label} /></div>
    </section>
  );
}

function actionNotice(kind: SecurityAction["kind"]): string {
  return ({
    "set-password": "Password updated.",
    "remove-password": "Password removed.",
    "request-verification": "Verification code requested.",
    "confirm-verification": "Email address verified.",
    "unlink-provider": "External account unlinked.",
  } as const)[kind];
}
