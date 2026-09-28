export type StationAttempt = {
  kind: "lock" | "unlock" | "check-in";
  operationId: string;
  browserSessionId: string;
  generation: number;
  staffMemberId?: string;
  actorSessionId?: string;
  reservationId?: string;
  expectedVersion?: number;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && uuid.test(value) && value !== "00000000-0000-0000-0000-000000000000";
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export const STATION_LOCK_KEY = "bunkfy.station.lock-recovery.v1";
const ATTEMPT_KEY = "bunkfy.station.attempt.v1";
const JOB_KEY = "bunkfy.station.check-in.v1";
const QUARANTINED_JOB_KEY = "bunkfy.station.check-in-review.v1";

/** Allowlist non-secret concurrency references. No PIN, CSRF, setup grant, labels or guest data. */
export function parseStationAttempt(raw: string | null): StationAttempt | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    if (!isId(v.operationId) || !isId(v.browserSessionId) || !positive(v.generation)) return null;
    const base = { operationId: v.operationId, browserSessionId: v.browserSessionId, generation: v.generation };
    if (v.kind === "lock") return { ...base, kind: "lock" };
    if (v.kind === "unlock" && isId(v.staffMemberId)) return { ...base, kind: "unlock", staffMemberId: v.staffMemberId };
    if (v.kind === "check-in" && isId(v.actorSessionId) && isId(v.reservationId) && positive(v.expectedVersion))
      return { ...base, kind: "check-in", actorSessionId: v.actorSessionId, reservationId: v.reservationId, expectedVersion: v.expectedVersion };
    return null;
  } catch { return null; }
}

export function readStationAttempt(kind: StationAttempt["kind"]): StationAttempt | null {
  try {
    const attempt = parseStationAttempt(kind === "lock" ? localStorage.getItem(STATION_LOCK_KEY)
      : sessionStorage.getItem(kind === "check-in" ? JOB_KEY : ATTEMPT_KEY));
    return attempt?.kind === kind ? attempt : null;
  } catch { return null; }
}

/** Corrupt or inaccessible storage is not proof that an earlier lock finished. */
export function hasStationLockBarrier(): boolean {
  try { return localStorage.getItem(STATION_LOCK_KEY) !== null; } catch { return true; }
}

export function readQuarantinedCheckIn(): StationAttempt | null {
  try {
    const attempt = parseStationAttempt(sessionStorage.getItem(QUARANTINED_JOB_KEY));
    return attempt?.kind === "check-in" ? attempt : null;
  } catch { return null; }
}

/** Two slots only: never overwrite an older uncertain action to start a new one. */
export function quarantineCheckIn(attempt: StationAttempt) {
  const clean = parseStationAttempt(JSON.stringify(attempt));
  if (clean?.kind !== "check-in") throw new Error("Invalid check-in recovery reference.");
  const existingRaw = sessionStorage.getItem(QUARANTINED_JOB_KEY);
  const existing = readQuarantinedCheckIn();
  if (existingRaw !== null && existing?.operationId !== clean.operationId) throw new Error("An earlier check-in still needs review.");
  sessionStorage.setItem(QUARANTINED_JOB_KEY, JSON.stringify(clean));
  if (readStationAttempt("check-in")?.operationId === clean.operationId) saveStationAttempt("check-in", null);
}

export function clearConfirmedCheckIn(operationId: string) {
  // A late response can clear only its own exact operation, not the next staff member's work.
  if (readStationAttempt("check-in")?.operationId === operationId) saveStationAttempt("check-in", null);
  if (readQuarantinedCheckIn()?.operationId === operationId) sessionStorage.removeItem(QUARANTINED_JOB_KEY);
}

export function saveStationAttempt(kind: StationAttempt["kind"], attempt: StationAttempt | null) {
  const storage = kind === "lock" ? localStorage : sessionStorage;
  const key = kind === "lock" ? STATION_LOCK_KEY : kind === "check-in" ? JOB_KEY : ATTEMPT_KEY;
  if (attempt) {
    const clean = parseStationAttempt(JSON.stringify(attempt));
    if (!clean || clean.kind !== kind) throw new Error("Invalid station recovery reference.");
    storage.setItem(key, JSON.stringify(clean));
  } else storage.removeItem(key);
}
