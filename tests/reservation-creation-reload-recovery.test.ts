import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Reservation, RoomInventory } from "../src/api/types";
import {
  clearReservationRecovery, newReservationRecoveryCoordinate, parseReservationRecovery, readReservationRecovery,
  recoveryMatchesSession, reservationRecoveryKey, reservationRecoveryTargetMatches, storeReservationRecovery, updateReservationRecovery,
} from "../src/features/reservations/reservationCreationRecovery";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = { tenantId: id(1), subjectId: id(2), sessionId: id(3), accessToken: "never-persist", username: "Never persist", generation: "first-memory-generation" };
const coordinate = () => newReservationRecoveryCoordinate(session, id(4), id(5), true, "2026-09-06T11:00:00.000Z");
class TabStorage {
  value: string | null = null;
  getItem(key: string) { expect(key).toBe(reservationRecoveryKey); return this.value; }
  setItem(key: string, value: string) { expect(key).toBe(reservationRecoveryKey); this.value = value; }
  removeItem(key: string) { expect(key).toBe(reservationRecoveryKey); this.value = null; }
}
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("opaque same-tab reservation creation recovery", () => {
  it("stores only the exact versioned coordinate and verifies it before dispatch", () => {
    const storage = new TabStorage(); const record = coordinate(); storeReservationRecovery(record, storage);
    expect(readReservationRecovery(storage)).toEqual({ kind: "record", record });
    expect(Object.keys(JSON.parse(storage.value!)).sort()).toEqual(["version", "tenantId", "subjectId", "sessionId", "propertyId", "operationId", "state", "followOnNeeded", "createdAt", "updatedAt"].sort());
    expect(storage.value).not.toContain("never-persist"); expect(storage.value).not.toContain("generation");
    const create = source("features/reservations/CreateReservationModal.tsx");
    expect(create.indexOf("storeReservationRecovery(coordinate)")).toBeLessThan(create.indexOf("variables.dispatched = true"));
    expect(create.indexOf("variables.dispatched = true")).toBeLessThan(create.indexOf("await request<ReservationMutationReceipt>"));
    expect(create).toContain("created.reservationId !== operationId");
  });
  it("matches stable authenticated identity across reload, never token or in-memory generation", () => {
    const record = coordinate();
    expect(recoveryMatchesSession(record, { ...session, generation: "after-reload", accessToken: "new-access-token" })).toBe(true);
    for (const key of ["tenantId", "subjectId", "sessionId"] as const) expect(recoveryMatchesSession(record, { ...session, [key]: id(9) })).toBe(false);
    expect(recoveryMatchesSession(record, null)).toBe(false);
    expect(() => newReservationRecoveryCoordinate({ ...session, sessionId: undefined }, id(4), id(5), false)).toThrow("Sign in again");
  });
  it("retains explicit states including uncertain guest follow-on until handoff", () => {
    const storage = new TabStorage(); let record = coordinate(); storeReservationRecovery(record, storage);
    for (const state of ["primary-confirmed", "follow-on-unknown", "complete", "handed-off"] as const) {
      record = updateReservationRecovery(record, state, state !== "complete" && state !== "handed-off", storage);
      expect(readReservationRecovery(storage)).toEqual({ kind: "record", record });
    }
    clearReservationRecovery(record, storage); expect(readReservationRecovery(storage)).toEqual({ kind: "none" });
  });
  it("does not silently expire a valid unresolved request", () => {
    expect(parseReservationRecovery(JSON.stringify({ ...coordinate(), createdAt: "2001-01-01T00:00:00.000Z", updatedAt: "2001-01-01T00:00:00.000Z" })).kind).toBe("record");
  });
  it.each(["{", "null", "[]", JSON.stringify({ ...coordinate(), version: 2 }), JSON.stringify({ ...coordinate(), guestName: "Forbidden" }), JSON.stringify({ ...coordinate(), propertyId: "../other" }), JSON.stringify({ ...coordinate(), state: "expired" }), JSON.stringify({ ...coordinate(), updatedAt: "not a date" })])("keeps malformed/unsupported metadata visible and inert: %s", (raw) => {
    expect(parseReservationRecovery(raw)).toEqual({ kind: "malformed" });
  });
  it("blocks unconfirmed storage and never overwrites another unresolved coordinate", () => {
    const storage = new TabStorage();
    const blocked = { ...storage, getItem() { throw new Error("storage blocked"); }, setItem() {}, removeItem() {} };
    expect(readReservationRecovery(blocked)).toEqual({ kind: "unavailable" });
    expect(() => storeReservationRecovery(coordinate(), blocked)).toThrow("No new reservation");
    expect(() => storeReservationRecovery(coordinate(), { getItem: () => null, setItem() {}, removeItem() {} })).toThrow("confirmed tab storage");
    storeReservationRecovery(coordinate(), storage);
    expect(() => storeReservationRecovery({ ...coordinate(), operationId: id(6) }, storage)).toThrow();
    expect(readReservationRecovery(storage)).toEqual({ kind: "record", record: coordinate() });
  });
  it("requires deliberate exact cleanup and cannot remove a newly replaced marker", () => {
    const storage = new TabStorage(); storage.value = "malformed";
    clearReservationRecovery(null, storage); expect(storage.value).toBeNull();
    storeReservationRecovery(coordinate(), storage);
    expect(() => clearReservationRecovery(null, storage)).toThrow();
    expect(() => clearReservationRecovery({ ...coordinate(), sessionId: id(8) }, storage)).toThrow();
    expect(storage.value).not.toBeNull();
  });
  it("has GET-only reload recovery, read-authority/abort fences and explicit 404 race handling", () => {
    const panel = source("features/reservations/ReservationCreationRecovery.tsx");
    expect(panel).toContain("!exactProperty || !mayReadCurrent || !contextReady || pending");
    expect(panel).toContain("{ signal: controller.signal }");
    expect(panel).toContain("latest.current.identity !== identity || !latest.current.mayReadCurrent");
    expect(panel).toContain("reservation.reservationId !== record.operationId");
    expect(panel).toContain("failure.status === 404"); expect(panel).toContain("earlier save may still be finishing");
    expect(panel).not.toContain('method: "POST"'); expect(panel).not.toContain("setInterval");
    expect(panel).toContain("disabled={busy || !acknowledged}");
    const page = source("features/reservations/ReservationsPage.tsx");
    expect(page).toContain('saved.state === "prepared"');
    expect(page).toContain('updateReservationRecovery(saved, "handed-off")');
    expect(page).toContain("keepCalendarOrigin === false || (calendarEntry && !calendarContext)");
  });
});

