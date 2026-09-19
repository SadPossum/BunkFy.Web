import type { Bed, Room, RoomInventory } from "../../api/types";
import type { CompositeSource } from "../../app/compositeSourceState";

// The rendered room detail owns sellability recovery beside its affected facts.
// Without that owner the page must retain the source, including uncached failures.
export function spacesLayoutNoticeSources(sources: CompositeSource[], inventory: CompositeSource, roomDetailRendered: boolean): CompositeSource[] {
  return roomDetailRendered ? sources.filter((source) => source !== inventory) : sources;
}

export type SpacesEvidenceState = "current" | "stale" | "restricted" | "unavailable";
export type SpacesCounterpartState = "present" | "missing" | "unknown" | "not-applicable";

export type SpacesLayoutIssue = {
  code:
    | "cross-property-room"
    | "duplicate-room"
    | "cross-property-unit"
    | "cross-room-unit"
    | "duplicate-unit"
    | "invalid-unit-kind"
    | "duplicate-bed-unit"
    | "duplicate-whole-room-unit"
    | "cross-property-bed"
    | "cross-room-bed"
    | "duplicate-bed";
  roomId?: string;
  resourceId?: string;
};

export type SpacesInventoryUnit = RoomInventory["units"][number];

export type SpacesRoom = {
  roomId: string;
  name: string;
  location: string;
  physicalStatus: string | null;
  salesMode: "unconfigured" | "roomLevel" | "bedLevel" | null;
  physicalState: SpacesCounterpartState;
  inventoryState: SpacesCounterpartState;
  inventoryUnits: SpacesInventoryUnit[];
  sellableUnitCount: number | null;
  totalUnitCount: number | null;
  issues: SpacesLayoutIssue[];
};

export type SpacesUnit = {
  key: string;
  roomId: string;
  bedId: string | null;
  inventoryUnitId: string | null;
  kind: "room" | "bed";
  label: string;
  physicalStatus: string | null;
  isSellable: boolean | null;
  isTopologyActive: boolean | null;
  physicalState: SpacesCounterpartState;
  inventoryState: SpacesCounterpartState;
  issues: SpacesLayoutIssue[];
};

export type SpacesRoomSelection =
  | { status: "selected"; room: SpacesRoom; explicit: boolean }
  | { status: "empty" }
  | { status: "unselected" }
  | { status: "unconfirmed"; targetKind: "room" | "bed" | "unit"; reason: "delayed" | "restricted" }
  | { status: "unavailable"; targetKind: "room" | "bed" | "unit"; targetId: string };

export type SpacesUnitSelection =
  | { status: "none" }
  | { status: "selected"; unit: SpacesUnit }
  | { status: "unconfirmed"; targetKind: "bed" | "unit" | "bed-and-unit"; reason: "delayed" | "restricted" }
  | { status: "unavailable"; targetKind: "bed" | "unit" | "bed-and-unit" };

