const SESSION_IDENTITY_KEY = "bunkfy.session.identity.v2";

/**
 * Shared-account switching belongs to an established workspace on a shared
 * desktop. A phone or a global-only session must stay on ordinary auth so the
 * PIN boundary cannot replace onboarding or personal sign-in.
 */
export function canUseSharedAccountSwitch(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const userAgentData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
    return false;
  }

  if (typeof window.matchMedia === "function" && !window.matchMedia("(min-width: 1024px)").matches) {
    return false;
  }

  return hasPersistedWorkspaceSession();
}

function hasPersistedWorkspaceSession(): boolean {
  try {
    const raw = window.localStorage.getItem(SESSION_IDENTITY_KEY);
    if (!raw) return false;
    const value = JSON.parse(raw) as { tenantId?: unknown };
    return typeof value.tenantId === "string" && value.tenantId.trim().length > 0 && value.tenantId !== "global";
  } catch {
    return false;
  }
}
