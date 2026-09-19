import type { ApiSession } from "../../api/client";
import type { Reservation, RoomInventory } from "../../api/types";
import type { CalendarBookingTarget } from "../calendar/calendarBookingRoute";

export const reservationRecoveryKey = "bunkfy.reservation-create-recovery.v1";
export const reservationRecoveryEvent = "bunkfy:reservation-create-recovery";
export type ReservationRecoveryCoordinate = {
  version: 1;
  tenantId: string;
  subjectId: string;
  sessionId: string;
  propertyId: string;
  operationId: string;
  state: "prepared" | "primary-confirmed" | "follow-on-unknown" | "complete" | "handed-off";
  followOnNeeded: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ReservationRecoverySnapshot =
  | { kind: "none" }
  | { kind: "unavailable" }
  | { kind: "malformed" }
  | { kind: "record"; record: ReservationRecoveryCoordinate };
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = ["version", "tenantId", "subjectId", "sessionId", "propertyId", "operationId", "state", "followOnNeeded", "createdAt", "updatedAt"];
const states = ["prepared", "primary-confirmed", "follow-on-unknown", "complete", "handed-off"];

export function parseReservationRecovery(raw: string | null): ReservationRecoverySnapshot {
  if (raw === null) return { kind: "none" };
  try {
    if (raw.length > 1800) return { kind: "malformed" };
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length
      || Object.keys(value).some((key) => !fields.includes(key)) || value.version !== 1
      || ["tenantId", "subjectId", "sessionId", "propertyId", "operationId"].some((key) => typeof value[key] !== "string" || !uuid.test(value[key] as string))
      || !states.includes(String(value.state)) || typeof value.followOnNeeded !== "boolean"
      || ["createdAt", "updatedAt"].some((key) => typeof value[key] !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value[key] as string) || !Number.isFinite(Date.parse(value[key] as string)))) return { kind: "malformed" };
    return { kind: "record", record: value as ReservationRecoveryCoordinate };
  } catch { return { kind: "malformed" }; }
}

function browserStorage(): RecoveryStorage {
  if (typeof window === "undefined") throw new Error("Tab storage unavailable");
  return window.sessionStorage;
}

export function readReservationRecovery(storage?: RecoveryStorage): ReservationRecoverySnapshot {
  try { return parseReservationRecovery((storage ?? browserStorage()).getItem(reservationRecoveryKey)); }
  catch { return { kind: "unavailable" }; }
}

export function recoveryMatchesSession(record: ReservationRecoveryCoordinate, session: ApiSession | null): boolean {
  return Boolean(session && record.tenantId === session.tenantId && record.subjectId === session.subjectId && record.sessionId === session.sessionId);
}

export function reservationRecoveryTargetMatches(reservation: Reservation, propertyId: string, target: CalendarBookingTarget | undefined, rooms: RoomInventory[] | undefined, roomsCurrent: boolean): boolean {
  if (!target || !roomsCurrent || reservation.propertyId !== propertyId || reservation.arrival !== target.arrival
    || reservation.departure !== target.departure || reservation.inventoryUnitIds?.length !== 1
    || reservation.inventoryUnitIds[0] !== target.inventoryUnitId) return false;
  const room = rooms?.find((item) => item.propertyId === propertyId && item.roomId === target.roomId);
  return Boolean(room?.units.some((unit) => unit.propertyId === propertyId && unit.roomId === target.roomId
    && unit.inventoryUnitId === target.inventoryUnitId && (unit.bedId ?? undefined) === target.bedId));
}

export function newReservationRecoveryCoordinate(session: ApiSession | null, propertyId: string, operationId: string, followOnNeeded: boolean, now = new Date().toISOString()): ReservationRecoveryCoordinate {
  const record = { version: 1 as const, tenantId: session?.tenantId ?? "", subjectId: session?.subjectId ?? "", sessionId: session?.sessionId ?? "", propertyId, operationId, state: "prepared" as const, followOnNeeded, createdAt: now, updatedAt: now };
  if (parseReservationRecovery(JSON.stringify(record)).kind !== "record") throw new Error("Your authenticated session could not be matched for safe recovery. Sign in again before saving.");
  return record;
}

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(reservationRecoveryEvent));
}

export function storeReservationRecovery(record: ReservationRecoveryCoordinate, storage?: RecoveryStorage): void {
  try {
    const target = storage ?? browserStorage();
    const before = readReservationRecovery(target);
    if (before.kind !== "none" && (before.kind !== "record" || !sameCoordinate(before.record, record))) throw new Error();
    const serialized = JSON.stringify(record);
    if (parseReservationRecovery(serialized).kind !== "record") throw new Error();
    target.setItem(reservationRecoveryKey, serialized);
    if (target.getItem(reservationRecoveryKey) !== serialized) throw new Error();
    notify();
  } catch {
    notify();
    throw new Error("This tab could not save its recovery marker. No new reservation will be sent without confirmed tab storage. Allow session storage and try again.");
  }
}

export function updateReservationRecovery(record: ReservationRecoveryCoordinate, state: ReservationRecoveryCoordinate["state"], followOnNeeded = record.followOnNeeded, storage?: RecoveryStorage): ReservationRecoveryCoordinate {
  const updated = { ...record, state, followOnNeeded, updatedAt: new Date().toISOString() };
  storeReservationRecovery(updated, storage);
  return updated;
}

export function clearReservationRecovery(expected: ReservationRecoveryCoordinate | null, storage?: RecoveryStorage): void {
  const target = storage ?? browserStorage();
  const current = readReservationRecovery(target);
  if (current.kind === "unavailable" || (!expected && current.kind === "record")) throw new Error("The recovery marker changed or is unavailable. Check its current state before clearing it.");
  if (expected && (current.kind !== "record" || !sameCoordinate(current.record, expected))) throw new Error("The recovery marker changed. Check its current state before clearing it.");
  target.removeItem(reservationRecoveryKey);
  if (target.getItem(reservationRecoveryKey) !== null) throw new Error("The recovery marker could not be removed. Allow tab storage and retry.");
  notify();
}

function sameCoordinate(left: ReservationRecoveryCoordinate, right: ReservationRecoveryCoordinate): boolean {
  return left.tenantId === right.tenantId && left.subjectId === right.subjectId && left.sessionId === right.sessionId
    && left.propertyId === right.propertyId && left.operationId === right.operationId;
}