export function buildSpacesRooms({
  propertyId,
  physicalRooms,
  inventoryRooms,
  physicalEvidence,
  inventoryEvidence,
}: {
  propertyId: string;
  physicalRooms?: Room[];
  inventoryRooms?: RoomInventory[];
  physicalEvidence: SpacesEvidenceState;
  inventoryEvidence: SpacesEvidenceState;
}): { rooms: SpacesRoom[]; issues: SpacesLayoutIssue[] } {
  const issues: SpacesLayoutIssue[] = [];
  const physical = uniqueRooms(
    physicalRooms ?? [],
    propertyId,
    "physical",
    issues,
  );
  const inventory = uniqueRooms(
    inventoryRooms ?? [],
    propertyId,
    "inventory",
    issues,
  );
  const unitCounts = new Map<string, number>();

  inventory.forEach((room) => room.units.forEach((unit) => {
    if (unit.propertyId !== propertyId || unit.roomId !== room.roomId) return;
    unitCounts.set(unit.inventoryUnitId, (unitCounts.get(unit.inventoryUnitId) ?? 0) + 1);
  }));

  const roomIds = new Set([...physical.keys(), ...inventory.keys()]);
  const rooms = [...roomIds].map((roomId): SpacesRoom => {
    const physicalRoom = physical.get(roomId);
    const inventoryRoom = inventory.get(roomId);
    const roomIssues: SpacesLayoutIssue[] = [];
    const validUnits = (inventoryRoom?.units ?? []).filter((unit) => {
      if (unit.propertyId !== propertyId) {
        roomIssues.push({ code: "cross-property-unit", roomId, resourceId: unit.inventoryUnitId });
        return false;
      }
      if (unit.roomId !== roomId) {
        roomIssues.push({ code: "cross-room-unit", roomId, resourceId: unit.inventoryUnitId });
        return false;
      }
      if ((unitCounts.get(unit.inventoryUnitId) ?? 0) > 1) {
        roomIssues.push({ code: "duplicate-unit", roomId, resourceId: unit.inventoryUnitId });
        return false;
      }
      if (!isRoomUnit(unit) && !isBedUnit(unit)) {
        roomIssues.push({ code: "invalid-unit-kind", roomId, resourceId: unit.inventoryUnitId });
        return false;
      }
      if ((isRoomUnit(unit) && unit.bedId) || (isBedUnit(unit) && !unit.bedId)) {
        roomIssues.push({ code: "invalid-unit-kind", roomId, resourceId: unit.inventoryUnitId });
        return false;
      }
      return true;
    });
    issues.push(...roomIssues);

    const name = physicalRoom?.name || inventoryRoom?.roomName || "Room record unavailable";
    const physicalLocation = [physicalRoom?.buildingLabel, physicalRoom?.floorLabel].filter(Boolean).join(" · ");
    const inventoryLocation = [inventoryRoom?.buildingLabel, inventoryRoom?.floorLabel].filter(Boolean).join(" · ");
    return {
      roomId,
      name,
      location: physicalRoom
        ? physicalLocation || "Location not labelled"
        : inventoryLocation ? `${inventoryLocation} · From sellability` : "Location unknown",
      physicalStatus: physicalRoom ? String(physicalRoom.status) : null,
      salesMode: inventoryRoom ? normalizeSpacesSalesMode(inventoryRoom.salesMode) : null,
      physicalState: counterpartState(Boolean(physicalRoom), physicalEvidence),
      inventoryState: counterpartState(Boolean(inventoryRoom), inventoryEvidence),
      inventoryUnits: validUnits,
      sellableUnitCount: inventoryRoom
        ? validUnits.filter((unit) => unit.isSellable && unit.isTopologyActive).length
        : null,
      totalUnitCount: inventoryRoom ? validUnits.length : null,
      issues: roomIssues,
    };
  });

  rooms.sort((left, right) => {
    const leftActive = left.physicalStatus?.toLowerCase() === "active" ? 0 : 1;
    const rightActive = right.physicalStatus?.toLowerCase() === "active" ? 0 : 1;
    return leftActive - rightActive
      || naturalCompare(left.name, right.name)
      || left.roomId.localeCompare(right.roomId);
  });

  return { rooms, issues };
}

