import type { InventoryAvailabilityResponse, InventoryUnit, ManualBlock, ReservationListItem, RoomInventory } from "../../api/types";
import { reservationStatusKey } from "../../app/liveUpdates";
import { reservationAttentionReason } from "../reservations/reservationOperationalView";
import type { TodayRoomsFilter } from "../operational-preview/operationalPreviewRoute";
import type { UnitVisualState } from "./todayVisualAvailability";
import { visualUnitState } from "./todayVisualAvailability";

export type TodayRoomRow = { unit: InventoryUnit; reservations: ReservationListItem[]; blocks: ManualBlock[]; tonight: UnitVisualState; inconsistent: boolean };
export type TodayRoomGroup = { room: RoomInventory; rows: TodayRoomRow[] };

export function todayMovement(item: ReservationListItem, date: string) {
  const attention = reservationAttentionReason(item, date);
  if (attention) return attention;
  const status = reservationStatusKey(item.status);
  if (status === "checkedIn" && item.departure === date) return "Departure today";
  if (status === "checkedIn") return "Continuing stay";
  if (status === "confirmed" && item.arrival === date) return "Arrival today";
  return "Reservation for tonight";
}

export function todayRelevantReservation(item: ReservationListItem, date: string) {
  return reservationAttentionReason(item, date) !== null
    || reservationStatusKey(item.status) === "checkedIn"
    || (reservationStatusKey(item.status) === "confirmed" && item.arrival <= date && item.departure >= date);
}

export function buildTodayRooms({ rooms, reservations, blocks, availability, localDate, current }: {
  rooms: RoomInventory[]; reservations: ReservationListItem[]; blocks: ManualBlock[];
  availability?: InventoryAvailabilityResponse; localDate?: string; current: boolean;
}) {
  const relevant = localDate ? reservations.filter(item => todayRelevantReservation(item, localDate)) : [];
  const byUnit = new Map<string, ReservationListItem[]>(), blocksByUnit = new Map<string, ManualBlock[]>();
  for (const item of relevant) if (item.holdsInventory) for (const id of item.inventoryUnitIds) {
    byUnit.set(id, [...(byUnit.get(id) ?? []), item]);
  }
  for (const block of blocks) if (localDate && (block.status === 1 || block.status === "active") && block.arrival <= localDate && localDate < block.departure) {
    blocksByUnit.set(block.inventoryUnitId, [...(blocksByUnit.get(block.inventoryUnitId) ?? []), block]);
  }
  const available = new Map((availability?.units ?? []).map(item => [item.unit.inventoryUnitId, item]));
  const displayed = new Set<string>();
  const groups: TodayRoomGroup[] = [...rooms].sort((a, b) => roomLocation(a).localeCompare(roomLocation(b)) || a.roomName.localeCompare(b.roomName, undefined, { numeric: true })).map(room => ({ room, rows: room.units
    .filter(unit => unit.isTopologyActive && (unit.isSellable || byUnit.has(unit.inventoryUnitId) || blocksByUnit.has(unit.inventoryUnitId)))
    .map(unit => {
      displayed.add(unit.inventoryUnitId);
      const items = [...(byUnit.get(unit.inventoryUnitId) ?? [])].sort((a, b) => a.departure.localeCompare(b.departure) || a.arrival.localeCompare(b.arrival) || a.reservationId.localeCompare(b.reservationId));
      const activeBlocks = blocksByUnit.get(unit.inventoryUnitId) ?? [], observed = available.get(unit.inventoryUnitId);
      const inconsistent = Boolean(current && observed && ((observed.isAvailable && (activeBlocks.length || items.some(item => item.arrival <= localDate! && localDate! < item.departure)))
        || observed.activeBlockIds.some(id => !activeBlocks.some(block => block.blockId === id))));
      return { unit, reservations: items, blocks: activeBlocks, inconsistent, tonight: visualUnitState(unit, observed, current && !inconsistent ? "ready" : "loading") };
    }) }));
  const unassigned = relevant.filter(item => !item.holdsInventory || !item.inventoryUnitIds.length || item.inventoryUnitIds.some(id => !displayed.has(id)));
  return { groups, unassigned, relevant };
}

export function roomLocation(room: RoomInventory) {
  return [room.buildingLabel, room.floorLabel].filter(Boolean).join(" · ");
}

export function todaySearchText(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();
}

export function filterTodayRooms(groups: TodayRoomGroup[], search: string, filter: TodayRoomsFilter, date?: string) {
  const term = todaySearchText(search);
  return groups.map(group => {
    const roomMatches = todaySearchText(`${group.room.roomName} ${roomLocation(group.room)}`).includes(term);
    const rows = group.rows.filter(row => {
      const matches = roomMatches || todaySearchText(`${row.unit.label} ${row.reservations.map(item => item.primaryGuestName).join(" ")}`).includes(term);
      return matches && (filter === "all" || (filter === "available" && row.tonight === "available") || (filter === "blocked" && row.tonight === "blocked")
        || (filter === "attention" && row.reservations.some(item => reservationAttentionReason(item, date) !== null))
        || (filter === "movements" && row.reservations.some(item => item.arrival === date || item.departure === date)));
    });
    return { ...group, rows };
  }).filter(group => group.rows.length || (!group.room.units.some(unit => unit.isSellable && unit.isTopologyActive) && filter === "all" && todaySearchText(`${group.room.roomName} ${roomLocation(group.room)}`).includes(term)));
}
