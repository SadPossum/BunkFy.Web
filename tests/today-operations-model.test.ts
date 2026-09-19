import { describe, expect, it } from "vitest";
import type { ReservationListItem } from "../src/api/types";
import {
  buildTodayBoard,
  todayAttentionReason,
} from "../src/features/dashboard/todayOperationsModel";
import { reservationInventorySummary } from "../src/features/reservations/reservationOperationalView";

describe("Today shift board", () => {
  it("keeps older ended-but-unresolved attention records supplied by the complete Today feed", () => {
    const records = [reservation("old confirmed", "confirmed", "2026-07-01", "2026-07-03", null, null), reservation("old checked in", "checkedIn", "2026-07-01", "2026-07-03", null, null), reservation("pending checkout", "checkoutPending", "2026-07-01", "2026-07-03", null, null)];
    const board = buildTodayBoard(records, "2026-09-08");
    expect(board.attention).toHaveLength(3);
    expect(board.arrivals).toEqual([]); expect(board.departures).toEqual([]); expect(board.inHouse).toEqual([]);
  });
  it("keeps action groups disjoint and orders timed movements first", () => {
    const board = buildTodayBoard([
      reservation("late arrival", "confirmed", "2026-08-24", "2026-08-26", "18:00:00", null),
      reservation("early arrival", "confirmed", "2026-08-24", "2026-08-26", "09:00:00", null),
      reservation("departure", "checkedIn", "2026-08-22", "2026-08-24", null, "10:30:00"),
      reservation("staying", "checkedIn", "2026-08-22", "2026-08-26", null, null),
      reservation("pending", "pendingAllocation", "2026-08-24", "2026-08-26", null, null),
      reservation("missed", "confirmed", "2026-08-23", "2026-08-25", null, null),
    ], "2026-08-24");

    expect(board.arrivals.map((item) => item.primaryGuestName)).toEqual(["early arrival", "late arrival"]);
    expect(board.departures.map((item) => item.primaryGuestName)).toEqual(["departure"]);
    expect(board.inHouse.map((item) => item.primaryGuestName)).toEqual(["staying"]);
    expect(board.attention.map((item) => item.primaryGuestName)).toEqual(["missed", "pending"]);
    expect(new Set(Object.values(board).flat().map((item) => item.reservationId)).size).toBe(6);
  });

  it("explains why a reservation needs operational attention", () => {
    expect(todayAttentionReason(
      reservation("missed", "confirmed", "2026-08-23", "2026-08-25", null, null),
      "2026-08-24",
    )).toBe("Arrival overdue");
    expect(todayAttentionReason(
      reservation("late checkout", "checkedIn", "2026-08-20", "2026-08-23", null, null),
      "2026-08-24",
    )).toBe("Checkout overdue");
    expect(todayAttentionReason(
      reservation("pending", "pendingAllocation", "2026-08-24", "2026-08-26", null, null),
      "2026-08-24",
    )).toBe("Allocation pending");
    expect(todayAttentionReason(
      reservation("ready", "confirmed", "2026-08-24", "2026-08-26", null, null),
      "2026-08-24",
    )).toBeNull();
  });

  it("does not present requested or released inventory as a live hold", () => {
    expect(reservationInventorySummary(
      reservation("held", "confirmed", "2026-08-24", "2026-08-26", null, null),
    )).toBe("1 unit held");
    expect(reservationInventorySummary(
      reservation("rejected", "allocationRejected", "2026-08-24", "2026-08-26", null, null),
    )).toBe("Requested · not held");
    expect(reservationInventorySummary(
      reservation("closed", "checkedOut", "2026-08-20", "2026-08-23", null, null),
    )).toBe("Inventory released");
  });
});

function reservation(
  primaryGuestName: string,
  status: ReservationListItem["status"],
  arrival: string,
  departure: string,
  expectedArrivalTime: string | null,
  expectedDepartureTime: string | null,
): ReservationListItem {
  return {
    reservationId: primaryGuestName,
    propertyId: "property-a",
    arrival,
    departure,
    expectedArrivalTime,
    expectedDepartureTime,
    primaryGuestName,
    guestCount: 1,
    inventoryUnitCount: 1,
    inventoryUnitIds: [primaryGuestName],
    holdsInventory: [
      "confirmed",
      "cancellationPending",
      "checkedIn",
      "noShowPending",
      "checkoutPending",
    ].includes(String(status)),
    sourceKind: "direct",
    status,
  };
}
