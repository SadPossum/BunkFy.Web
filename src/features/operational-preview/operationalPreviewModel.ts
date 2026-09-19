import type {
  InventoryAvailabilityResponse,
  InventoryUnit,
  InventoryUnitAvailability,
  ManualBlock,
  Reservation,
  ReservationListItem,
  RoomInventory,
} from "../../api/types";
import {
  withOperationalReturnRoute,
  type OperationalPreviewRoute,
  type OperationalPreviewSelection,
  type OperationalUnitState,
} from "./operationalPreviewRoute";
import type { OperationalInventoryContext } from "./OperationalPreviewProvider";

export type ResolvedUnitState = {
  state: OperationalUnitState;
  explanation: string;
};

export function inventoryContextFromRooms(
  rooms: RoomInventory[],
  inventoryUnitId: string | undefined,
  selection?: OperationalPreviewSelection,
): OperationalInventoryContext | undefined {
  if (!inventoryUnitId) return undefined;
  for (const room of rooms) {
    const unit = room.units.find((candidate) =>
      candidate.inventoryUnitId === inventoryUnitId);
    if (!unit) continue;
    if (selection && !inventoryUnitMatchesSelection(room, unit, selection)) continue;
    return {
      inventoryUnitId: unit.inventoryUnitId,
      roomId: room.roomId,
      bedId: unit.bedId ?? undefined,
      roomName: room.roomName,
      unitLabel: isRoomUnit(unit) ? "Whole room" : unit.label,
      unitDetail: isRoomUnit(unit) ? "Private room" : "Bed",
    };
  }
  return undefined;
}

export function inventoryRoomsMatchProperty(
  rooms: RoomInventory[],
  propertyId: string,
): boolean {
  return rooms.every((room) => (
    room.propertyId === propertyId
    && room.units.every((unit) => (
      unit.propertyId === propertyId
      && unit.roomId === room.roomId
    ))
  ));
}

export function operationalInventoryContextMatchesSelection(
  inventory: OperationalInventoryContext,
  selection: OperationalPreviewSelection,
): boolean {
  return (!selection.inventoryUnitId || inventory.inventoryUnitId === selection.inventoryUnitId)
    && (!selection.roomId || inventory.roomId === selection.roomId)
    && (!selection.bedId || inventory.bedId === selection.bedId);
}

export function reservationMatchesSelection(
  reservation: Reservation | ReservationListItem,
  selection: Extract<OperationalPreviewSelection, { kind: "reservation" }>,
): boolean {
  return reservation.propertyId === selection.propertyId
    && reservation.reservationId === selection.reservationId
    && (!selection.date || (
      reservation.arrival <= selection.date
      // Departure is a valid preview context, not an occupied night.
      && selection.date <= reservation.departure
    ))
    && (!selection.inventoryUnitId || reservation.inventoryUnitIds.includes(selection.inventoryUnitId));
}

export function manualBlockListMatchesProperty(
  blocks: ManualBlock[],
  propertyId: string,
): boolean {
  return blocks.every((block) => block.propertyId === propertyId);
}

export function manualBlockMatchesSelection(
  block: ManualBlock,
  selection: Extract<OperationalPreviewSelection, { kind: "inventoryBlock" }>,
): boolean {
  return block.propertyId === selection.propertyId
    && block.blockGroupId === selection.blockGroupId
    && (!selection.blockId || block.blockId === selection.blockId)
    && (!selection.inventoryUnitId || block.inventoryUnitId === selection.inventoryUnitId)
    && (!selection.date || (
      block.arrival <= selection.date
      && selection.date < block.departure
    ));
}

export function availabilityResponseMatchesSelection(
  response: InventoryAvailabilityResponse,
  selection: Extract<OperationalPreviewSelection, { kind: "inventoryUnit" }>,
): boolean {
  return response.propertyId === selection.propertyId
    && response.arrival === selection.date
    && response.departure === shiftDate(selection.date, 1)
    && response.units.every((item) => item.unit.propertyId === selection.propertyId);
}

export function availabilityUnitMatchesSelection(
  availability: InventoryUnitAvailability,
  selection: Extract<OperationalPreviewSelection, { kind: "inventoryUnit" }>,
): boolean {
  return availability.unit.propertyId === selection.propertyId
    && availability.unit.inventoryUnitId === selection.inventoryUnitId
    && availability.unit.roomId === selection.roomId
    && (selection.bedId
      ? availability.unit.bedId === selection.bedId
      : !availability.unit.bedId);
}

export function mayOpenSpacesFromPreview(
  canReadInventory: boolean,
  canReadProperties: boolean,
): boolean {
  return canReadInventory && canReadProperties;
}

