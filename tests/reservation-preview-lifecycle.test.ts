import { describe, expect, it } from "vitest";
import type { Reservation, ReservationMutationReceipt } from "../src/api/types";
import { propertyDateKey } from "../src/app/propertyDate";
import { resolveReservationLifecycleAttempt } from "../src/features/reservations/reservationLifecycleAttempt";
import { reservationPreviewInvalidations, reservationPreviewNavigationPending, reservationPreviewQuickAction, reservationPreviewReadback, reservationPreviewReceiptMatches, type ReservationPreviewLifecycleOwner } from "../src/features/operational-preview/reservationPreviewLifecycle";

const record = { reservationId: "stay-a", propertyId: "property-a", arrival: "2026-09-07", departure: "2026-09-09", status: "confirmed", allocationId: "allocation", allocationVersion: 1, holdsInventory: true, version: 3, detailsRevision: 1, checkedInBusinessDate: null } as Reservation;
const evidence = { current: true, propertyToday: "2026-09-07", canCheckIn: true, canCheckOut: true };
const attempt = resolveReservationLifecycleAttempt(null, { propertyId: record.propertyId, reservationId: record.reservationId, action: "check-out", businessDate: "2026-09-09", expectedVersion: 3 }, () => "original-operation");

describe("shared preview lifecycle eligibility", () => {
  it.each(["2026-09-07", "2026-09-08"])("admits scheduled/overdue check-in on %s", propertyToday => {
    expect(reservationPreviewQuickAction(record, { ...evidence, propertyToday })).toBe("check-in");
  });
  it.each(["2026-09-06", "2026-09-09", "2026-09-10", null, "2026-02-30"])("does not backdate a quick check-in for %s", propertyToday => {
    expect(reservationPreviewQuickAction(record, { ...evidence, propertyToday })).toBeNull();
  });
  it.each(["2026-09-09", "2026-09-10"])("admits departure/overdue checkout on %s", propertyToday => {
    expect(reservationPreviewQuickAction({ ...record, status: "checkedIn", checkedInBusinessDate: "2026-09-07" }, { ...evidence, propertyToday })).toBe("check-out");
  });
  it.each(["2026-09-07", "2026-09-08"])("leaves early checkout %s in full detail", propertyToday => {
    expect(reservationPreviewQuickAction({ ...record, status: "checkedIn", checkedInBusinessDate: "2026-09-07" }, { ...evidence, propertyToday })).toBeNull();
  });
  it.each(["pendingAllocation", "checkoutPending", "checkedOut", "noShowPending", "noShow", "cancelled", "allocationRejected"])("has no mutation for %s", status => {
    expect(reservationPreviewQuickAction({ ...record, status: status as Reservation["status"] }, evidence)).toBeNull();
  });
  it.each([{ current: false }, { canCheckIn: false }, { propertyToday: null }])("requires current read, action access and real date %o", denied => {
    expect(reservationPreviewQuickAction(record, { ...evidence, ...denied })).toBeNull();
  });
  it.each([{ allocationId: null }, { allocationVersion: null }, { holdsInventory: false }, { version: 0 }, { pendingAllocationAmendmentId: "pending" }])("rejects unsupported allocation/version %o", changed => {
    expect(reservationPreviewQuickAction({ ...record, ...changed }, evidence)).toBeNull();
  });
  it("uses property timezone across UTC midnight without Calendar or fallback clamping", () => {
    const propertyToday = propertyDateKey("Europe/London", new Date("2026-09-06T23:30:00Z"));
    expect(propertyToday).toBe("2026-09-07");
    expect(reservationPreviewQuickAction(record, { ...evidence, propertyToday })).toBe("check-in");
    expect(propertyDateKey("not/a-time-zone")).toBeNull();
  });
  it("requires checkout permission and a valid non-future checked-in date", () => {
    const checkedIn = { ...record, status: "checkedIn" as const, checkedInBusinessDate: "2026-09-10" };
    expect(reservationPreviewQuickAction(checkedIn, { ...evidence, propertyToday: "2026-09-09" })).toBeNull();
    expect(reservationPreviewQuickAction({ ...checkedIn, checkedInBusinessDate: "2026-09-07" }, { ...evidence, propertyToday: "2026-09-09", canCheckOut: false })).toBeNull();
  });
});

