import type {
  ChangeProposalStatus,
  IngestionRunStatus,
  NotificationHistoryItem,
  ObservationReceiptStatus,
  ObservationReprocessingStatus,
  ReservationStatus,
} from "../api/types";

export const LIVE_DETAIL_REFRESH_INTERVAL_MS = 2_000;
export const LIVE_LIST_REFRESH_INTERVAL_MS = 5_000;

export function reservationStatusKey(status: ReservationStatus | number | string): string {
  if (typeof status === "string") return normalizeStatus(status);
  return ({
    1: "pendingAllocation",
    2: "confirmed",
    3: "allocationRejected",
    4: "cancellationPending",
    5: "cancelled",
    6: "checkedIn",
    7: "noShowPending",
    8: "noShow",
    9: "checkoutPending",
    10: "checkedOut",
  } as Record<number, string>)[status] ?? "unknown";
}

export function reservationNeedsLiveRefresh(status: ReservationStatus | number | string | undefined): boolean {
  return status !== undefined && [
    "pendingAllocation",
    "cancellationPending",
    "noShowPending",
    "checkoutPending",
  ].includes(reservationStatusKey(status));
}

export function ingestionRunNeedsLiveRefresh(status: IngestionRunStatus | undefined): boolean {
  return status !== undefined && statusKey(status, { 1: "running" }) === "running";
}

export function receiptNeedsLiveRefresh(status: ObservationReceiptStatus | undefined): boolean {
  return status !== undefined && statusKey(status, { 1: "pending" }) === "pending";
}

export function reprocessingNeedsLiveRefresh(status: ObservationReprocessingStatus | undefined): boolean {
  if (status === undefined) return false;
  return ["queued", "running"].includes(statusKey(status, { 1: "queued", 2: "running" }));
}

export function proposalNeedsLiveRefresh(status: ChangeProposalStatus | undefined): boolean {
  return status !== undefined && statusKey(status, { 2: "applying" }) === "applying";
}

export function topologyRetirementNeedsLiveRefresh(status: number | string | undefined): boolean {
  if (status === undefined) return false;
  return ["draining", "finalizationRequested", "finalizedAwaitingTopology"].includes(statusKey(status, {
    1: "draining",
    2: "finalizationRequested",
    3: "finalizedAwaitingTopology",
  }));
}

export function operationalNotificationQueryKeys(
  item: Pick<NotificationHistoryItem, "name" | "payload">,
): readonly (readonly unknown[])[] {
  const payload = payloadRecord(item.payload);
  const propertyId = payloadValue(payload, "propertyId");
  const reservationId = payloadValue(payload, "reservationId");
  const staffMemberId = payloadValue(payload, "staffMemberId");
  const connectionId = payloadValue(payload, "connectionId");
  const keys: (readonly unknown[])[] = [];

  if (item.name.startsWith("reservation-") || item.name === "provider-reservation-operation-needs-attention") {
    addPropertyKey(keys, ["reservations"], propertyId);
    addPropertyKey(keys, ["availability"], propertyId);
    addPropertyKey(keys, ["guest-stays"], propertyId);
    addPropertyKey(keys, ["inventory-rooms"], propertyId);
    addPropertyKey(keys, ["rooms"], propertyId);
    addPropertyKey(keys, ["beds"], propertyId);
    if (propertyId && reservationId) {
      keys.push(["reservation", propertyId, reservationId]);
      keys.push(["reservation-history", propertyId, reservationId]);
    }
  }

  if (item.name === "provider-reservation-operation-needs-attention") {
    addPropertyKey(keys, ["ingestion-proposals"], propertyId);
    addPropertyKey(keys, ["ingestion-runs"], propertyId);
    addPropertyKey(keys, ["ingestion-receipts"], propertyId);
    if (propertyId && connectionId) keys.push(["ingestion-connection", propertyId, connectionId]);
  }

  if (item.name.startsWith("manual-inventory-block-") || item.name === "room-sales-mode-changed") {
    addPropertyKey(keys, ["blocks"], propertyId);
    addPropertyKey(keys, ["availability"], propertyId);
    addPropertyKey(keys, ["inventory-rooms"], propertyId);
    addPropertyKey(keys, ["rooms"], propertyId);
    addPropertyKey(keys, ["beds"], propertyId);
  }

  if (item.name === "property-retired") {
    keys.push(["properties"]);
    addPropertyKey(keys, ["rooms"], propertyId);
    addPropertyKey(keys, ["inventory-rooms"], propertyId);
  }

  if (item.name.startsWith("staff-")) {
    keys.push(["staff-members"]);
    keys.push(["staff", "me"]);
    if (staffMemberId) keys.push(["staff-member", staffMemberId]);
  }

  return keys;
}

function addPropertyKey(keys: (readonly unknown[])[], prefix: readonly unknown[], propertyId: string | undefined) {
  if (propertyId) keys.push([...prefix, propertyId]);
}

function payloadRecord(payload: unknown): Record<string, unknown> | undefined {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined;
}

function payloadValue(payload: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!payload) return undefined;
  const entry = Object.entries(payload).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof entry?.[1] === "string" && entry[1] ? entry[1] : undefined;
}

function statusKey(status: number | string, numericNames: Record<number, string>): string {
  return typeof status === "string" ? normalizeStatus(status) : numericNames[status] ?? "unknown";
}

function normalizeStatus(status: string): string {
  const words = status.trim().split(/[-_\s]+/).filter(Boolean);
  return words.map((word, index) => index === 0
    ? word.charAt(0).toLowerCase() + word.slice(1)
    : word.charAt(0).toUpperCase() + word.slice(1)).join("");
}
