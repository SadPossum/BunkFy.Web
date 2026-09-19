import { describe, expect, it } from "vitest";
import type { InventoryAvailabilityResponse, ManualBlock, ReservationListItem, RoomInventory } from "../src/api/types";
import { buildTodayRooms, filterTodayRooms, todayMovement } from "../src/features/dashboard/todayRoomsModel";
const date = "2026-09-08", propertyId = "p", unitId = "u";
const room: RoomInventory = { propertyId, roomId: "r", roomName: "101", buildingLabel: "Main", floorLabel: "1", salesMode: "bedLevel", version: 1, units: [{ propertyId, roomId: "r", inventoryUnitId: unitId, bedId: "b", label: "A", kind: "bed", isSellable: true, isTopologyActive: true }] };
const stay = (id: string, changes: Partial<ReservationListItem> = {}): ReservationListItem => ({ propertyId, reservationId: id, arrival: date, departure: "2026-09-10", expectedArrivalTime: null, expectedDepartureTime: null, primaryGuestName: id, guestCount: 1, inventoryUnitCount: 1, inventoryUnitIds: [unitId], holdsInventory: true, status: "confirmed", sourceKind: "direct", ...changes });
const available: InventoryAvailabilityResponse = { propertyId, arrival: date, departure: "2026-09-09", units: [{ unit: room.units[0]!, isAvailable: true, activeAllocationIds: [], activeBlockIds: [] }] };
const model = (reservations: ReservationListItem[] = [], changes: Partial<Parameters<typeof buildTodayRooms>[0]> = {}) => buildTodayRooms({ rooms: [room], reservations, blocks: [], availability: available, localDate: date, current: true, ...changes });

describe("Today room and movement truth", () => {
  it("keeps departure-day presence separate from available tonight, not Occupied/cleanliness claims", () => {
    const departure = stay("Departing", { status: "checkedIn", arrival: "2026-09-05", departure: date });
    const row = model([departure]).groups[0]!.rows[0]!;
    expect(row.reservations).toEqual([departure]); expect(row.tonight).toBe("available"); expect(todayMovement(departure, date)).toBe("Departure today");
  });
  it("retains all same-bed records, older overdue records and independent block reasons", () => {
    const old = stay("Old overdue", { arrival: "2026-08-01", departure: "2026-08-03", status: "checkedIn" });
    const rows = [old, stay("Due arrival"), stay("Continuing", { status: "checkedIn", arrival: "2026-09-07" })];
    const blocks = ["Repair", "Inspection"].map((reason, i) => ({ propertyId, blockId: `block${i}`, blockGroupId: `group${i}`, inventoryUnitId: unitId, arrival: date, departure: "2026-09-09", status: "active", reason }) as ManualBlock);
    const result = model(rows, { blocks });
    expect(result.groups[0]!.rows[0]!.reservations).toHaveLength(3); expect(result.groups[0]!.rows[0]!.blocks).toEqual(blocks);
    expect(todayMovement(old, date)).toBe("Checkout overdue"); expect(result.groups[0]!.rows[0]!.tonight).toBe("unknown");
  });
  it("does not assign requested inventory, and retains partially mapped reservations for space review", () => {
    const requested = stay("Requested", { holdsInventory: false, status: "allocationRejected" });
    const partial = stay("Partial", { inventoryUnitCount: 2, inventoryUnitIds: [unitId, "missing"] });
    const result = model([requested, partial]);
    expect(result.groups[0]!.rows[0]!.reservations).toEqual([partial]); expect(result.unassigned).toEqual([requested, partial]);
  });
  it("keeps unknown gaps unknown for missing/currentness/conflicting source truth", () => {
    expect(model([], { current: false }).groups[0]!.rows[0]!.tonight).toBe("unknown");
    expect(model([], { availability: undefined }).groups[0]!.rows[0]!.tonight).toBe("unknown");
    expect(model([stay("Conflicting allocation")]).groups[0]!.rows[0]).toMatchObject({ tonight: "unknown", inconsistent: true });
    expect(model([], { availability: { ...available, units: [{ ...available.units[0]!, activeBlockIds: ["not-loaded"] }] } }).groups[0]!.rows[0]).toMatchObject({ tonight: "unknown", inconsistent: true });
  });
  it("finds room, bed, location and normalized guest names, and filters actual attention", () => {
    const result = model([stay("Élodie"), stay("Old", { arrival: "2026-08-01", departure: "2026-08-03" })]);
    for (const search of ["101", "A", "Main", "elodie"]) expect(filterTodayRooms(result.groups, search, "all", date)).toHaveLength(1);
    expect(filterTodayRooms(result.groups, "nobody", "all", date)).toEqual([]);
    expect(filterTodayRooms(result.groups, "", "attention", date)).toHaveLength(1);
    expect(filterTodayRooms(model([stay("Future")]).groups, "", "attention", date)).toEqual([]);
    expect(filterTodayRooms(model().groups, "", "available", date)).toHaveLength(1);
  });
  it("preserves whole-room and unconfigured context while excluding inactive topology", () => {
    const privateRoom = { ...room, salesMode: "roomLevel" as const, roomName: "Family", units: [{ ...room.units[0]!, kind: "room" as const }] };
    const emptyRoom = { ...room, roomId: "setup", roomName: "New room", salesMode: "unconfigured" as const, units: [] };
    const result = model([], { rooms: [privateRoom, emptyRoom] });
    expect(result.groups).toHaveLength(2); expect(filterTodayRooms(result.groups, "new room", "all", date)).toHaveLength(1);
    expect(model([stay("Review")], { rooms: [{ ...room, units: [{ ...room.units[0]!, isTopologyActive: false }] }] }).unassigned).toHaveLength(1);
  });
  it("re-evaluates date rollover without promoting checked-out history into Today", () => {
    const reservation = stay("Arrival");
    expect(todayMovement(reservation, date)).toBe("Arrival today"); expect(todayMovement(reservation, "2026-09-09")).toBe("Arrival overdue");
    expect(model([stay("Closed", { status: "checkedOut" })]).relevant).toEqual([]);
  });
});