describe("exact operation and readback truth", () => {
  it("retains canonical ID and original expected version despite authoritative drift", () => {
    const retry = resolveReservationLifecycleAttempt(attempt, { ...attempt.payload, expectedVersion: 12 }, () => "must-not-mint");
    expect(retry).toBe(attempt); expect(retry.payload.expectedVersion).toBe(3);
  });
  it("validates exact partial receipt without treating it as a full record", () => {
    const receipt = { reservationId: record.reservationId, propertyId: record.propertyId, version: 4, detailsRevision: 1, status: "checkoutPending" } as ReservationMutationReceipt;
    expect(reservationPreviewReceiptMatches(receipt, attempt)).toBe(true);
    expect(reservationPreviewReceiptMatches({ ...receipt, reservationId: "other" }, attempt)).toBe(false);
    expect(reservationPreviewReceiptMatches({ ...receipt, propertyId: "other" }, attempt)).toBe(false);
    expect(reservationPreviewReceiptMatches({ ...receipt, version: 0 }, attempt)).toBe(false);
    expect(reservationPreviewReceiptMatches(undefined, attempt)).toBe(false);
  });
  it("keeps release pending until a matching full checked-out read confirms release", () => {
    const pending = { ...record, status: "checkoutPending" as const, pendingStayBusinessDate: "2026-09-09", version: 4 };
    expect(reservationPreviewReadback(attempt, pending, true)).toBe("pending");
    const released = { ...pending, status: "checkedOut" as const, checkedOutBusinessDate: "2026-09-09", version: 5, holdsInventory: false };
    expect(reservationPreviewReadback(attempt, released, true)).toBe("success");
    expect(reservationPreviewReadback(attempt, { ...released, holdsInventory: true }, true)).toBe("unknown");
    expect(reservationPreviewReadback(attempt, { ...released, checkedOutBusinessDate: "2026-09-08" }, true)).toBe("unknown");
  });
  it("does not invent rejection from unacknowledged version drift", () => {
    const restored = { ...record, status: "checkedIn" as const, checkedInBusinessDate: "2026-09-07", version: 5 };
    expect(reservationPreviewReadback(attempt, restored)).toBe("unknown");
    expect(reservationPreviewReadback(attempt, restored, true)).toBe("rejected");
    expect(reservationPreviewReadback(attempt, restored, true, 6)).toBe("unknown");
    expect(reservationPreviewReadback(attempt, restored, true, 5, 5)).toBe("unknown");
    expect(reservationPreviewReadback(attempt, restored, true, 5, 4)).toBe("rejected");
    expect(reservationPreviewReadback(attempt, { ...restored, propertyId: "other" }, true)).toBe("unknown");
  });
  it("refreshes every retained Calendar reservation segment without assuming blocks changed", () => {
    const filters = reservationPreviewInvalidations("tenant", "property-a", "stay-a");
    expect(filters).toContainEqual({ queryKey: ["reservation-calendar", "property-a"] });
    expect(filters).toContainEqual({ queryKey: ["operational-preview", "tenant", "property-a", "reservation", "stay-a"], exact: true });
    expect(filters).toContainEqual({ queryKey: ["reservation", "property-a", "stay-a"], exact: true });
    for (const prefix of ["reservations", "reservation-operations", "guest-stays", "availability", "inventory-rooms", "rooms", "beds"]) expect(filters).toContainEqual({ queryKey: [prefix, "property-a"] });
    expect(filters.some(filter => ["blocks", "today", "calendar"].includes(filter.queryKey[0]))).toBe(false);
  });
  it.each(["confirm", "sending", "checking", "unknown", "pending", "success", "rejected", "changed"] as const)("locks only actual pending phases: %s", phase => {
    expect(reservationPreviewNavigationPending({ phase } as ReservationPreviewLifecycleOwner)).toBe(["sending", "checking", "pending"].includes(phase));
  });
});
