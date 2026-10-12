const KEY = "bunkfy.account-switch.pending.v1";
const BARRIER = "bunkfy.account-switch.cover.v1";

export type AccountOperationKind = "remember" | "select" | "lock" | "begin-sign-in" | "cancel-sign-in" | "forget" | "forget-device";
export type AccountOperation = {
  operationId: string;
  expectedGeneration: number;
  kind: AccountOperationKind;
  proofId?: string;
  supersededOperationId?: string;
};
const kinds = new Set<AccountOperationKind>(["remember", "select", "lock", "begin-sign-in", "cancel-sign-in", "forget", "forget-device"]);
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readAccountOperation(): AccountOperation | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.operationId !== "string" || !guid.test(v.operationId) ||
      typeof v.expectedGeneration !== "number" || !Number.isSafeInteger(v.expectedGeneration) || v.expectedGeneration < 0 ||
      typeof v.kind !== "string" || !kinds.has(v.kind as AccountOperationKind) ||
      (v.proofId !== undefined && (typeof v.proofId !== "string" || !guid.test(v.proofId))) ||
      (v.supersededOperationId !== undefined && (v.kind !== "lock" || typeof v.supersededOperationId !== "string" ||
        !guid.test(v.supersededOperationId) || v.supersededOperationId === v.operationId))) return null;
    // Reconstruct allowlisted nonsecret coordinates. Never retain unknown keys.
    return { operationId: v.operationId, expectedGeneration: v.expectedGeneration,
      kind: v.kind as AccountOperationKind, ...(typeof v.proofId === "string" ? { proofId: v.proofId } : {}),
      ...(typeof v.supersededOperationId === "string" ? { supersededOperationId: v.supersededOperationId } : {}) };
  } catch { return null; }
}

export function saveAccountOperation(operation: AccountOperation): void {
  const safe: AccountOperation = { operationId: operation.operationId,
    expectedGeneration: operation.expectedGeneration, kind: operation.kind,
    ...(operation.proofId ? { proofId: operation.proofId } : {}),
    ...(operation.supersededOperationId ? { supersededOperationId: operation.supersededOperationId } : {}) };
  if (!guid.test(safe.operationId) || !Number.isSafeInteger(safe.expectedGeneration) || safe.expectedGeneration < 0 ||
    !kinds.has(safe.kind) || (safe.proofId && !guid.test(safe.proofId)) ||
    (safe.supersededOperationId && (safe.kind !== "lock" || !guid.test(safe.supersededOperationId) || safe.supersededOperationId === safe.operationId))) {
    throw new Error("Invalid account-change reference.");
  }
  const existing = readAccountOperation();
  if (existing && JSON.stringify(existing) !== JSON.stringify(safe)) {
    throw new Error("Resolve the previous account change before starting another.");
  }
  sessionStorage.setItem(KEY, JSON.stringify(safe));
}

// Deliberate cancellation only: caller has checked the original outcome and
// current server generation. One atomic write preserves the old reference even
// if the new Lock loses its CAS or its response is lost. General save collisions
// remain forbidden. Nothing here asserts a remote cancellation or stores a PIN.
export function supersedeRememberWithLock(previous: AccountOperation, operationId: string, generation: number): AccountOperation {
  const existing = readAccountOperation();
  if (!existing || JSON.stringify(existing) !== JSON.stringify(previous) ||
    (existing.kind !== "remember" && !(existing.kind === "lock" && existing.supersededOperationId)) ||
    !guid.test(operationId) || operationId === existing.operationId ||
    !Number.isSafeInteger(generation) || generation < existing.expectedGeneration ||
    (existing.kind === "remember" && generation !== existing.expectedGeneration)) {
    throw new Error("The unconfirmed setup must be checked before locking this browser.");
  }
  const next: AccountOperation = { operationId, expectedGeneration: generation, kind: "lock",
    supersededOperationId: existing.supersededOperationId ?? existing.operationId };
  if (next.operationId === next.supersededOperationId) throw new Error("A lock needs its own reference.");
  sessionStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearAccountOperation(operationId: string): void {
  if (readAccountOperation()?.operationId === operationId) sessionStorage.removeItem(KEY);
}

export function accountPrivacyCovered(): boolean {
  try { return localStorage.getItem(BARRIER) !== null; }
  catch { return true; }
}

// Shared across tabs; contains no identity, account list or secret. Storage
// failure is not permission to expose the previous actor or claim server lock.
export function coverAccountPrivacy(): void { localStorage.setItem(BARRIER, "covered"); }
export function clearAccountPrivacy(): void { localStorage.removeItem(BARRIER); }
export function isAccountPrivacyEvent(key: string | null): boolean { return key === BARRIER || key === null; }

export function safeAccountReturnPath(pathname: string): string {
  return new Set(["/", "/calendar", "/reservations", "/guests", "/spaces", "/account", "/workspace", "/staff", "/integrations", "/privacy-requests", "/notifications"])
    .has(pathname) ? pathname : "/";
}