export function buildSpacesUnits({
  propertyId,
  room,
  physicalBeds,
  physicalEvidence,
  inventoryEvidence,
}: {
  propertyId: string;
  room: SpacesRoom;
  physicalBeds?: Bed[];
  physicalEvidence: SpacesEvidenceState;
  inventoryEvidence: SpacesEvidenceState;
}): { units: SpacesUnit[]; issues: SpacesLayoutIssue[] } {
  const issues: SpacesLayoutIssue[] = [...room.issues];
  const beds = uniqueBeds(physicalBeds ?? [], propertyId, room.roomId, issues);
  const inventoryBedUnits = new Map<string, SpacesInventoryUnit>();
  const duplicateBedIds = new Set<string>();
  const roomUnits: SpacesInventoryUnit[] = [];

  room.inventoryUnits.forEach((unit) => {
    if (isRoomUnit(unit)) {
      roomUnits.push(unit);
      return;
    }
    if (!unit.bedId) return;
    if (inventoryBedUnits.has(unit.bedId)) {
      duplicateBedIds.add(unit.bedId);
      inventoryBedUnits.delete(unit.bedId);
      issues.push({ code: "duplicate-bed-unit", roomId: room.roomId, resourceId: unit.bedId });
      return;
    }
    if (!duplicateBedIds.has(unit.bedId)) inventoryBedUnits.set(unit.bedId, unit);
  });

  if (roomUnits.length > 1) {
    roomUnits.forEach((unit) => issues.push({
      code: "duplicate-whole-room-unit",
      roomId: room.roomId,
      resourceId: unit.inventoryUnitId,
    }));
  }

  const bedIds = new Set([...beds.keys(), ...inventoryBedUnits.keys()]);
  const units: SpacesUnit[] = [];

  if (roomUnits.length === 1) {
    const unit = roomUnits[0];
    units.push({
      key: `unit:${unit.inventoryUnitId}`,
      roomId: room.roomId,
      bedId: null,
      inventoryUnitId: unit.inventoryUnitId,
      kind: "room",
      label: unit.label || "Whole room",
      physicalStatus: room.physicalStatus,
      isSellable: unit.isSellable,
      isTopologyActive: unit.isTopologyActive,
      physicalState: room.physicalState,
      inventoryState: "present",
      issues: [],
    });
  }

  bedIds.forEach((bedId) => {
    const bed = beds.get(bedId);
    const inventoryUnit = inventoryBedUnits.get(bedId);
    units.push({
      key: `bed:${bedId}`,
      roomId: room.roomId,
      bedId,
      inventoryUnitId: inventoryUnit?.inventoryUnitId ?? null,
      kind: "bed",
      label: bed?.label || inventoryUnit?.label || "Bed record unavailable",
      physicalStatus: bed ? String(bed.status) : null,
      isSellable: inventoryUnit?.isSellable ?? null,
      isTopologyActive: inventoryUnit?.isTopologyActive ?? null,
      physicalState: counterpartState(Boolean(bed), physicalEvidence),
      inventoryState: counterpartState(Boolean(inventoryUnit), inventoryEvidence),
      issues: [],
    });
  });

  units.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "room" ? -1 : 1;
    return naturalCompare(left.label, right.label) || left.key.localeCompare(right.key);
  });

  return { units, issues };
}

export function resolveSpacesRoomSelection(
  rooms: SpacesRoom[],
  roomId: string | null,
  bedId: string | null,
  inventoryUnitId: string | null,
  evidence: { physical: SpacesEvidenceState; inventory: SpacesEvidenceState },
): SpacesRoomSelection {
  if (roomId !== null) {
    const room = rooms.find((item) => item.roomId === roomId);
    if (room) return { status: "selected", room, explicit: true };
    const roomEvidence = [
      evidence.physical,
      ...(evidence.inventory === "restricted" ? [] : [evidence.inventory]),
    ];
    if (!absenceConfirmed(roomEvidence)) {
      return {
        status: "unconfirmed",
        targetKind: "room",
        reason: unconfirmedReason(roomEvidence),
      };
    }
    return { status: "unavailable", targetKind: "room", targetId: roomId };
  }

  if (inventoryUnitId !== null) {
    const room = rooms.find((item) => item.inventoryUnits.some(
      (unit) => unit.inventoryUnitId === inventoryUnitId,
    ));
    if (room) return { status: "selected", room, explicit: true };
    if (evidence.inventory !== "current") {
      return {
        status: "unconfirmed",
        targetKind: "unit",
        reason: unconfirmedReason([evidence.inventory]),
      };
    }
    return { status: "unavailable", targetKind: "unit", targetId: inventoryUnitId };
  }

  if (bedId !== null) {
    return { status: "unavailable", targetKind: "bed", targetId: bedId };
  }

  return rooms.length ? { status: "unselected" } : { status: "empty" };
}

