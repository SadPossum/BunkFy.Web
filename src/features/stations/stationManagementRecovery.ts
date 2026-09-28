import type { StationManagementRequest } from "./stationTypes";

export type ManagementCommand = Pick<StationManagementRequest, "kind" | "expectedVersion"> & Partial<StationManagementRequest>;
export type ManagementRecovery = { id: string; command: ManagementCommand };
export type PairingContext = { stationId: string; browserSessionId: string; originalIssuerSessionId: string };
const id = (value: unknown): value is string => typeof value === "string" && value !== "00000000-0000-0000-0000-000000000000" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const commandKinds = new Set([1, 5, 6, 7, 9, 10, 11, 12, 13, 14]);
const labelLifetimeMs = 2 * 60 * 60 * 1000;
const stationLabel = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 100 &&
  value.trim() === value && !/\p{Cc}/u.test(value);

export function readManagementRecovery(key: string): ManagementRecovery | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`${key}:operation`) ?? "null") as Record<string, unknown> | null;
    if (!value || !id(value.id) || !value.command || typeof value.command !== "object") return null;
    const command = value.command as Record<string, unknown>;
    if (typeof command.kind !== "number" || !commandKinds.has(command.kind) ||
      typeof command.expectedVersion !== "number" || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) return null;
    const clean: ManagementCommand = { kind: command.kind as ManagementCommand["kind"], expectedVersion: command.expectedVersion };
    for (const name of ["stationId", "browserSessionId", "staffMemberId"] as const) {
      if (command[name] != null) { if (!id(command[name])) return null; clean[name] = command[name]; }
    }
    if (command.kind === 1 && stationLabel(command.label) && typeof value.startedAt === "number" &&
      value.startedAt <= Date.now() && Date.now() - value.startedAt < labelLifetimeMs) clean.label = command.label;
    if (command.label !== undefined && clean.label === undefined) {
      try { sessionStorage.setItem(`${key}:operation`, JSON.stringify({ id: value.id, command: clean })); }
      catch { /* Retain the operation coordinates even when storage cleanup fails. */ }
    }
    return { id: value.id, command: clean };
  } catch { return null; }
}

export function saveManagementRecovery(key: string, value: ManagementRecovery | null) {
  if (!value) { sessionStorage.removeItem(`${key}:operation`); return; }
  // Only Register's display label is kept briefly for exact same-operation recovery.
  // Never keep setup grants, PINs, credentials or bearer/CSRF tokens.
  const { kind, expectedVersion, stationId, browserSessionId, staffMemberId } = value.command;
  sessionStorage.setItem(`${key}:operation`, JSON.stringify({ id: value.id, startedAt: Date.now(),
    command: { kind, expectedVersion, stationId, browserSessionId, staffMemberId,
      ...(kind === 1 && stationLabel(value.command.label) ? { label: value.command.label } : {}) } }));
}

export function readPairingContext(key: string): PairingContext | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`${key}:securing`) ?? "null") as Record<string, unknown> | null;
    if (!value || !id(value.stationId) || !id(value.browserSessionId) || !id(value.originalIssuerSessionId)) return null;
    return { stationId: value.stationId, browserSessionId: value.browserSessionId, originalIssuerSessionId: value.originalIssuerSessionId };
  } catch { return null; }
}

export function savePairingContext(key: string, value: PairingContext | null) {
  if (!value) { sessionStorage.removeItem(`${key}:securing`); return; }
  sessionStorage.setItem(`${key}:securing`, JSON.stringify({ stationId: value.stationId,
    browserSessionId: value.browserSessionId, originalIssuerSessionId: value.originalIssuerSessionId }));
}
