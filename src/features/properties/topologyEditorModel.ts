import type { Bed, Property, Room } from "../../api/types";
import { ApiError } from "../../api/client";
import { propertiesMutationAllowed, type PropertiesMutationEvidence } from "./propertiesMutationAuthority";

export type TopologyEditorTarget =
  | { kind: "room"; property: Property; room?: Room }
  | { kind: "bed"; property: Property; room: Room; bed?: Bed };
export type TopologyEditorEvidence = PropertiesMutationEvidence & {
  mayManageRooms: boolean;
  mayManageBeds: boolean;
  property: Property | null;
  rooms: readonly Room[];
  beds: readonly Bed[];
};

export function topologyTargetAllowed(target: TopologyEditorTarget, current: TopologyEditorEvidence, replay = false): boolean {
  if (current.property?.propertyId !== target.property.propertyId || current.property.status !== "active") return false;
  const action = target.kind === "room" ? target.room ? "update-room" : "create-room" : target.bed ? "update-bed" : "create-bed";
  if (!(target.kind === "room" ? current.mayManageRooms : current.mayManageBeds)
    || !propertiesMutationAllowed(action, current)) return false;
  if (!target.room) return replay || current.property.version === target.property.version;
  const room = current.rooms.find((item) => item.propertyId === target.property.propertyId && item.roomId === target.room?.roomId);
  if (!room || room.status !== "active" || (!replay && room.version !== target.room.version)) return false;
  if (target.kind === "bed" && target.bed) {
    const bed = current.beds.find((item) => item.propertyId === target.property.propertyId && item.roomId === room.roomId && item.bedId === target.bed?.bedId);
    return Boolean(bed && bed.status === "active" && (replay || (bed.version === target.bed.version && bed.roomVersion === room.version)));
  }
  return true;
}

export function topologyAttemptCurrent(attempt: { context: string; instance: number }, current: { context: string; instance: number }): boolean {
  return attempt.context === current.context && attempt.instance === current.instance;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validId(value: unknown): value is string { return typeof value === "string" && uuid.test(value) && value !== "00000000-0000-0000-0000-000000000000"; }
function revision(value: unknown): boolean { return Number.isInteger(value) && Number(value) > 0; }

export function topologyReceiptMatches(receipt: unknown, target: TopologyEditorTarget, labelCount?: number): boolean {
  if (!receipt || typeof receipt !== "object") return false;
  const value = receipt as Record<string, unknown>;
  if (value.propertyId !== target.property.propertyId || !validId(value.roomId)) return false;
  if (target.room && value.roomId !== target.room.roomId) return false;
  if (target.kind === "room") return revision(value.version);
  if (!revision(value.roomVersion)) return false;
  if (target.bed) return value.bedId === target.bed.bedId && revision(value.version);
  return Number.isInteger(labelCount) && Number(labelCount) >= 1 && Number(labelCount) <= 100
    && value.affectedBedCount === labelCount;
}

export function topologyVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === "Properties.VersionConflict";
}

export function topologyInputRejected(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 400 || (error.status === 409
    && ["Properties.RoomAlreadyExists", "Properties.BedAlreadyExists"].includes(error.code ?? "")));
}
