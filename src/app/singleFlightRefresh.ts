export type SessionIdentity = { tenantId: string; username: string };

const BROWSER_SESSION_LOCK_NAME = "bunkfy.browser-session.cookies";

export async function runWithBrowserSessionLock<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  if (typeof navigator === "undefined" || !navigator.locks) return operation();

  return await navigator.locks.request(
    BROWSER_SESSION_LOCK_NAME,
    { mode: "exclusive" },
    operation,
  );
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
