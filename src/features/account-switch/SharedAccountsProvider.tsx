import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { apiRequest } from "../../api/client";
import { useProductCapabilities } from "../../app/productCapabilities";
import { SessionProvider, useSession } from "../../app/session";
import { AccountSwitchScreen } from "./AccountSwitchScreen";
import { canUseSharedAccountSwitch } from "./accountSwitchEligibility";
import { accountPrivacyCovered, clearAccountOperation, clearAccountPrivacy, coverAccountPrivacy, isAccountPrivacyEvent,
  readAccountOperation, safeAccountReturnPath, saveAccountOperation, supersedeRememberWithLock,
  type AccountOperation, type AccountOperationKind } from "./accountSwitchRecovery";
import { isEmptyRememberedBrowser, rememberedOutcome, rememberedState, type RememberedAccount, type RememberedBrowser, type RememberedOperationResult } from "./accountSwitchTypes";
import { confirmedRememberedSession, installRememberedContext, installRememberedOperationContext,
  prepareRememberedBrowserRefresh, readRememberedBrowser, readRememberedOperation, rememberedEndpoint,
  rememberedOperation, rememberedOutcomeMessage, resetRememberedBrowserTransport } from "./rememberedBrowserApi";

type SharedAccounts = {
  enabled: boolean;
  current: RememberedBrowser | null;
  busy: boolean;
  message: string;
  switchAccount: () => Promise<void>;
  rememberAccount: (pin: string, label: string, consent: boolean) => Promise<boolean>;
  forgetOwnAccount: () => Promise<void>;
  signInAgain: () => Promise<void>;
  returnToAccounts: () => Promise<void>;
};
const Context = createContext<SharedAccounts | null>(null);
export function useSharedAccounts(): SharedAccounts | null { return useContext(Context); }

// Preflight precedes SessionProvider: an old saved sid must not refresh without
// the device generation, or paint an old guest page before its lock is known.
export function SharedAccountRoot({ children }: { children: ReactNode }) {
  const { sharedAccountSwitchEnabled } = useProductCapabilities();
  return sharedAccountSwitchEnabled && canUseSharedAccountSwitch()
    ? <ManagedAccountRoot>{children}</ManagedAccountRoot>
    : <SessionProvider>{children}</SessionProvider>;
}

