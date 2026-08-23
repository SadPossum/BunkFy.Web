export type PropertiesMutationAction =
  | "create-property"
  | "update-property"
  | "create-room"
  | "update-room"
  | "create-bed"
  | "update-bed"
  | "activate-processing"
  | "suspend-processing"
  | "control-retirement";

export type PropertiesMutationEvidence = {
  permissionsCurrent: boolean;
  propertyCurrent?: boolean;
  roomsCurrent?: boolean;
  bedsCurrent?: boolean;
  processingCurrent?: boolean;
  policiesCurrent?: boolean;
  retirementCurrent?: boolean;
};

export function propertiesMutationAllowed(
  action: PropertiesMutationAction,
  evidence: PropertiesMutationEvidence,
): boolean {
  if (!evidence.permissionsCurrent) return false;

  switch (action) {
    case "create-property":
      return true;
    case "update-property":
    case "create-room":
      return evidence.propertyCurrent === true;
    case "update-room":
      return evidence.roomsCurrent === true;
    case "create-bed":
    case "update-bed":
      return evidence.roomsCurrent === true && evidence.bedsCurrent === true;
    case "activate-processing":
      return evidence.propertyCurrent === true &&
        evidence.processingCurrent === true &&
        evidence.policiesCurrent === true;
    case "suspend-processing":
      return evidence.propertyCurrent === true &&
        evidence.processingCurrent === true;
    case "control-retirement":
      return evidence.retirementCurrent === true;
  }
}

export function propertyRecordMatches(
  current: Property | null,
  candidate: Property,
): boolean {
  return current?.propertyId === candidate.propertyId &&
    current.version === candidate.version;
}

export function roomRecordIsCurrent(rooms: Room[], candidate: Room): boolean {
  return rooms.some((room) =>
    room.roomId === candidate.roomId && room.version === candidate.version);
}

export function bedRecordIsCurrent(
  beds: Bed[],
  room: Room | null,
  candidate: Bed,
): boolean {
  return room?.roomId === candidate.roomId &&
    room.version === candidate.roomVersion &&
    beds.some((bed) =>
    bed.bedId === candidate.bedId &&
    bed.version === candidate.version &&
    bed.roomVersion === candidate.roomVersion);
}
import type { Bed, Property, Room } from "../../api/types";
