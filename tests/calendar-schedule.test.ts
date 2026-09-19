import { describe, expect, it } from "vitest";
import type { ManualBlock, ReservationListItem, RoomInventory } from "../src/api/types";
import {
  buildCalendarUnitDayStates,
  buildCalendarResourceGroups,
  requestedNotHeldReservations,
  reservationHoldsInventory,
  reservationsForUnit,
  scheduleDayCounts,
  unmappedReservationCount,
} from "../src/features/calendar/calendarSchedule";

describe("calendar schedule model", () => {
  it("turns private rooms and shared beds into truthful schedule rows", () => {
    const groups = buildCalendarResourceGroups([
      room("Private 1", "roomLevel", ["room-unit"]),
      room("Dorm 2", "bedLevel", ["bed-2", "bed-1"]),
    ]);

    expect(groups.find((group) => group.roomName === "Dorm 2")?.resources.map((resource) => resource.label))
      .toEqual(["1", "2"]);
    expect(groups.find((group) => group.roomName === "Private 1")?.resources[0]?.label)
      .toBe("Whole room");
  });

  it("preserves distinct operator-facing bed labels and inventory identities", () => {
    const dorm = room("Dorm 101", "bedLevel", ["unit-e", "unit-f"]);
    dorm.units[0]!.label = "101-E";
    dorm.units[1]!.label = "101-F";

    const resources = buildCalendarResourceGroups([dorm])[0]!.resources;

    expect(resources.map(({ inventoryUnitId, label }) => ({ inventoryUnitId, label })))
      .toEqual([
        { inventoryUnitId: "unit-e", label: "101-E" },
        { inventoryUnitId: "unit-f", label: "101-F" },
      ]);
  });

  it("counts confirmed allocations and blocks without treating pending requests as occupied", () => {
    const resources = buildCalendarResourceGroups([room("Dorm", "bedLevel", ["bed-1", "bed-2", "bed-3"])]).flatMap((group) => group.resources);
    const counts = scheduleDayCounts(
      resources,
      [reservation("confirmed", "bed-1"), reservation("pendingAllocation", "bed-2")],
      [block("bed-3")],
      "2026-08-04",
    );

    expect(counts).toEqual({ total: 3, occupied: 1, blocked: 1, conflicts: 0, free: 1 });
    expect(reservationHoldsInventory(reservation("pendingAllocation", "bed-2"))).toBe(false);
  });

  it("keeps non-holding cancellation requests out of occupied room rows", () => {
    const resources = buildCalendarResourceGroups([
      room("Dorm", "bedLevel", ["bed-1", "bed-2"]),
    ]).flatMap((group) => group.resources);
    const states = buildCalendarUnitDayStates(
      resources,
      [
        reservation("cancellationPending", "bed-1", true),
        reservation("cancellationPending", "bed-2", false),
      ],
      [],
      "2026-08-04",
    );

    expect(states.get("bed-1")?.availability).toBe("occupied");
    expect(states.get("bed-2")?.availability).toBe("free");
    expect(states.get("bed-2")?.reservations).toEqual([]);
  });

  it("reports reservations whose assigned topology is no longer visible", () => {
    const resources = buildCalendarResourceGroups([room("Dorm", "bedLevel", ["bed-1"])]).flatMap((group) => group.resources);

    expect(unmappedReservationCount([reservation("confirmed", "retired-bed")], resources)).toBe(1);
  });

  it("builds truthful per-unit states without placing pending requests in a bed", () => {
    const resources = buildCalendarResourceGroups([
      room("Dorm", "bedLevel", ["bed-1", "bed-2", "bed-3", "bed-4"]),
    ]).flatMap((group) => group.resources);
    const states = buildCalendarUnitDayStates(
      resources,
      [
        reservation("confirmed", "bed-1"),
        reservation("confirmed", "bed-2"),
        reservation("pendingAllocation", "bed-4"),
      ],
      [block("bed-2"), block("bed-3")],
      "2026-08-04",
    );

    expect(states.get("bed-1")?.availability).toBe("occupied");
    expect(states.get("bed-2")?.availability).toBe("conflict");
    expect(states.get("bed-3")?.availability).toBe("blocked");
    expect(states.get("bed-4")?.availability).toBe("free");
    expect(states.get("bed-4")?.reservations).toEqual([]);
  });

  it("exposes reservation-reservation and repeated-block overlaps as conflicts", () => {
    const resources = buildCalendarResourceGroups([
      room("Dorm", "bedLevel", ["bed-1", "bed-2"]),
    ]).flatMap((group) => group.resources);
    const secondReservation = {
      ...reservation("checkedIn", "bed-1"),
      reservationId: "second-reservation",
    };
    const secondBlock = {
      ...block("bed-2"),
      blockId: "second-block",
      blockGroupId: "second-block-group",
    };

    const states = buildCalendarUnitDayStates(
      resources,
      [reservation("confirmed", "bed-1"), secondReservation],
      [block("bed-2"), secondBlock],
      "2026-08-04",
    );
    const counts = scheduleDayCounts(
      resources,
      [reservation("confirmed", "bed-1"), secondReservation],
      [block("bed-2"), secondBlock],
      "2026-08-04",
    );

    expect(states.get("bed-1")?.availability).toBe("conflict");
    expect(states.get("bed-2")?.availability).toBe("conflict");
    expect(counts).toEqual({ total: 2, occupied: 1, blocked: 1, conflicts: 2, free: 0 });
  });

  it("does not treat an adjacent checkout and check-in as overlapping occupancy", () => {
    const resources = buildCalendarResourceGroups([
      room("Private", "roomLevel", ["room-unit"]),
    ]).flatMap((group) => group.resources);
    const departing = {
      ...reservation("confirmed", "room-unit"),
      reservationId: "departing",
      arrival: "2026-08-01",
      departure: "2026-08-04",
    };
    const arriving = {
      ...reservation("confirmed", "room-unit"),
      reservationId: "arriving",
      arrival: "2026-08-04",
      departure: "2026-08-06",
    };

    const state = buildCalendarUnitDayStates(resources, [departing, arriving], [], "2026-08-04")
      .get("room-unit");

    expect(state?.availability).toBe("occupied");
    expect(state?.reservations.map((item) => item.reservationId).sort())
      .toEqual(["arriving", "departing"]);
  });

  it("separates requested-not-held stays from operational resource rows", () => {
    const held = reservation("confirmed", "bed-1");
    const requested = reservation("pendingAllocation", "bed-1", false);

    expect(reservationsForUnit([held, requested], "bed-1")).toEqual([held]);
    expect(requestedNotHeldReservations([held, requested])).toEqual([requested]);
  });

  it("keeps a departure event visible without counting the departure night as occupied", () => {
    const resources = buildCalendarResourceGroups([
      room("Private", "roomLevel", ["room-unit"]),
    ]).flatMap((group) => group.resources);
    const departing = {
      ...reservation("confirmed", "room-unit"),
      departure: "2026-08-04",
    };
    const state = buildCalendarUnitDayStates(resources, [departing], [], "2026-08-04")
      .get("room-unit");

    expect(state?.availability).toBe("free");
    expect(state?.reservations.map((item) => item.reservationId))
      .toEqual([departing.reservationId]);
  });
});

