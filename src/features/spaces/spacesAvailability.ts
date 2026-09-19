import type {
  InventoryAvailabilityResponse,
  InventoryUnitAvailability,
  RoomInventory,
} from "../../api/types";

export type SpacesAvailabilityEvidence = "current" | "unconfirmed";

export type SpacesAvailabilityState =
  | "available"
  | "blocked"
  | "occupied"
  | "unavailable"
  | "unconfirmed";

export type SpacesAvailabilityRow = {
  inventoryUnitId: string;
  roomId: string;
  bedId?: string;
  roomLabel: string;
  roomDetail: string;
  unitLabel: string;
  unitKind: "room" | "bed" | "unit";
  targetResolved: boolean;
  state: SpacesAvailabilityState;
  lastReportedState: Exclude<SpacesAvailabilityState, "unconfirmed">;
  activeBlockCount: number;
  activeAllocationCount: number;
};

export type SpacesAvailabilityModel = {
  rows: SpacesAvailabilityRow[];
  total: number;
  reportedAvailable: number;
  reportedUnavailable: number;
  unresolvedTargets: number;
  contextMismatch: boolean;
};

export type SpacesAvailabilityContext = {
  propertyId: string;
  arrival: string;
  departure: string;
};

export function buildSpacesAvailability(
  rooms: RoomInventory[],
  response: InventoryAvailabilityResponse | undefined,
  evidence: SpacesAvailabilityEvidence,
  expected?: SpacesAvailabilityContext,
): SpacesAvailabilityModel {
  const contextMismatch = Boolean(expected && (
    rooms.some((room) => (
      room.propertyId !== expected.propertyId
      || room.units.some((unit) => (
        unit.propertyId !== expected.propertyId
        || unit.roomId !== room.roomId
      ))
    ))
    || (response && (
      response.propertyId !== expected.propertyId
      || response.arrival !== expected.arrival
      || response.departure !== expected.departure
      || response.units.some((item) => item.unit.propertyId !== expected.propertyId)
    ))
  ));
  if (contextMismatch) return emptyModel(true);

  const roomById = new Map(rooms.map((room) => [room.roomId, room]));
  const inventoryUnitById = new Map(
    rooms.flatMap((room) => room.units.map((unit) => [unit.inventoryUnitId, { room, unit }] as const)),
  );
  const units = response?.units ?? [];
  const rows = units.map((item) => {
    const exact = inventoryUnitById.get(item.unit.inventoryUnitId);
    const room = exact?.room ?? roomById.get(item.unit.roomId);
    const targetResolved = Boolean(
      exact
      && exact.room.propertyId === item.unit.propertyId
      && exact.room.roomId === item.unit.roomId
      && exact.unit.propertyId === item.unit.propertyId
      && exact.unit.roomId === item.unit.roomId
      && exact.unit.bedId === item.unit.bedId,
    );
    const lastReportedState = reportedState(item);
    return {
      inventoryUnitId: item.unit.inventoryUnitId,
      roomId: item.unit.roomId,
      ...(item.unit.bedId ? { bedId: item.unit.bedId } : {}),
      roomLabel: targetResolved ? exact!.room.roomName : "Unresolved room",
      roomDetail: targetResolved
        ? [room?.buildingLabel, room?.floorLabel].filter(Boolean).join(" / ") || "No location label"
        : `Room ${shortId(item.unit.roomId)}`,
      unitLabel: targetResolved
        ? isRoomUnit(item.unit.kind) ? "Whole room" : exact!.unit.label
        : `Unit ${shortId(item.unit.inventoryUnitId)}`,
      unitKind: targetResolved
        ? isRoomUnit(item.unit.kind) ? "room" : "bed"
        : "unit",
      targetResolved,
      state: evidence === "current" && targetResolved ? lastReportedState : "unconfirmed",
      lastReportedState,
      activeBlockCount: item.activeBlockIds.length,
      activeAllocationCount: item.activeAllocationIds.length,
    } satisfies SpacesAvailabilityRow;
  });

  return {
    rows,
    total: rows.length,
    reportedAvailable: units.filter((item) => item.isAvailable).length,
    reportedUnavailable: units.filter((item) => !item.isAvailable).length,
    unresolvedTargets: rows.filter((row) => !row.targetResolved).length,
    contextMismatch: false,
  };
}

function emptyModel(contextMismatch: boolean): SpacesAvailabilityModel {
  return {
    rows: [],
    total: 0,
    reportedAvailable: 0,
    reportedUnavailable: 0,
    unresolvedTargets: 0,
    contextMismatch,
  };
}

export function resolveSpacesAvailabilityTarget(
  rows: SpacesAvailabilityRow[],
  inventoryUnitId: string | null,
  evidenceCurrent: boolean,
  roomId?: string | null,
  bedId?: string | null,
): "none" | "selected" | "unconfirmed" | "unavailable" {
  if (!inventoryUnitId) return "none";
  if (rows.some((row) => (
    row.inventoryUnitId === inventoryUnitId
    && (!roomId || row.roomId === roomId)
    && (!bedId || row.bedId === bedId)
  ))) return "selected";
  return evidenceCurrent ? "unavailable" : "unconfirmed";
}

function reportedState(
  item: InventoryUnitAvailability,
): Exclude<SpacesAvailabilityState, "unconfirmed"> {
  if (item.activeBlockIds.length > 0) return "blocked";
  if (item.activeAllocationIds.length > 0) return "occupied";
  return item.isAvailable ? "available" : "unavailable";
}

function isRoomUnit(kind: InventoryUnitAvailability["unit"]["kind"]): boolean {
  return kind === "room" || kind === 1;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}
