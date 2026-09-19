import { manualBlockStatusLabel } from "../../api/labels";
import type {
  InventoryBlockTarget,
  RoomInventory,
  RoomInventoryChangeImpact,
} from "../../api/types";
import type { ActiveBlockGroup, BlockTargetOption } from "./inventoryBlocking";

export type InventoryMutationAction =
  | "change-sales-mode"
  | "create-block"
  | "release-block";

export type InventoryMutationEvidence = {
  permissionsCurrent: boolean;
  propertyCurrent: boolean;
  inventoryCurrent: boolean;
  blocksCurrent?: boolean;
  impactCurrent?: boolean;
  targetCurrent?: boolean;
};

export function inventoryMutationAllowed(
  action: InventoryMutationAction,
  evidence: InventoryMutationEvidence,
): boolean {
  if (!evidence.permissionsCurrent || !evidence.propertyCurrent || !evidence.inventoryCurrent) {
    return false;
  }

  switch (action) {
    case "change-sales-mode":
      return evidence.impactCurrent === true && evidence.targetCurrent === true;
    case "create-block":
    case "release-block":
      return evidence.blocksCurrent === true && evidence.targetCurrent === true;
  }
}

export function roomInventoryRecordIsCurrent(
  rooms: RoomInventory[],
  candidate: RoomInventory,
): boolean {
  return rooms.some((room) =>
    room.propertyId === candidate.propertyId &&
    room.roomId === candidate.roomId &&
    room.version === candidate.version);
}

export function roomImpactMatches(
  impact: RoomInventoryChangeImpact | undefined,
  candidate: RoomInventory,
): boolean {
  return impact?.propertyId === candidate.propertyId && impact.roomId === candidate.roomId;
}

export function blockTargetIsCurrent(
  options: BlockTargetOption[],
  candidate: InventoryBlockTarget,
): boolean {
  const fingerprint = blockTargetFingerprint(candidate);
  return options.some((option) => blockTargetFingerprint(option.target) === fingerprint);
}

export function activeBlockGroupIsCurrent(
  groups: ActiveBlockGroup[],
  blockGroupId: string,
): boolean {
  const group = groups.find((candidate) => candidate.blockGroupId === blockGroupId);
  return Boolean(group?.blocks.some((block) => manualBlockStatusLabel(block.status) === "active"));
}

function blockTargetFingerprint(target: InventoryBlockTarget): string {
  const kind = Number(target.kind);
  const normalize = (value: string | null | undefined) => value?.trim().toLocaleLowerCase() || null;

  switch (kind) {
    case 1:
      return JSON.stringify({ kind });
    case 2:
      return JSON.stringify({ kind, buildingLabel: normalize(target.buildingLabel) });
    case 3:
      return JSON.stringify({
        kind,
        buildingLabel: normalize(target.buildingLabel),
        floorLabel: normalize(target.floorLabel),
      });
    case 4:
      return JSON.stringify({ kind, roomId: normalize(target.roomId) });
    case 5:
      return JSON.stringify({ kind, inventoryUnitId: normalize(target.inventoryUnitId) });
    default:
      return JSON.stringify({ kind: null });
  }
}
