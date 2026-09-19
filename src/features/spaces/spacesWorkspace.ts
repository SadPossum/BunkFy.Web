import type { StayDateRange } from "../../app/propertyDate";
import type { SpacesAvailabilityRow } from "./spacesAvailability";
import type { SpacesBlockGroup } from "./spacesBlocks";
import type { SpacesRoom, SpacesUnit } from "./spacesLayout";
import type { BlockEditorNotice } from "../inventory/useManualBlockEditor";

// Inventory supplies overview identities, never a fabricated physical-bed count.
// Authoritative physical beds remain a single selected-room query.
export function spacesOverviewUnits(room: SpacesRoom, selectedUnits?: SpacesUnit[]): SpacesUnit[] {
  const units = selectedUnits ?? room.inventoryUnits.map((unit): SpacesUnit => ({
    key: unit.bedId ? `bed:${unit.bedId}` : `unit:${unit.inventoryUnitId}`,
    roomId: room.roomId, bedId: unit.bedId ?? null, inventoryUnitId: unit.inventoryUnitId,
    kind: unit.kind === "room" || unit.kind === 1 ? "room" : "bed",
    label: unit.bedId ? unit.label : "Whole room", physicalStatus: null,
    physicalState: "unknown", inventoryState: "present", isSellable: unit.isSellable,
    isTopologyActive: unit.isTopologyActive, issues: [],
  }));
  return units.filter((unit) => unit.kind === "bed" || unit.isSellable === true)
    .map((unit) => unit.kind === "room" ? { ...unit, label: "Whole room" } : unit)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export function spacesRoomSummary(room: SpacesRoom, physicalBedCount?: number, inventoryCurrent = true): string {
  const inventoryBedCount = new Set(room.inventoryUnits.flatMap((unit) => unit.bedId ? [unit.bedId] : [])).size;
  const countsDisagree = physicalBedCount !== undefined && room.inventoryState === "present" && physicalBedCount !== inventoryBedCount;
  const count = physicalBedCount ?? new Set(room.inventoryUnits.flatMap((unit) => unit.bedId ? [unit.bedId] : [])).size;
  const beds = count === 0 && room.salesMode === "roomLevel" ? null : physicalBedCount !== undefined ? `${count} ${count === 1 ? "bed" : "beds"}`
    : room.inventoryState === "present" && count ? `${count} bed ${count === 1 ? "space" : "spaces"}` : null;
  const selling = !inventoryCurrent || countsDisagree || room.inventoryState !== "present" ? "Selling setup unconfirmed"
    : room.salesMode === "bedLevel" ? "sold by bed"
      : room.salesMode === "roomLevel" ? "sold as a room"
        : room.salesMode === "unconfigured" ? "not offered for sale" : "Selling mode unknown";
  return [beds, selling].filter(Boolean).join(" · ");
}

export function spacesBlockSuccessParams(current: URLSearchParams, notice: BlockEditorNotice): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set("property", notice.receipt.propertyId);
  next.set("blockGroup", notice.receipt.blockGroupId);
  next.set("focus", notice.receipt.blockGroupId);
  next.set("history", "all");
  if (notice.action === "created" && notice.createdTarget) {
    next.delete("room"); next.delete("bed"); next.delete("unit");
    if (notice.createdTarget.target.roomId) next.set("room", notice.createdTarget.target.roomId);
    if (notice.createdTarget.target.inventoryUnitId) next.set("unit", notice.createdTarget.target.inventoryUnitId);
    if (notice.createdRange) { next.set("arrival", notice.createdRange.arrival); next.set("departure", notice.createdRange.departure); }
    // A property/building/floor hold has no selected room to contain its receipt.
    if (!notice.createdTarget.target.roomId && !notice.createdTarget.target.inventoryUnitId) {
      const from = current.get("section");
      if (from === "layout" || from === "availability") next.set("spacesSurfaceFrom", from);
      next.set("section", "blocks");
    }
  }
  return next;
}

export function spacesUnitAvailability(unit: SpacesUnit, rows: SpacesAvailabilityRow[], inventoryCurrent: boolean): { label: string; tone: string } {
  if (!inventoryCurrent) return { label: "Unconfirmed", tone: "text-base-content/60" };
  if (unit.isTopologyActive === false) return { label: "Retired / inactive", tone: "text-base-content/60" };
  if (unit.isSellable === false) return { label: "Not offered for sale", tone: "text-base-content/60" };
  const row = rows.find((item) => item.inventoryUnitId === unit.inventoryUnitId
    && item.roomId === unit.roomId && (item.bedId ?? null) === unit.bedId && item.targetResolved);
  if (!row) return { label: "Unknown", tone: "text-base-content/60" };
  if (row.state === "unconfirmed") return { label: "Unconfirmed", tone: "text-base-content/60" };
  if (row.state === "available") return { label: "Available", tone: "text-success" };
  if (row.state === "blocked") return { label: "Blocked", tone: "text-warning-content" };
  // The source exposes active allocations, not check-in status or guest identity.
  if (row.state === "occupied") return { label: "Reserved / occupied", tone: "text-secondary" };
  return { label: "Unavailable", tone: "text-base-content/60" };
}

export function spacesRelevantHolds(groups: SpacesBlockGroup[], unitIds: string[], range: StayDateRange, exactGroupId?: string | null, history: "active" | "all" = "active"): SpacesBlockGroup[] {
  return groups.filter((group) => {
    if (history === "all") return group.inventoryUnitIds.some((id) => unitIds.includes(id));
    if (exactGroupId && group.blockGroupId === exactGroupId) return group.inventoryUnitIds.some((id) => unitIds.includes(id));
    return group.status === "active" && group.inventoryUnitIds.some((id) => unitIds.includes(id))
      && group.intervals.some((interval) => interval.arrival < range.departure && range.arrival < interval.departure);
  });
}

export function spacesHasCurrentAllocation(unit: SpacesUnit, rows: SpacesAvailabilityRow[], inventoryCurrent: boolean): boolean {
  return inventoryCurrent && rows.some((row) => row.inventoryUnitId === unit.inventoryUnitId
    && row.roomId === unit.roomId && (row.bedId ?? null) === unit.bedId && row.targetResolved
    && row.state !== "unconfirmed" && row.activeAllocationCount > 0);
}
