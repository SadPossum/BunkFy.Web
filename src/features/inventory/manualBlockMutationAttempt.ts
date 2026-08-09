import type { InventoryBlockTarget } from "../../api/types";

export type ManualBlockMutationAttempt = {
  fingerprint: string;
  operationId: string;
};

export type ManualBlockCreateAttemptInput = {
  propertyId: string;
  target: InventoryBlockTarget;
  arrival: string;
  departure: string;
  reason: string;
};

export function resolveManualBlockCreateAttempt(
  current: ManualBlockMutationAttempt | null,
  input: ManualBlockCreateAttemptInput,
  createOperationId: () => string = () => crypto.randomUUID(),
): ManualBlockMutationAttempt {
  const fingerprint = JSON.stringify({
    action: "manual-block-group-create",
    propertyId: normalizeId(input.propertyId),
    target: normalizeTarget(input.target),
    arrival: input.arrival,
    departure: input.departure,
    reason: input.reason.trim(),
  });

  return resolveAttempt(current, fingerprint, createOperationId);
}

export function resolveManualBlockGroupReleaseAttempt(
  current: ManualBlockMutationAttempt | null,
  propertyId: string,
  blockGroupId: string,
  createOperationId: () => string = () => crypto.randomUUID(),
): ManualBlockMutationAttempt {
  const fingerprint = JSON.stringify({
    action: "manual-block-group-release",
    propertyId: normalizeId(propertyId),
    blockGroupId: normalizeId(blockGroupId),
  });

  return resolveAttempt(current, fingerprint, createOperationId);
}

function resolveAttempt(
  current: ManualBlockMutationAttempt | null,
  fingerprint: string,
  createOperationId: () => string,
): ManualBlockMutationAttempt {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

function normalizeTarget(target: InventoryBlockTarget) {
  const kind = Number(target.kind);
  switch (kind) {
    case 1:
      return { kind };
    case 2:
      return { kind, buildingLabel: normalizeLabel(target.buildingLabel) };
    case 3:
      return {
        kind,
        buildingLabel: normalizeLabel(target.buildingLabel),
        floorLabel: normalizeLabel(target.floorLabel),
      };
    case 4:
      return { kind, roomId: normalizeId(target.roomId) };
    case 5:
      return { kind, inventoryUnitId: normalizeId(target.inventoryUnitId) };
    default:
      return {
        kind,
        buildingLabel: normalizeLabel(target.buildingLabel),
        floorLabel: normalizeLabel(target.floorLabel),
        roomId: normalizeId(target.roomId),
        inventoryUnitId: normalizeId(target.inventoryUnitId),
      };
  }
}

function normalizeId(value: string | null): string | null {
  return value?.trim().toLowerCase() || null;
}

function normalizeLabel(value: string | null): string | null {
  return value?.trim() || null;
}
