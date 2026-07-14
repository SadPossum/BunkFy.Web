export type SessionIdentity = { tenantId: string; username: string };

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

  return current.username.toLowerCase() !== next.username.toLowerCase();
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
  let pending: Promise<TResult> | null = null;

  return (identity) => {
    if (pending) return pending;

    const operation = refresh(identity).finally(() => {
      if (pending === operation) pending = null;
    });
    pending = operation;
    return operation;
  };
}
