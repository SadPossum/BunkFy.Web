import { ApiError } from "../../api/client";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import type { RoomInventory, RoomInventoryChangeImpact } from "../../api/types";
import { inventoryMutationAllowed, roomImpactMatches, roomInventoryRecordIsCurrent } from "./inventoryMutationAuthority";

export type SalesMode = "roomLevel" | "bedLevel";
export type SalesModeEvidence = {
  propertyId: string;
  permissionsCurrent: boolean;
  propertyCurrent: boolean;
  inventoryCurrent: boolean;
  mayRead: boolean;
  mayConfigure: boolean;
  rooms: RoomInventory[];
};
export type SalesModeTarget = { room: RoomInventory; salesMode: SalesMode | "unconfigured" };

export function canonicalSalesMode(value: unknown): SalesMode | "unconfigured" | null {
  if (value === 1 || String(value).toLowerCase() === "unconfigured") return "unconfigured";
  if (value === 2 || String(value).toLowerCase() === "roomlevel") return "roomLevel";
  if (value === 3 || String(value).toLowerCase() === "bedlevel") return "bedLevel";
  return null;
}
export function salesModeLabel(value: unknown): string {
  const mode = canonicalSalesMode(value);
  return mode === "roomLevel" ? "Whole room" : mode === "bedLevel" ? "Individual beds" : mode === "unconfigured" ? "Not configured" : "Unconfirmed";
}
export function activeSalesBeds(room: RoomInventory): number {
  return room.units.filter((unit) => (unit.kind === 2 || unit.kind === "bed") && unit.isTopologyActive).length;
}
export function salesRoomCurrent(room: RoomInventory, evidence: SalesModeEvidence, replay = false): boolean {
  return evidence.mayRead && evidence.mayConfigure && evidence.permissionsCurrent && evidence.propertyCurrent && evidence.inventoryCurrent
    && evidence.propertyId === room.propertyId
    && (replay ? evidence.rooms.some((item) => item.propertyId === room.propertyId && item.roomId === room.roomId) : roomInventoryRecordIsCurrent(evidence.rooms, room));
}
export function salesRoomEditable(room: RoomInventory, evidence: SalesModeEvidence): boolean {
  const current = evidence.rooms.find((item) => item.propertyId === room.propertyId && item.roomId === room.roomId);
  return salesRoomCurrent(room, evidence) && Number.isSafeInteger(room.version) && room.version > 0 && canonicalSalesMode(room.salesMode) !== null
    && room.units.some((unit) => unit.isTopologyActive) && Boolean(current?.units.some((unit) => unit.isTopologyActive));
}
export function salesImpactMatches(impact: RoomInventoryChangeImpact | undefined, room: RoomInventory): boolean {
  return roomImpactMatches(impact, room) && Boolean(impact
    && [impact.activeAllocationCount, impact.activeManualBlockCount, impact.activeBedRetirementCount, impact.activeRoomRetirementCount]
      .every((count) => Number.isInteger(count) && count >= 0)
    && Array.isArray(impact.affectedReservationIds) && impact.affectedReservationIds.every((id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    && typeof impact.affectedReservationIdsTruncated === "boolean" && typeof impact.canChangeSalesMode === "boolean");
}
export function salesChangeAllowed(target: SalesModeTarget, evidence: SalesModeEvidence, impact: RoomInventoryChangeImpact | undefined, impactCurrent: boolean): boolean {
  const current = evidence.rooms.find((room) => room.propertyId === target.room.propertyId && room.roomId === target.room.roomId);
  return salesRoomEditable(target.room, evidence) && target.salesMode !== "unconfigured"
    && target.salesMode !== canonicalSalesMode(target.room.salesMode)
    && (target.salesMode !== "bedLevel" || Boolean(current && activeSalesBeds(current) > 0))
    && inventoryMutationAllowed("change-sales-mode", { ...evidence, impactCurrent, targetCurrent: salesImpactMatches(impact, target.room) })
    && Boolean(impact?.canChangeSalesMode && !impact.activeAllocationCount && !impact.activeManualBlockCount && !impact.activeBedRetirementCount && !impact.activeRoomRetirementCount);
}
export function salesReceiptMatches(value: unknown, target: SalesModeTarget, expectedVersion: number): boolean {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return receipt.propertyId === target.room.propertyId && receipt.roomId === target.room.roomId
    && canonicalSalesMode(receipt.salesMode) === target.salesMode && target.salesMode !== "unconfigured"
    && typeof receipt.version === "number" && Number.isSafeInteger(receipt.version) && receipt.version > expectedVersion;
}
export function salesAttemptCurrent(attempt: { context: string; instance: number }, current: { context: string; instance: number }): boolean {
  return attempt.context === current.context && attempt.instance === current.instance;
}
export function salesKnownRejection(error: unknown): boolean {
  return error instanceof ApiError && !isInsufficientAuthenticationError(error) && [400, 403, 404, 409, 423].includes(error.status);
}
export function salesBlockerSummary(impact: RoomInventoryChangeImpact): string {
  return [
    [impact.activeAllocationCount, "reservation", "reservations"],
    [impact.activeManualBlockCount, "block", "blocks"],
    [impact.activeBedRetirementCount, "bed retirement", "bed retirements"],
    [impact.activeRoomRetirementCount, "room retirement", "room retirements"],
  ].filter(([count]) => Number(count) > 0).map(([count, one, many]) => `${count} ${count === 1 ? one : many}`).join(", ");
}
