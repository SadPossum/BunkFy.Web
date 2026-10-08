export type StationAttempt = {
  kind: "lock" | "unlock" | "check-in" | "check-out";
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
const CHECK_OUT_KEY = "bunkfy.station.check-out.v1";
const QUARANTINED_CHECK_OUT_KEY = "bunkfy.station.check-out-review.v1";
type StationJobKind = "check-in" | "check-out";
const jobKey = (kind: StationJobKind) => kind === "check-in" ? JOB_KEY : CHECK_OUT_KEY;
const reviewKey = (kind: StationJobKind) => kind === "check-in" ? QUARANTINED_JOB_KEY : QUARANTINED_CHECK_OUT_KEY;

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
    if ((v.kind === "check-in" || v.kind === "check-out") && isId(v.actorSessionId) && isId(v.reservationId) && positive(v.expectedVersion))
      return { ...base, kind: v.kind, actorSessionId: v.actorSessionId, reservationId: v.reservationId, expectedVersion: v.expectedVersion };
    return null;
  } catch { return null; }
}

export function readStationAttempt(kind: StationAttempt["kind"]): StationAttempt | null {
  try {
    const attempt = parseStationAttempt(kind === "lock" ? localStorage.getItem(STATION_LOCK_KEY)
      : sessionStorage.getItem(kind === "unlock" ? ATTEMPT_KEY : jobKey(kind)));
    return attempt?.kind === kind ? attempt : null;
  } catch { return null; }
}

/** Corrupt or inaccessible storage is not proof that an earlier lock finished. */
export function hasStationLockBarrier(): boolean {
  try { return localStorage.getItem(STATION_LOCK_KEY) !== null; } catch { return true; }
}

export function readQuarantinedCheckIn(): StationAttempt | null {
  return readQuarantinedJob("check-in");
}

export function readQuarantinedCheckOut(): StationAttempt | null {
  return readQuarantinedJob("check-out");
}

function readQuarantinedJob(kind: StationJobKind): StationAttempt | null {
  try {
    const attempt = parseStationAttempt(sessionStorage.getItem(reviewKey(kind)));
    return attempt?.kind === kind ? attempt : null;
  } catch { return null; }
}

/** Two slots only: never overwrite an older uncertain action to start a new one. */
export function quarantineCheckIn(attempt: StationAttempt) {
  quarantineJob("check-in", attempt);
}

export function quarantineCheckOut(attempt: StationAttempt) {
  quarantineJob("check-out", attempt);
}

function quarantineJob(kind: StationJobKind, attempt: StationAttempt) {
  const clean = parseStationAttempt(JSON.stringify(attempt));
  if (clean?.kind !== kind) throw new Error(`Invalid ${kind} recovery reference.`);
  const existingRaw = sessionStorage.getItem(reviewKey(kind));
  const existing = readQuarantinedJob(kind);
  if (existingRaw !== null && existing?.operationId !== clean.operationId) throw new Error(`An earlier ${kind} still needs review.`);
  sessionStorage.setItem(reviewKey(kind), JSON.stringify(clean));
  if (readStationAttempt(kind)?.operationId === clean.operationId) saveStationAttempt(kind, null);
}

export function clearConfirmedCheckIn(operationId: string) {
  clearConfirmedJob("check-in", operationId);
}

export function clearConfirmedCheckOut(operationId: string) {
  clearConfirmedJob("check-out", operationId);
}

function clearConfirmedJob(kind: StationJobKind, operationId: string) {
  // A late response can clear only its own exact operation, not the next staff member's work.
  if (readStationAttempt(kind)?.operationId === operationId) saveStationAttempt(kind, null);
  if (readQuarantinedJob(kind)?.operationId === operationId) sessionStorage.removeItem(reviewKey(kind));
}

export function saveStationAttempt(kind: StationAttempt["kind"], attempt: StationAttempt | null) {
  const storage = kind === "lock" ? localStorage : sessionStorage;
  const key = kind === "lock" ? STATION_LOCK_KEY : kind === "unlock" ? ATTEMPT_KEY : jobKey(kind);
  if (attempt) {
    const clean = parseStationAttempt(JSON.stringify(attempt));
    if (!clean || clean.kind !== kind) throw new Error("Invalid station recovery reference.");
    storage.setItem(key, JSON.stringify(clean));
  } else storage.removeItem(key);
}
