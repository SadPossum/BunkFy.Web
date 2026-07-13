import { describe, expect, it } from "vitest";
import type { InventoryUnitAvailability, RoomInventory } from "../src/api/types";
import { groupAvailabilityByRoom } from "../src/features/reservations/inventoryGrouping";

function availability(roomId: string, label: string, isAvailable: boolean): InventoryUnitAvailability {
  return {
    unit: {
      inventoryUnitId: `${roomId}-${label}`,
      propertyId: "property",
      roomId,
      bedId: `${roomId}-${label}`,
      kind: "bed",
      label,
      isSellable: true,
      isTopologyActive: true,
    },
    isAvailable,
    activeBlockIds: [],
    activeAllocationIds: [],
  };
}

function room(roomId: string, roomName: string): RoomInventory {
  return { propertyId: "property", roomId, roomName, salesMode: "bedLevel", version: 1, units: [] };
}

describe("reservation inventory grouping", () => {
  it("groups units by room and sorts available units first", () => {
    const groups = groupAvailabilityByRoom(
      [availability("room-2", "Bed 8", false), availability("room-1", "Bed 2", false), availability("room-1", "Bed 1", true), availability("room-2", "Bed 1", true)],
      [room("room-2", "Dorm 102"), room("room-1", "Dorm 101")],
    );

    expect(groups.map((group) => group.roomName)).toEqual(["Dorm 101", "Dorm 102"]);
    expect(groups[0].availableCount).toBe(1);
    expect(groups[0].units.map((unit) => unit.unit.label)).toEqual(["Bed 1", "Bed 2"]);
  });

  it("keeps units identifiable when room metadata is unavailable", () => {
    const [group] = groupAvailabilityByRoom([availability("abcdef123456", "Bed 1", true)], []);
    expect(group.roomName).toBe("Room abcdef12");
  });

  it("keeps a five-room, forty-bed property grouped and countable", () => {
    const rooms = Array.from({ length: 5 }, (_, roomIndex) => room(`room-${roomIndex + 1}`, `Dorm ${101 + roomIndex}`));
    const units = rooms.flatMap((currentRoom, roomIndex) => Array.from(
      { length: 8 },
      (_, bedIndex) => availability(currentRoom.roomId, `Bed ${bedIndex + 1}`, bedIndex !== roomIndex),
    ));

    const groups = groupAvailabilityByRoom(units, rooms);

    expect(groups).toHaveLength(5);
    expect(groups.reduce((total, group) => total + group.totalCount, 0)).toBe(40);
    expect(groups.reduce((total, group) => total + group.availableCount, 0)).toBe(35);
    expect(groups.every((group) => group.units[0].isAvailable)).toBe(true);
  });
});
