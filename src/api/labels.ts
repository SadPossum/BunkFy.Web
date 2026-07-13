import type { GuestStatus, GuestStayRole, GuestStayStatus, InventoryUnitKind, ManualBlock, ReservationSourceKind, ReservationStatus } from "./types";

export function reservationStatusLabel(status: ReservationStatus): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({ 1: "pending allocation", 2: "confirmed", 3: "allocation rejected", 4: "cancellation pending", 5: "cancelled" } as Record<number, string>)[status] ?? "unknown";
}

export function reservationSourceLabel(source: ReservationSourceKind): string {
  if (typeof source === "string") return splitCamelCase(source);
  return ({ 1: "direct", 2: "external" } as Record<number, string>)[source] ?? "unknown";
}

export function inventoryKindLabel(kind: InventoryUnitKind): string {
  if (typeof kind === "string") return splitCamelCase(kind);
  return ({ 1: "room", 2: "bed" } as Record<number, string>)[kind] ?? "unit";
}

export function inventorySalesModeValue(mode: "roomLevel" | "bedLevel"): 2 | 3 {
  return mode === "roomLevel" ? 2 : 3;
}

export function reservationSourceValue(source: "direct" | "external"): 1 | 2 {
  return source === "direct" ? 1 : 2;
}

export function manualBlockStatusLabel(status: ManualBlock["status"]): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({ 1: "active", 2: "released" } as Record<number, string>)[status] ?? "unknown";
}

export function guestStatusLabel(status: GuestStatus): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({ 1: "active", 2: "archived" } as Record<number, string>)[status] ?? "unknown";
}

export function guestStatusValue(status: "active" | "archived"): 1 | 2 {
  return status === "active" ? 1 : 2;
}

export function guestStayStatusLabel(status: GuestStayStatus): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({
    1: "pending allocation",
    2: "confirmed",
    3: "allocation rejected",
    4: "cancellation pending",
    5: "cancelled",
    6: "checked in",
    7: "no-show pending",
    8: "no-show",
    9: "checkout pending",
    10: "checked out",
  } as Record<number, string>)[status] ?? "unknown";
}

export function guestStayRoleLabel(role: GuestStayRole): string {
  if (typeof role === "string") return splitCamelCase(role);
  return role === 1 ? "primary guest" : "guest";
}

function splitCamelCase(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}
