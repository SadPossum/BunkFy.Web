export type SessionIdentity = {
  tenantId: string;
  username: string;
  subjectId?: string;
  sessionId?: string;
  generation?: string;
};

const BROWSER_SESSION_LOCK_NAME = "bunkfy.browser-session.cookies";

export function hasSessionBoundaryChanged(
  current: SessionIdentity | null,
  next: SessionIdentity | null,
): boolean {
  if (!current || !next) return current !== next;

  return current.tenantId !== next.tenantId ||
    current.username.toLowerCase() !== next.username.toLowerCase();
}

export function hasSessionIdentityChanged(
  current: SessionIdentity | null,
  next: SessionIdentity | null,
): boolean {
  if (!current || !next) return current !== next;

  if (current.subjectId && next.subjectId) {
    return current.subjectId.toLowerCase() !== next.subjectId.toLowerCase();
  }

  return current.username.toLowerCase() !== next.username.toLowerCase();
}

export function hasSessionActorGenerationChanged(
  current: SessionIdentity | null,
  next: SessionIdentity | null,
): boolean {
  if (hasSessionIdentityChanged(current, next)) return true;
  if (!current || !next) return current !== next;
  if (current.generation && next.generation) {
    return current.generation !== next.generation;
  }
  if (current.sessionId && next.sessionId) {
    return current.sessionId.toLowerCase() !== next.sessionId.toLowerCase();
  }
  return false;
}

export async function runWithBrowserSessionLock<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  if (typeof navigator === "undefined" || !navigator.locks) return operation();

  return await navigator.locks.request(
    BROWSER_SESSION_LOCK_NAME,
    { mode: "exclusive" },
    operation,
  );
}

export function startBrowserSessionSignOut(
  clearLocalSession: () => void,
  revokeRemoteSession?: () => Promise<void>,
): void {
  clearLocalSession();

  if (!revokeRemoteSession) return;

  void runWithBrowserSessionLock(revokeRemoteSession).catch(() => {
    // Local sign-out must succeed even when remote revocation is unavailable.
  });
}

export function createSingleFlightRefresh<TResult>(
  refresh: (identity: SessionIdentity) => Promise<TResult>,
): (identity: SessionIdentity) => Promise<TResult> {
  let pending: { key: string; operation: Promise<TResult> } | null = null;

  return (identity) => {
    const key = sessionIdentityKey(identity);
    if (pending?.key === key) return pending.operation;

    const operation = refresh(identity).finally(() => {
      if (pending?.operation === operation) pending = null;
    });
    pending = { key, operation };
    return operation;
  };
}

export function sessionIdentityKey(identity: SessionIdentity | null): string {
  if (!identity) return "signed-out";
  return JSON.stringify({
    tenantId: identity.tenantId,
    subject: identity.subjectId?.toLowerCase() || identity.username.toLowerCase(),
    sessionId: identity.sessionId?.toLowerCase() || "",
    generation: identity.generation || "",
  });
}