describe("recovered Calendar return proof", () => {
  const target = { roomId: id(6), inventoryUnitId: id(7), bedId: id(8), arrival: "2026-09-11", departure: "2026-09-13" };
  const reservation = { propertyId: id(4), reservationId: id(5), arrival: target.arrival, departure: target.departure, inventoryUnitIds: [target.inventoryUnitId] } as Reservation;
  const room = { propertyId: id(4), roomId: target.roomId, units: [{ propertyId: id(4), roomId: target.roomId, inventoryUnitId: target.inventoryUnitId, bedId: target.bedId }] } as RoomInventory;
  it("preserves only current exact property/stay/room/unit/bed topology", () => {
    expect(reservationRecoveryTargetMatches(reservation, id(4), target, [room], true)).toBe(true);
    expect(reservationRecoveryTargetMatches(reservation, id(4), target, [room], false)).toBe(false);
    expect(reservationRecoveryTargetMatches(reservation, id(4), undefined, [room], true)).toBe(false);
    for (const changed of [{ ...target, roomId: id(9) }, { ...target, bedId: id(9) }, { ...target, inventoryUnitId: id(9) }, { ...target, departure: "2026-09-15" }]) expect(reservationRecoveryTargetMatches(reservation, id(4), changed, [room], true)).toBe(false);
    expect(reservationRecoveryTargetMatches({ ...reservation, propertyId: id(9) }, id(4), target, [room], true)).toBe(false);
    expect(reservationRecoveryTargetMatches({ ...reservation, inventoryUnitIds: [target.inventoryUnitId, id(9)] }, id(4), target, [room], true)).toBe(false);
    expect(reservationRecoveryTargetMatches(reservation, id(4), target, [{ ...room, units: [{ ...room.units[0], roomId: id(9) }] }], true)).toBe(false);
  });
});
