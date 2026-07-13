import type { AdapterConflictPolicy, AdapterConnectionStatus, AdapterExecutionMode, ChangeProposalStatus, GuestStatus, GuestStayRole, GuestStayStatus, IngestionRunStatus, InventoryUnitKind, ManualBlock, NotificationSeverity, ObservationReceiptStatus, ObservationReprocessingStatus, ReservationDetailsChangeOrigin, ReservationGuestRole, ReservationSourceKind, ReservationStatus, StaffStatus } from "./types";

export function reservationStatusLabel(status: ReservationStatus): string {
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

export function reservationGuestRoleLabel(role: ReservationGuestRole): string {
  if (typeof role === "string") return splitCamelCase(role);
  return role === 1 ? "primary guest" : "guest";
}

export function reservationDetailsOriginLabel(origin: ReservationDetailsChangeOrigin): string {
  if (typeof origin === "string") return splitCamelCase(origin);
  return ({ 1: "staff", 2: "integration", 3: "administrator", 4: "system" } as Record<number, string>)[origin] ?? "unknown";
}

export function staffStatusLabel(status: StaffStatus): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({ 1: "active", 2: "suspended", 3: "departed" } as Record<number, string>)[status] ?? "unknown";
}

export function staffStatusValue(status: "active" | "suspended" | "departed"): 1 | 2 | 3 {
  return ({ active: 1, suspended: 2, departed: 3 } as const)[status];
}

export function adapterExecutionModeLabel(mode: AdapterExecutionMode): string {
  if (typeof mode === "string") return splitCamelCase(mode);
  return ({ 1: "polling", 2: "continuous", 3: "push", 4: "remote polling" } as Record<number, string>)[mode] ?? "unknown";
}
export function adapterExecutionModeValue(mode: "polling" | "continuous" | "push" | "remotePolling"): 1 | 2 | 3 | 4 { return ({ polling: 1, continuous: 2, push: 3, remotePolling: 4 } as const)[mode]; }

export function adapterConflictPolicyLabel(policy: AdapterConflictPolicy): string {
  if (typeof policy === "string") return splitCamelCase(policy);
  return ({ 1: "suggestions only", 2: "auto-apply safe updates" } as Record<number, string>)[policy] ?? "unknown";
}
export function adapterConflictPolicyValue(policy: "suggestionsOnly" | "autoApplyWhenAdapterBaselineUnchanged"): 1 | 2 { return policy === "suggestionsOnly" ? 1 : 2; }

export function adapterConnectionStatusLabel(status: AdapterConnectionStatus): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({ 1: "enabled", 2: "disabled" } as Record<number, string>)[status] ?? "unknown";
}

export function proposalStatusLabel(status: ChangeProposalStatus): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({ 1: "pending", 2: "applying", 3: "applied", 4: "rejected", 5: "superseded", 6: "stale", 7: "failed" } as Record<number, string>)[status] ?? "unknown";
}
export function proposalStatusValue(status: "pending" | "applying" | "applied" | "rejected" | "superseded" | "stale" | "failed"): 1 | 2 | 3 | 4 | 5 | 6 | 7 { return ({ pending: 1, applying: 2, applied: 3, rejected: 4, superseded: 5, stale: 6, failed: 7 } as const)[status]; }

export function ingestionRunStatusLabel(status: IngestionRunStatus | number | string): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({ 1: "running", 2: "succeeded", 3: "partially succeeded", 4: "failed", 5: "cancelled" } as Record<number, string>)[status] ?? "unknown";
}

export function receiptStatusLabel(status: ObservationReceiptStatus): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({ 1: "pending", 2: "processed", 3: "rejected" } as Record<number, string>)[status] ?? "unknown";
}

export function reprocessingStatusLabel(status: ObservationReprocessingStatus): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({ 1: "queued", 2: "running", 3: "succeeded", 4: "no match", 5: "failed", 6: "canceled", 7: "expired" } as Record<number, string>)[status] ?? "unknown";
}

export function ingestionOperationalStateLabel(state: number | string): string {
  if (typeof state === "string") return splitCamelCase(state);
  return ({ 1: "disabled", 2: "no activity", 3: "run active", 4: "last run succeeded", 5: "last run partially succeeded", 6: "last run failed", 7: "last run cancelled", 8: "observations received" } as Record<number, string>)[state] ?? "unknown";
}

export function credentialStatusLabel(status: number | string): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({ 1: "active", 2: "revoked", 3: "expired" } as Record<number, string>)[status] ?? "unknown";
}

export function rawPayloadStatusLabel(status: number | string): string {
  if (typeof status === "string") return splitCamelCase(status);
  return ({ 1: "available", 2: "purging", 3: "purged" } as Record<number, string>)[status] ?? "unknown";
}

export function notificationSeverityLabel(severity: NotificationSeverity): string {
  if (typeof severity === "string") return splitCamelCase(severity);
  return ({ 1: "info", 2: "success", 3: "warning", 4: "error" } as Record<number, string>)[severity] ?? "info";
}

export function notificationAudienceLabel(audience: number | string): string {
  if (typeof audience === "string") return splitCamelCase(audience);
  return ({ 1: "tenant users", 2: "tenant administrators", 3: "platform users", 4: "platform administrators" } as Record<number, string>)[audience] ?? "workspace users";
}

function splitCamelCase(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}
