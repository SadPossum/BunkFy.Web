import type {
  ManualBlock,
  ReservationListItem,
  RoomInventory,
} from "../../api/types";
import { isCalendarCompletedReservation, occupiesCalendarDay } from "./calendarModel";

export type CalendarResource = {
  inventoryUnitId: string;
  roomId: string;
  bedId?: string;
  roomName: string;
  label: string;
  detail: string;
  isPrivateRoom: boolean;
};

export type CalendarResourceGroup = {
  roomId: string;
  roomName: string;
  location: string;
  isPrivateRoom: boolean;
  resources: CalendarResource[];
};

export type CalendarUnitAvailability =
  | "free"
  | "pending"
  | "occupied"
  | "blocked"
  | "conflict";

export type CalendarUnitDayState = {
  availability: CalendarUnitAvailability;
  reservations: ReservationListItem[];
  blocks: ManualBlock[];
};

// One bounded model per retained date window, not a cache with its own lifetime.
// The view memoizes this against the complete resource/record/date inputs.
export function indexCalendarSchedule(resources: CalendarResource[], reservations: ReservationListItem[], blocks: ManualBlock[], days: string[]) {
  const units = new Map(resources.map((resource) => [resource.inventoryUnitId, {
    reservations: [] as ReservationListItem[], completed: [] as ReservationListItem[], blocks: [] as ManualBlock[], days: new Map<string, CalendarUnitDayState>(),
  }]));
  reservations.filter(reservationHoldsInventory).forEach((reservation) => {
    reservation.inventoryUnitIds.forEach((id) => units.get(id)?.reservations.push(reservation));
  });
  reservations.filter(isCalendarCompletedReservation).forEach((reservation) => {
    new Set(reservation.inventoryUnitIds).forEach((id) => units.get(id)?.completed.push(reservation));
  });
  blocks.forEach((block) => units.get(block.inventoryUnitId)?.blocks.push(block));
  days.forEach((day) => buildCalendarUnitDayStates(resources, reservations, blocks, day).forEach((state, id) => units.get(id)!.days.set(day, state)));
  return units;
}

export function buildCalendarResourceGroups(rooms: RoomInventory[]): CalendarResourceGroup[] {
  return rooms
    .map((room) => {
      const isPrivateRoom = isRoomLevel(room.salesMode);
      const resources = room.units
        .filter((unit) => unit.isSellable && unit.isTopologyActive)
        .map((unit) => ({
          inventoryUnitId: unit.inventoryUnitId,
          roomId: room.roomId,
          bedId: unit.bedId ?? undefined,
          roomName: room.roomName,
          label: isPrivateRoom ? "Whole room" : unit.label,
          detail: isPrivateRoom ? "Private room" : "Bed",
          isPrivateRoom,
        }))
        .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));

      return {
        roomId: room.roomId,
        roomName: room.roomName,
        location: [room.buildingLabel, room.floorLabel].filter(Boolean).join(" · ") || "Location not labelled",
        isPrivateRoom,
        resources,
      };
    })
    .filter((group) => group.resources.length > 0)
    .sort((left, right) =>
      left.location.localeCompare(right.location, undefined, { numeric: true })
      || left.roomName.localeCompare(right.roomName, undefined, { numeric: true }));
}

export function reservationHoldsInventory(reservation: ReservationListItem) {
  return !isCalendarCompletedReservation(reservation) && reservation.holdsInventory;
}

export function reservationsForUnit(
  reservations: ReservationListItem[],
  inventoryUnitId: string,
) {
  return reservations.filter((reservation) =>
    reservationHoldsInventory(reservation)
    && reservation.inventoryUnitIds.includes(inventoryUnitId));
}

export function requestedNotHeldReservations(
  reservations: ReservationListItem[],
) {
  return reservations.filter((reservation) => !isCalendarCompletedReservation(reservation)
    && !reservationHoldsInventory(reservation));
}