export function resolveSpacesUnitSelection(
  units: SpacesUnit[],
  bedId: string | null,
  inventoryUnitId: string | null,
  evidence: { physical: SpacesEvidenceState; inventory: SpacesEvidenceState },
): SpacesUnitSelection {
  const bedRequested = bedId !== null;
  const inventoryRequested = inventoryUnitId !== null;
  if (!bedRequested && !inventoryRequested) return { status: "none" };
  const matches = units.filter((unit) =>
    (!bedRequested || unit.bedId === bedId)
    && (!inventoryRequested || unit.inventoryUnitId === inventoryUnitId));
  if (matches.length === 1) return { status: "selected", unit: matches[0] };
  const requiredEvidence = [
    ...(bedRequested ? [evidence.physical] : []),
    ...(inventoryRequested ? [evidence.inventory] : []),
  ];
  const targetKind = bedRequested && inventoryRequested
    ? "bed-and-unit"
    : bedRequested ? "bed" : "unit";
  if (!absenceConfirmed(requiredEvidence)) {
    return {
      status: "unconfirmed",
      targetKind,
      reason: unconfirmedReason(requiredEvidence),
    };
  }
  return {
    status: "unavailable",
    targetKind,
  };
}

export function spacesSalesModeLabel(
  value: SpacesRoom["salesMode"],
): string {
  if (value === "roomLevel") return "Private room";
  if (value === "bedLevel") return "Shared room";
  if (value === "unconfigured") return "Not configured";
  return "Sellability unknown";
}

export function normalizeSpacesSalesMode(
  value: RoomInventory["salesMode"],
): "unconfigured" | "roomLevel" | "bedLevel" | null {
  if (value === 2 || String(value).toLowerCase() === "roomlevel") return "roomLevel";
  if (value === 3 || String(value).toLowerCase() === "bedlevel") return "bedLevel";
  if (value === 1 || String(value).toLowerCase() === "unconfigured") return "unconfigured";
  return null;
}

function uniqueRooms<T extends Room | RoomInventory>(
  rooms: T[],
  propertyId: string,
  source: "physical" | "inventory",
  issues: SpacesLayoutIssue[],
): Map<string, T> {
  const result = new Map<string, T>();
  const duplicates = new Set<string>();
  rooms.forEach((room) => {
    if (room.propertyId !== propertyId) {
      issues.push({ code: "cross-property-room", roomId: room.roomId });
      return;
    }
    if (result.has(room.roomId) || duplicates.has(room.roomId)) {
      result.delete(room.roomId);
      duplicates.add(room.roomId);
      issues.push({ code: "duplicate-room", roomId: room.roomId, resourceId: source });
      return;
    }
    result.set(room.roomId, room);
  });
  return result;
}

function uniqueBeds(
  beds: Bed[],
  propertyId: string,
  roomId: string,
  issues: SpacesLayoutIssue[],
): Map<string, Bed> {
  const result = new Map<string, Bed>();
  const duplicates = new Set<string>();
  beds.forEach((bed) => {
    if (bed.propertyId !== propertyId) {
      issues.push({ code: "cross-property-bed", roomId, resourceId: bed.bedId });
      return;
    }
    if (bed.roomId !== roomId) {
      issues.push({ code: "cross-room-bed", roomId, resourceId: bed.bedId });
      return;
    }
    if (result.has(bed.bedId) || duplicates.has(bed.bedId)) {
      result.delete(bed.bedId);
      duplicates.add(bed.bedId);
      issues.push({ code: "duplicate-bed", roomId, resourceId: bed.bedId });
      return;
    }
    result.set(bed.bedId, bed);
  });
  return result;
}

function counterpartState(
  present: boolean,
  evidence: SpacesEvidenceState,
): SpacesCounterpartState {
  if (present) return "present";
  return evidence === "current" ? "missing" : "unknown";
}

function isRoomUnit(unit: SpacesInventoryUnit): boolean {
  return unit.kind === "room" || unit.kind === 1;
}

function isBedUnit(unit: SpacesInventoryUnit): boolean {
  return unit.kind === "bed" || unit.kind === 2;
}

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function absenceConfirmed(evidence: SpacesEvidenceState[]): boolean {
  return evidence.every((state) => state === "current");
}

function unconfirmedReason(evidence: SpacesEvidenceState[]): "delayed" | "restricted" {
  return evidence.some((state) => state === "restricted") ? "restricted" : "delayed";
}
