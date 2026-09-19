import { manualBlockStatusLabel } from "../../api/labels";
import type { ManualBlock, RoomInventory } from "../../api/types";
import type { CompositeSource } from "../../app/compositeSourceState";
import {
  buildBlockTargetOptions,
  type BlockTargetOption,
} from "../inventory/inventoryBlocking";

export type SpacesBlockGroupStatus = "active" | "released" | "mixed" | "unknown";

export type SpacesBlockGroup = {
  blockGroupId: string;
  label: string;
  detail: string;
  targetResolved: boolean;
  targetEvidence: "resolved" | "unconfirmed" | "unresolved";
  inventoryUnitIds: string[];
  intervals: { arrival: string; departure: string }[];
  reasons: string[];
  status: SpacesBlockGroupStatus;
  blockCount: number;
};

export type SpacesBlockModel = {
  groups: SpacesBlockGroup[];
  contextMismatch: boolean;
};

export function spacesBlockNoticeSources(sources: CompositeSource[], blockSource: CompositeSource, contextMismatch: boolean) {
  // A terminal uncached block failure belongs to the fallback below, not two retry owners.
  // Keep independently failing dependencies and all cached/stale block warnings.
  return blockSource.state === "unavailable" && !contextMismatch
    ? sources.filter((source) => source !== blockSource)
    : sources;
}

export function buildSpacesBlockGroups(
  propertyName: string,
  propertyId: string,
  rooms: RoomInventory[],
  blocks: ManualBlock[],
  topologyCurrent: boolean,
): SpacesBlockModel {
  const contextMismatch = rooms.some((room) => (
    room.propertyId !== propertyId
    || room.units.some((unit) => (
      unit.propertyId !== propertyId
      || unit.roomId !== room.roomId
    ))
  )) || blocks.some((block) => block.propertyId !== propertyId);
  if (contextMismatch) return { groups: [], contextMismatch: true };

  const targetOptions = buildBlockTargetOptions(propertyName, rooms);
  const byGroup = new Map<string, ManualBlock[]>();
  for (const block of blocks) {
    const groupId = block.blockGroupId || block.blockId;
    const current = byGroup.get(groupId) ?? [];
    current.push(block);
    byGroup.set(groupId, current);
  }

  const groups = Array.from(byGroup.entries()).map(([blockGroupId, groupBlocks]) => {
    const inventoryUnitIds = unique(groupBlocks.map((block) => block.inventoryUnitId)).sort();
    const target = exactTarget(targetOptions, inventoryUnitIds);
    const targetEvidence = topologyCurrent
      ? target ? "resolved" : "unresolved"
      : "unconfirmed";
    const intervals = unique(groupBlocks.map((block) => `${block.arrival}|${block.departure}`))
      .map((value) => {
        const [arrival = "", departure = ""] = value.split("|");
        return { arrival, departure };
      });
    const reasons = unique(groupBlocks.map((block) => block.reason));
    return {
      blockGroupId,
      label: target?.label ?? `${inventoryUnitIds.length} ${targetEvidence} ${inventoryUnitIds.length === 1 ? "unit" : "units"}`,
      detail: target?.detail ?? inventoryUnitIds.map(shortId).join(", "),
      targetResolved: targetEvidence === "resolved",
      targetEvidence,
      inventoryUnitIds,
      intervals,
      reasons,
      status: groupStatus(groupBlocks),
      blockCount: groupBlocks.length,
    } satisfies SpacesBlockGroup;
  }).sort((left, right) => (
    (left.intervals[0]?.arrival ?? "").localeCompare(right.intervals[0]?.arrival ?? "")
    || left.label.localeCompare(right.label)
  ));
  return { groups, contextMismatch: false };
}

export function resolveSpacesBlockTarget(
  groups: SpacesBlockGroup[],
  blockGroupId: string | null,
  evidenceCurrent: boolean,
  inventoryUnitId?: string | null,
): "none" | "selected" | "unconfirmed" | "unavailable" {
  if (!blockGroupId) return "none";
  if (groups.some((group) => (
    group.blockGroupId === blockGroupId
    && (!inventoryUnitId || group.inventoryUnitIds.includes(inventoryUnitId))
  ))) return "selected";
  return evidenceCurrent ? "unavailable" : "unconfirmed";
}

function exactTarget(
  options: BlockTargetOption[],
  inventoryUnitIds: string[],
): BlockTargetOption | undefined {
  const kinds = ["unit", "room", "floor", "building", "property"];
  return [...options]
    .sort((left, right) => kinds.indexOf(left.kind) - kinds.indexOf(right.kind))
    .find((option) => sameIds(option.unitIds, inventoryUnitIds));
}

function groupStatus(blocks: ManualBlock[]): SpacesBlockGroupStatus {
  const statuses = unique(blocks.map((block) => manualBlockStatusLabel(block.status)));
  if (statuses.length !== 1) return statuses.every((status) => status === "active" || status === "released")
    ? "mixed"
    : "unknown";
  if (statuses[0] === "active" || statuses[0] === "released") return statuses[0];
  return "unknown";
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = [...left].sort();
  return expected.every((value, index) => value === right[index]);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}