function ManagedAccountRoot({ children }: { children: ReactNode }) {
  const [initial, setInitial] = useState<RememberedBrowser | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => () => resetRememberedBrowserTransport(), []);
  useEffect(() => {
    const controller = new AbortController();
    void readRememberedBrowser(controller.signal).then(value => {
      if (!controller.signal.aborted) { installRememberedContext(value); setInitial(value); setError(false); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [retry]);
  if (!initial) return <AccountSwitchScreen accounts={[]} selected={null} pinDigits={6} busy={!error} securing
    message={error ? "The browser lock status could not be checked. No guest information is shown. Reconnect and try again." : ""}
    recovery={false} onChoose={() => undefined} onBack={() => undefined} onUnlock={async () => undefined}
    onSignIn={() => undefined} onRetry={() => { setError(false); setRetry(value => value + 1); }} />;
  const restore = !accountPrivacyCovered() && !readAccountOperation() &&
    (initial.state === rememberedState.active || initial.state === rememberedState.missing || initial.state === rememberedState.revoked);
  return <SessionProvider restoreOnMount={restore} prepareBrowserRefresh={prepareRememberedBrowserRefresh}>
    <SharedAccountsProvider initial={initial}>{children}</SharedAccountsProvider>
  </SessionProvider>;
}

function SharedAccountsProvider({ initial, children }: { initial: RememberedBrowser; children: ReactNode }) {
  const auth = useSession();
  const authRef = useRef(auth); authRef.current = auth;
  const location = useLocation();
  const navigate = useNavigate();
  const [current, setCurrent] = useState(initial);
  const currentRef = useRef(initial);
  const [covered, setCovered] = useState(accountPrivacyCovered);
  const [pending, setPending] = useState(readAccountOperation);
  const pendingRef = useRef(pending);
  const [selected, setSelected] = useState<RememberedAccount | null>(() => initial.accounts?.find(a => a.proofId === pending?.proofId) ?? null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [allowSignIn, setAllowSignIn] = useState(initial.state === rememberedState.signingIn);
  const [cancelGeneration, setCancelGeneration] = useState<number | null>(null);
  const returnPath = useRef("/");
  const statusSequence = useRef(0);
  const concealedSid = useRef<string | null>(null);

  const update = useCallback((next: RememberedBrowser, source: "current" | "operation" = "operation") => {
    if (next.generation < currentRef.current.generation && next.state !== rememberedState.missing && next.state !== rememberedState.revoked) {
      throw new Error("The browser status is out of date.");
    }
    if (source === "current") installRememberedContext(next);
    else installRememberedOperationContext(next);
    setCancelGeneration(null);
    currentRef.current = next;
    setCurrent(next);
  }, []);
  const hide = useCallback(() => {
    setCovered(true);
    concealedSid.current = authRef.current.session?.sessionId ?? null;
    authRef.current.concealForAccountTransition();
    // Failure still hides this tab. Do not claim a server lock or dispatch a
    // transition without the cross-tab privacy/recovery storage available.
    coverAccountPrivacy();
  }, []);
  const finish = useCallback((operation: AccountOperation) => {
    clearAccountOperation(operation.operationId);
    pendingRef.current = null; setPending(null);
  }, []);

  const accept = useCallback((result: RememberedOperationResult, operation: AccountOperation): boolean => {
    update(result.current);
    if (result.outcome !== rememberedOutcome.applied) {
      setMessage(rememberedOutcomeMessage(result.outcome, result.retryAfterMs));
      // A PIN rejection/rate limit is a terminal failed attempt, not an unknown
      // successful selection. A later attempt gets its own bounded operation.
      if (!operation.supersededOperationId && [rememberedOutcome.pinRejected, rememberedOutcome.rateLimited, rememberedOutcome.authenticationRequired,
        rememberedOutcome.sessionLimitReached, rememberedOutcome.stateChanged].some(value => value === result.outcome)) finish(operation);
      return false;
    }
    if (operation.supersededOperationId && (result.current.state !== rememberedState.locked || result.current.generation <= operation.expectedGeneration)) {
      throw new Error("The cancellation lock is not confirmed.");
    }
    if (operation.kind === "remember" || operation.kind === "select") {
      const account = confirmedRememberedSession(result, operation);
      authRef.current.adoptBrowserAccount(account);
      clearAccountPrivacy(); setCovered(false); setAllowSignIn(false);
      finish(operation); setSelected(null); setMessage("");
      navigate(returnPath.current, { replace: true });
      return true;
    }
    finish(operation); setSelected(null); setMessage("");
    if (operation.kind === "begin-sign-in") { setAllowSignIn(true); navigate("/", { replace: true }); }
    else setAllowSignIn(false);
    return true;
  }, [finish, navigate, update]);

  const dispatch = useCallback(async (operation: AccountOperation, extra: object = {}, recover = false): Promise<boolean> => {
    if (inFlight.current) return false;
    statusSequence.current += 1;
    setCancelGeneration(null);
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      saveAccountOperation(operation); pendingRef.current = operation; setPending(operation);
      let result = await rememberedOperation(recover ? "recover" : operation.kind,
        { operationId: operation.operationId, expectedGeneration: operation.expectedGeneration,
          ...(operation.proofId ? { proofId: operation.proofId } : {}), ...extra },
        operation.kind === "remember" && !recover ? authRef.current.session ?? undefined : undefined);
      if (recover && operation.kind === "select" && result.outcome === rememberedOutcome.notFound &&
        result.current.generation === operation.expectedGeneration && result.current.state === rememberedState.locked) {
        // The owner confirms no receipt and the unchanged locked generation.
        // Re-dispatch ONLY that same selection/operation, never a new child ID.
        update(result.current);
        result = await rememberedOperation("select", { operationId: operation.operationId,
          expectedGeneration: operation.expectedGeneration, proofId: operation.proofId, ...extra });
      }
      return accept(result, operation);
    } catch {
      try { hide(); } catch { /* Local content is hidden even when shared storage fails. */ }
      setMessage("The result is not confirmed. Your previous account is hidden. Retry this original change before starting another.");
      return false;
    } finally { inFlight.current = false; setBusy(false); }
  }, [accept, hide, update]);

  const beginOperation = useCallback((kind: AccountOperationKind, proofId?: string): AccountOperation => {
    if (pendingRef.current) throw new Error("Resolve the previous account change first.");
    const operation = { operationId: crypto.randomUUID(), expectedGeneration: currentRef.current.generation, kind,
      ...(proofId ? { proofId } : {}) };
    saveAccountOperation(operation); pendingRef.current = operation; setPending(operation);
    return operation;
  }, []);

  const refreshStatus = useCallback(async () => {
    const sequence = ++statusSequence.current;
    try {
      const next = await readRememberedBrowser();
      if (sequence !== statusSequence.current || inFlight.current) return;
      update(next, "current");
      const local = authRef.current.session;
      if (local && (next.state !== rememberedState.active || next.active?.memberId !== local.subjectId || next.active?.sessionId !== local.sessionId)) {
        try { hide(); } catch { /* Keep the local boundary closed. */ }
      }
    } catch { setMessage("The browser status is unavailable. Reconnect, then refresh accounts."); }
  }, [hide, update]);

  const switchAccount = useCallback(async () => {
    if (inFlight.current || pendingRef.current) return;
    returnPath.current = safeAccountReturnPath(location.pathname);
    try {
      // Synchronously remove the operational tree before awaiting the server.
      hide(); setAllowSignIn(false);
      await dispatch(beginOperation("lock"));
    } catch { setMessage("Guest information is hidden in this tab, but BunkFy could not save the lock reference. Enable browser storage, then retry."); }
  }, [beginOperation, dispatch, hide, location.pathname]);

  const signIn = useCallback(async () => {
    if (inFlight.current || pendingRef.current) return;
    try {
      hide();
      if (currentRef.current.state === rememberedState.missing || currentRef.current.state === rememberedState.revoked) {
        clearAccountPrivacy(); setCovered(false);
        setAllowSignIn(true); navigate("/", { replace: true }); return;
      }
      await dispatch(beginOperation("begin-sign-in"));
    } catch { setMessage("The sign-in transition could not be started. Keep guest information hidden and retry."); }
  }, [beginOperation, dispatch, hide, navigate]);

  const cancelSignIn = useCallback(async () => {
    if (inFlight.current || pendingRef.current) return;
    try { hide(); setAllowSignIn(false); await dispatch(beginOperation("cancel-sign-in")); }
    catch { setMessage("The previous sign-in could not be closed. Keep this browser hidden and retry."); }
  }, [beginOperation, dispatch, hide]);

  const unlock = useCallback(async (pin: string) => {
    if (inFlight.current) return;
    if (pendingRef.current) {
      const operation = pendingRef.current;
      if (operation.kind !== "select" && operation.kind !== "remember") return;
      await dispatch(operation, { pin }, true); return;
    }
    if (!selected) return;
    if (selected.requiresSignIn) { await signIn(); return; }
    try { await dispatch(beginOperation("select", selected.proofId), { pin }); }
    catch { setMessage("BunkFy could not save the account-change reference. Enable browser storage and try again."); }
  }, [beginOperation, dispatch, selected, signIn]);

  const retry = useCallback(async () => {
    if (inFlight.current) return;
    const operation = pendingRef.current;
    if (!operation) {
      if (currentRef.current.state === rememberedState.active) await switchAccount();
      else await refreshStatus();
      return;
    }
    if (operation.kind !== "remember" && operation.kind !== "select" && !operation.supersededOperationId) { await dispatch(operation); return; }
    setBusy(true); inFlight.current = true;
    setCancelGeneration(null); statusSequence.current += 1;
    try {
      const result = await readRememberedOperation(operation.operationId);
      update(result.current);
      if (operation.supersededOperationId) {
        if (result.outcome === rememberedOutcome.applied) { accept(result, operation); return; }
        const fresh = await readRememberedBrowser(); update(fresh, "current");
        if (result.outcome === rememberedOutcome.notFound && fresh.generation === operation.expectedGeneration) {
          // The exact outcome was checked first. A same-ID lock retry cannot
          // create a different transition, including a delayed original reply.
          inFlight.current = false; setBusy(false);
          await dispatch(operation); return;
        } else if ((result.outcome === rememberedOutcome.notFound || result.outcome === rememberedOutcome.stateChanged) && fresh.generation > operation.expectedGeneration &&
          (fresh.state === rememberedState.active || fresh.state === rememberedState.locked)) {
          setCancelGeneration(fresh.generation);
          setMessage("Another account change won first. The browser is still hidden. Confirm a lock against its current state.");
        } else setMessage(rememberedOutcomeMessage(result.outcome));
        return;
      }
      const account = result.current.accounts?.find(a => a.proofId === operation.proofId || a.proofId === result.current.active?.proofId);
      if (result.outcome === rememberedOutcome.applied && account) {
        setSelected(account); setMessage("The account change is recorded. Re-enter your PIN to recover that same sign-in.");
      } else if (result.outcome === rememberedOutcome.notFound) {
        setMessage("No result is recorded yet. Keep this original change open; do not start another sign-in.");
        if (operation.kind === "remember" && result.current.generation === operation.expectedGeneration) {
          const fresh = await readRememberedBrowser(); update(fresh, "current");
          if (fresh.generation === operation.expectedGeneration && fresh.state === rememberedState.active) setCancelGeneration(fresh.generation);
        }
      } else if (result.outcome !== rememberedOutcome.applied) {
        finish(operation); setMessage(rememberedOutcomeMessage(result.outcome));
      }
    } catch { setMessage("The result is still unavailable. Keep this page open and retry when connected."); }
    finally { inFlight.current = false; setBusy(false); }
  }, [accept, dispatch, finish, refreshStatus, switchAccount, update]);

  const cancelUnconfirmedRemember = useCallback(async () => {
    const original = pendingRef.current;
    if (!original || cancelGeneration === null || inFlight.current) return;
    try {
      hide();
      const lock = supersedeRememberWithLock(original, crypto.randomUUID(), cancelGeneration);
      pendingRef.current = lock; setPending(lock); setCancelGeneration(null);
      await dispatch(lock);
    } catch { setMessage("The cancellation lock is not confirmed. Keep the original result reference and retry."); }
  }, [cancelGeneration, dispatch, hide]);

  const rememberAccount = useCallback(async (pin: string, label: string, consent: boolean): Promise<boolean> => {
    if (!consent || !authRef.current.session || inFlight.current || pendingRef.current) return false;
    returnPath.current = "/account?section=security";
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      if (!currentRef.current.csrfToken) {
        statusSequence.current += 1;
        update(await apiRequest<RememberedBrowser>(`${rememberedEndpoint}/device`, {
          method: "POST", headers: { "X-Tenant-Id": "global" }, signal: AbortSignal.timeout(20_000),
        }, { ...authRef.current.session, tenantId: "global" }));
      }
    } catch {
      setMessage("This browser could not be prepared. No PIN was saved. Refresh its status before trying again.");
      return false;
    } finally { inFlight.current = false; setBusy(false); }
    try { return await dispatch(beginOperation("remember"), { pin, label: label.trim() || null, consent: true }); }
    catch { setMessage("The change could not be started. Enable browser storage and try again."); return false; }
  }, [beginOperation, dispatch, update]);

  const forgetOwnAccount = useCallback(async () => {
    const proofId = currentRef.current.active?.proofId;
    if (!proofId || pendingRef.current || inFlight.current) return;
    try { hide(); await dispatch(beginOperation("forget", proofId)); }
    catch { setMessage("The forget request is not confirmed. Guest information remains hidden."); }
  }, [beginOperation, dispatch, hide]);

  const forgetBrowser = useCallback(async () => {
    if (!currentRef.current.csrfToken || pendingRef.current || inFlight.current) return;
    try { hide(); await dispatch(beginOperation("forget-device")); }
    catch { setMessage("Forgetting this browser is not confirmed. Keep it hidden and retry the original request."); }
  }, [beginOperation, dispatch, hide]);

  // Stored cover/pending states must conceal before effects paint any old tree.
  useLayoutEffect(() => {
    if ((covered || pendingRef.current || initial.state === rememberedState.locked || initial.state === rememberedState.signingIn) && authRef.current.session) {
      authRef.current.concealForAccountTransition();
    }
  }, [covered, initial.state]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!isAccountPrivacyEvent(event.key)) return;
      if (accountPrivacyCovered()) {
        setCovered(true); concealedSid.current = authRef.current.session?.sessionId ?? null;
        authRef.current.concealForAccountTransition(); setAllowSignIn(false);
      }
      void refreshStatus();
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refreshStatus(); };
    window.addEventListener("storage", onStorage); document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("storage", onStorage); document.removeEventListener("visibilitychange", onVisible); };
  }, [refreshStatus]);

  // Genuine ordinary sign-in/MFA is admitted by Auth as Active/proofId=null.
  // Refresh owner status once per new sid; do not turn polling into activity.
  const observedSid = useRef<string | undefined>(undefined);
  useEffect(() => {
    const sid = auth.session?.sessionId;
    if (observedSid.current === sid) return;
    const previous = observedSid.current;
    observedSid.current = sid;
    if (sid) { concealedSid.current = null; void refreshStatus(); return; }
    if (!previous) return;
    if (concealedSid.current === previous) { concealedSid.current = null; return; }
    if (inFlight.current || pendingRef.current || auth.isRestoring || auth.restoringIdentity || !currentRef.current.csrfToken) return;
    // Genuine normal logout owns no device transition. Check once, never poll,
    // refresh an account or infer that the server has closed the active child.
    try { hide(); } catch { /* Keep the local tree/cache boundary concealed. */ }
    void refreshStatus();
  }, [auth.isRestoring, auth.restoringIdentity, auth.session?.sessionId, hide, refreshStatus]);

  useEffect(() => {
    const active = current.active;
    if (!active || current.state !== rememberedState.active || !auth.session ||
      auth.session.sessionId !== active.sessionId || auth.session.subjectId !== active.memberId) return;
    if (allowSignIn || (!accountPrivacyCovered() && !pendingRef.current && covered)) {
      try { clearAccountPrivacy(); setCovered(false); setAllowSignIn(false); }
      catch { setMessage("Browser storage is unavailable. Enable it before using shared-account switching."); }
    }
    const deadlines = [current.idleExpiresAtUtc, current.absoluteExpiresAtUtc].filter(Boolean).map(value => Date.parse(value!)).filter(Number.isFinite);
    if (!deadlines.length) return;
    const delay = Math.max(0, Math.min(...deadlines) - Date.now());
    const timer = window.setTimeout(() => void switchAccount(), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [allowSignIn, auth.session, covered, current, switchAccount]);

  useEffect(() => {
    if (current.state !== rememberedState.active || covered || !auth.session || auth.session.sessionId !== current.active?.sessionId) return;
    let lastActivity = 0;
    const onInput = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== "visible" || Date.now() - lastActivity < 30_000 || inFlight.current) return;
      lastActivity = Date.now();
      const snapshot = currentRef.current;
      const actor = authRef.current.session;
      if (!actor || actor.sessionId !== snapshot.active?.sessionId) return;
      void rememberedOperation("activity", { expectedGeneration: snapshot.generation, sessionId: actor.sessionId }, actor).then(result => {
        if (!inFlight.current && currentRef.current.generation === snapshot.generation && authRef.current.session?.sessionId === actor.sessionId) {
          update(result.current);
          if (result.outcome !== rememberedOutcome.applied) {
            try { hide(); } catch { /* Do not expose an unconfirmed actor. */ }
            setMessage(rememberedOutcomeMessage(result.outcome));
          }
        }
      }).catch(() => { /* Keep the existing deadline; do not assume an extension. */ });
    };
    window.addEventListener("pointerdown", onInput, true); window.addEventListener("keydown", onInput, true);
    return () => { window.removeEventListener("pointerdown", onInput, true); window.removeEventListener("keydown", onInput, true); };
  }, [auth.session, covered, current.active?.sessionId, current.state, hide, update]);

  const activeMatches = Boolean(auth.session && current.active && auth.session.sessionId === current.active.sessionId && auth.session.subjectId === current.active.memberId);
  const managed = current.state !== rememberedState.missing && current.state !== rememberedState.revoked;
  // A browser with no remembered accounts has no account-switch boundary to
  // unlock. This is the normal first-run state for a new user, so let the
  // ordinary auth/workspace-onboarding flow render. Keeping the check tied to
  // both collections avoids bypassing the boundary if the server does return
  // an active remembered account.
  const emptyRememberedBrowser = isEmptyRememberedBrowser(current) && !pending && !covered;
  const restoringExactActive = !covered && current.state === rememberedState.active &&
    auth.restoringIdentity?.sessionId === current.active?.sessionId && (auth.isRestoring || Boolean(auth.restorationError));
  const showNormal = emptyRememberedBrowser || (!pending && ((allowSignIn && !auth.session) ||
    restoringExactActive ||
    (!covered && (!managed || (current.state === rememberedState.active && activeMatches)))));
  const securing = !showNormal && (current.state === rememberedState.unavailable ||
    pending?.kind === "lock" || pending?.kind === "begin-sign-in" || pending?.kind === "cancel-sign-in" || pending?.kind === "forget" || pending?.kind === "forget-device" ||
    (current.state === rememberedState.active && !selected && (!pending || pending.kind === "remember")));
  return <Context.Provider value={{ enabled: true, current, busy, message, switchAccount, rememberAccount, forgetOwnAccount,
    signInAgain: signIn, returnToAccounts: cancelSignIn }}>
    {showNormal ? children : <AccountSwitchScreen accounts={current.accounts ?? []} selected={selected} pinDigits={current.pinDigits}
      busy={busy} securing={securing} message={message} recovery={Boolean(pending)} onChoose={account => {
        if (pendingRef.current) return;
        if (account.requiresSignIn) void signIn(); else { setSelected(account); setMessage(""); }
      }} onBack={() => { if (!pendingRef.current) { setSelected(null); setMessage(""); } }} onUnlock={unlock}
      onSignIn={() => void signIn()} onRetry={() => void retry()} checkingChange={pending?.kind === "remember"}
      onCancelUnconfirmed={cancelGeneration === null ? undefined : cancelUnconfirmedRemember}
      onForgetBrowser={current.csrfToken && !pending ? forgetBrowser : undefined} />}
  </Context.Provider>;
}