function room(
  roomName: string,
  salesMode: RoomInventory["salesMode"],
  unitIds: string[],
): RoomInventory {
  return {
    propertyId: "property-a",
    roomId: `room-${roomName}`,
    roomName,
    buildingLabel: "Main House",
    floorLabel: roomName.startsWith("Dorm") ? "Ground" : "First",
    salesMode,
    version: 1,
    units: unitIds.map((inventoryUnitId, index) => ({
      inventoryUnitId,
      propertyId: "property-a",
      roomId: `room-${roomName}`,
      bedId: salesMode === "bedLevel" ? `bed-${index}` : null,
      kind: salesMode === "bedLevel" ? "bed" : "room",
      label: String(unitIds.length - index),
      isSellable: true,
      isTopologyActive: true,
    })),
  };
}

function reservation(
  status: ReservationListItem["status"],
  inventoryUnitId: string,
  holdsInventory = [
    "confirmed",
    "cancellationPending",
    "checkedIn",
    "noShowPending",
    "checkoutPending",
  ].includes(String(status)),
): ReservationListItem {
  return {
    reservationId: `${status}-${inventoryUnitId}`,
    propertyId: "property-a",
    arrival: "2026-08-03",
    departure: "2026-08-06",
    expectedArrivalTime: null,
    expectedDepartureTime: null,
    primaryGuestName: "Test guest",
    guestCount: 1,
    inventoryUnitCount: 1,
    inventoryUnitIds: [inventoryUnitId],
    holdsInventory,
    sourceKind: "direct",
    status,
  };
}

function block(inventoryUnitId: string): ManualBlock {
  return {
    blockId: `block-${inventoryUnitId}`,
    blockGroupId: `group-${inventoryUnitId}`,
    propertyId: "property-a",
    inventoryUnitId,
    arrival: "2026-08-04",
    departure: "2026-08-05",
    reason: "Maintenance",
    status: "active",
    version: 1,
    createdAtUtc: "2026-08-01T00:00:00Z",
    releasedAtUtc: null,
  };
}