export function completedReservationsOutsideLayout(reservations: ReservationListItem[], resources: CalendarResource[]) {
  const ids = new Set(resources.map((resource) => resource.inventoryUnitId));
  return reservations.filter(isCalendarCompletedReservation).filter((reservation) =>
    reservation.inventoryUnitIds.length === 0 || reservation.inventoryUnitIds.some((id) => !ids.has(id)));
}

export function blocksForUnit(blocks: ManualBlock[], inventoryUnitId: string) {
  return blocks.filter((block) => block.inventoryUnitId === inventoryUnitId);
}

export function scheduleDayCounts(
  resources: CalendarResource[],
  reservations: ReservationListItem[],
  blocks: ManualBlock[],
  day: string,
) {
  const resourceIds = new Set(resources.map((resource) => resource.inventoryUnitId));
  const reservationCounts = new Map<string, number>();
  const blockCounts = new Map<string, number>();

  reservations
    .filter(reservationHoldsInventory)
    .filter((reservation) => occupiesCalendarDay(reservation.arrival, reservation.departure, day))
    .forEach((reservation) => reservation.inventoryUnitIds.forEach((unitId) => {
      if (resourceIds.has(unitId)) {
        reservationCounts.set(unitId, (reservationCounts.get(unitId) ?? 0) + 1);
      }
    }));
  blocks
    .filter((block) => occupiesCalendarDay(block.arrival, block.departure, day))
    .forEach((block) => {
      if (resourceIds.has(block.inventoryUnitId)) {
        blockCounts.set(
          block.inventoryUnitId,
          (blockCounts.get(block.inventoryUnitId) ?? 0) + 1,
        );
      }
    });

  const occupied = new Set(reservationCounts.keys());
  const blocked = new Set(blockCounts.keys());
  const conflicts = [...resourceIds].filter((unitId) =>
    (reservationCounts.get(unitId) ?? 0) + (blockCounts.get(unitId) ?? 0) > 1);
  return {
    total: resources.length,
    occupied: occupied.size,
    blocked: blocked.size,
    conflicts: conflicts.length,
    free: Math.max(0, resources.length - new Set([...occupied, ...blocked]).size),
  };
}

export function buildCalendarUnitDayStates(
  resources: CalendarResource[],
  reservations: ReservationListItem[],
  blocks: ManualBlock[],
  day: string,
): Map<string, CalendarUnitDayState> {
  const states = new Map<string, CalendarUnitDayState>();
  resources.forEach((resource) => {
    states.set(resource.inventoryUnitId, {
      availability: "free" as CalendarUnitAvailability,
      reservations: [],
      blocks: [],
    });
  });

  reservations
    .filter(reservationHoldsInventory)
    .filter((reservation) => reservation.arrival <= day && reservation.departure >= day)
    .forEach((reservation) => reservation.inventoryUnitIds.forEach((unitId) => {
      states.get(unitId)?.reservations.push(reservation);
    }));

  blocks
    .filter((block) => occupiesCalendarDay(block.arrival, block.departure, day))
    .forEach((block) => states.get(block.inventoryUnitId)?.blocks.push(block));

  states.forEach((state) => {
    const activeReservations = state.reservations.filter((reservation) =>
      reservationHoldsInventory(reservation)
      && occupiesCalendarDay(reservation.arrival, reservation.departure, day));
    const occupied = activeReservations.length > 0;
    const blocked = state.blocks.length > 0;
    const conflict = activeReservations.length + state.blocks.length > 1;

    state.availability = conflict
      ? "conflict"
      : occupied
        ? "occupied"
        : blocked
          ? "blocked"
          : "free";
  });

  return states;
}

export function unmappedReservationCount(
  reservations: ReservationListItem[],
  resources: CalendarResource[],
) {
  const resourceIds = new Set(resources.map((resource) => resource.inventoryUnitId));
  return reservations.filter(reservationHoldsInventory).filter((reservation) =>
    reservation.inventoryUnitIds.length === 0
    || reservation.inventoryUnitIds.some((unitId) => !resourceIds.has(unitId))).length;
}

function isRoomLevel(mode: RoomInventory["salesMode"]) {
  return mode === 2 || String(mode).toLowerCase() === "roomlevel";
}
