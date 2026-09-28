export type PinChangeIntent = { operationId: string; expectedRevision: number; startedAt: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deliberately only non-secret operation coordinates. Never store PIN digits or tokens.
export function readPinChangeIntent(key: string): PinChangeIntent | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    if (typeof value.operationId !== "string" || !uuid.test(value.operationId) ||
      typeof value.expectedRevision !== "number" || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 ||
      typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt)) return null;
    return { operationId: value.operationId, expectedRevision: value.expectedRevision, startedAt: value.startedAt };
  } catch { return null; }
}

export function savePinChangeIntent(key: string, intent: PinChangeIntent | null) {
  if (intent) sessionStorage.setItem(key, JSON.stringify({ operationId: intent.operationId,
    expectedRevision: intent.expectedRevision, startedAt: intent.startedAt }));
  else sessionStorage.removeItem(key);
}