export function reservationListItemFromDetail(
  reservation: Reservation,
): ReservationListItem {
  return {
    reservationId: reservation.reservationId,
    propertyId: reservation.propertyId,
    arrival: reservation.arrival,
    departure: reservation.departure,
    expectedArrivalTime: reservation.expectedArrivalTime,
    expectedDepartureTime: reservation.expectedDepartureTime,
    primaryGuestName: reservation.primaryGuestName,
    guestCount: reservation.guestCount,
    inventoryUnitCount: reservation.inventoryUnitIds.length,
    inventoryUnitIds: reservation.inventoryUnitIds,
    holdsInventory: reservation.holdsInventory,
    sourceKind: reservation.sourceKind,
    status: reservation.status,
  };
}

export function resolveUnitState(
  unit: InventoryUnit | undefined,
  availability: InventoryUnitAvailability | undefined,
  sourceCurrent: boolean,
  observedState: OperationalUnitState,
): ResolvedUnitState {
  if (unit && !unit.isTopologyActive) {
    return {
      state: "unavailable",
      explanation: "This space is no longer active in the current room layout.",
    };
  }
  if (unit && !unit.isSellable) {
    return {
      state: "unavailable",
      explanation: "This space is not currently configured for sale.",
    };
  }
  if (!sourceCurrent || !availability) {
    return {
      state: "unknown",
      explanation: observedState === "unknown"
        ? "Current availability has not been confirmed. Refresh before relying on it."
        : "The last visible state is no longer current. Refresh before relying on it.",
    };
  }
  if (availability.activeBlockIds.length > 0) {
    return {
      state: "blocked",
      explanation: "An active inventory block covers this date.",
    };
  }
  if (availability.activeAllocationIds.length > 0) {
    return {
      state: "occupied",
      explanation: "An active reservation allocation occupies this space.",
    };
  }
  if (availability.isAvailable) {
    return {
      state: "available",
      explanation: "No active reservation allocation or inventory block is reported for this date.",
    };
  }
  return {
    state: "unavailable",
    explanation: "Unavailable — the current source did not provide a reason.",
  };
}

export function reservationDestinationHref(route: OperationalPreviewRoute): string {
  const selection = route.selection;
  if (selection.kind !== "reservation") throw new Error("Reservation selection required.");
  const params = new URLSearchParams({
    property: selection.propertyId,
    reservation: selection.reservationId,
  });
  const withOrigin = withOperationalReturnRoute(params, route);
  return `/reservations?${withOrigin.toString()}`;
}

export function inventoryDestinationHref(route: OperationalPreviewRoute): string {
  const selection = route.selection;
  const params = new URLSearchParams({
    property: selection.propertyId,
    section: selection.kind === "inventoryBlock" ? "blocks" : "availability",
  });
  if (selection.kind === "inventoryBlock") {
    params.set("blockGroup", selection.blockGroupId);
    params.set("history", "all");
    params.set("focus", selection.blockGroupId);
  }
  if (selection.roomId) params.set("room", selection.roomId);
  if (selection.inventoryUnitId) {
    params.set("unit", selection.inventoryUnitId);
    if (selection.kind !== "inventoryBlock") params.set("focus", selection.inventoryUnitId);
  }
  if (selection.date) {
    params.set("arrival", selection.date);
    params.set("departure", shiftDate(selection.date, 1));
  }
  const withOrigin = withOperationalReturnRoute(params, route);
  return `/spaces?${withOrigin.toString()}`;
}

export function propertySetupDestinationHref(route: OperationalPreviewRoute): string | null {
  const selection = route.selection;
  if (!selection.roomId) return null;
  const params = new URLSearchParams({
    section: "layout",
    property: selection.propertyId,
    room: selection.roomId,
  });
  if (selection.bedId) params.set("bed", selection.bedId);
  if (selection.inventoryUnitId) params.set("unit", selection.inventoryUnitId);
  if (selection.date) {
    params.set("arrival", selection.date);
    params.set("departure", shiftDate(selection.date, 1));
  }
  const withOrigin = withOperationalReturnRoute(params, route);
  return `/spaces?${withOrigin.toString()}`;
}

function isRoomUnit(unit: InventoryUnit) {
  return unit.kind === "room" || unit.kind === 1;
}

function inventoryUnitMatchesSelection(
  room: RoomInventory,
  unit: InventoryUnit,
  selection: OperationalPreviewSelection,
): boolean {
  return room.propertyId === selection.propertyId
    && unit.propertyId === selection.propertyId
    && unit.roomId === room.roomId
    && (!selection.roomId || room.roomId === selection.roomId)
    && (!selection.bedId || unit.bedId === selection.bedId);
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}
