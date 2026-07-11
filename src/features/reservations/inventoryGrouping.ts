import type { InventoryUnitAvailability, RoomInventory } from "../../api/types";

export type InventoryRoomGroup = {
  roomId: string;
  roomName: string;
  availableCount: number;
  totalCount: number;
  units: InventoryUnitAvailability[];
};

export function groupAvailabilityByRoom(
  units: InventoryUnitAvailability[],
  rooms: RoomInventory[],
): InventoryRoomGroup[] {
  const roomNames = new Map(rooms.map((room) => [room.roomId, room.roomName]));
  const groups = new Map<string, InventoryUnitAvailability[]>();

  for (const unit of units) {
    const roomUnits = groups.get(unit.unit.roomId) ?? [];
    roomUnits.push(unit);
    groups.set(unit.unit.roomId, roomUnits);
  }

  return Array.from(groups, ([roomId, roomUnits]) => {
    const sortedUnits = [...roomUnits].sort((left, right) => {
      if (left.isAvailable !== right.isAvailable) return left.isAvailable ? -1 : 1;
      return left.unit.label.localeCompare(right.unit.label, undefined, { numeric: true });
    });

    return {
      roomId,
      roomName: roomNames.get(roomId) ?? `Room ${roomId.slice(0, 8)}`,
      availableCount: roomUnits.filter((unit) => unit.isAvailable).length,
      totalCount: roomUnits.length,
      units: sortedUnits,
    };
  }).sort((left, right) => left.roomName.localeCompare(right.roomName, undefined, { numeric: true }));
}
