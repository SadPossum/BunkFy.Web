import type { Reservation, ReservationMutationReceipt } from "../../api/types";
import { reservationStatusKey } from "../../app/liveUpdates";
import { validDateKey, validStayDateRange } from "../../app/propertyDate";
import type { ReservationLifecycleAttempt, ReservationLifecycleAttemptPayload } from "../reservations/reservationLifecycleAttempt";
import { reservationCreateReceiptMatches } from "../reservations/reservationsMutationAuthority";

export type ReservationPreviewQuickAction = "check-in" | "check-out";
export type ReservationPreviewIntent = ReservationLifecycleAttemptPayload & {
  action: ReservationPreviewQuickAction;
  businessDate: string;
};
export type ReservationPreviewLifecyclePhase = "confirm" | "sending" | "checking" | "unknown" | "pending" | "success" | "rejected" | "changed";
export type ReservationPreviewLifecycleOwner = {
  identity: string;
  returnHref: string;
  intent: ReservationPreviewIntent;
  attempt: ReservationLifecycleAttempt | null;
  phase: ReservationPreviewLifecyclePhase;
  acknowledged: boolean;
  receiptVersion: number | null;
  pendingVersion: number | null;
  readAfter: number;
  deferred: string | null;
};

export function reservationPreviewQuickAction(record: Reservation | undefined, evidence: {
  current: boolean;
  propertyToday: string | null;
  canCheckIn: boolean;
  canCheckOut: boolean;
}): ReservationPreviewQuickAction | null {
  if (!evidence.current || !record || !validDateKey(evidence.propertyToday)
    || !validStayDateRange(record) || !record.allocationId || !record.allocationVersion || !record.holdsInventory
    || !Number.isInteger(record.version) || record.version < 1
    || record.pendingAllocationAmendmentId) return null;
  const status = reservationStatusKey(record.status), today = evidence.propertyToday;
  if (status === "confirmed" && evidence.canCheckIn && today >= record.arrival && today < record.departure) return "check-in";
  if (status === "checkedIn" && evidence.canCheckOut && validDateKey(record.checkedInBusinessDate)
    && today >= record.departure && today >= record.checkedInBusinessDate) return "check-out";
  return null;
}

export function reservationPreviewReceiptMatches(receipt: ReservationMutationReceipt | undefined, attempt: ReservationLifecycleAttempt): boolean {
  return Boolean(receipt && reservationCreateReceiptMatches(receipt, attempt.payload.propertyId)
    && receipt.reservationId === attempt.payload.reservationId && receipt.version > attempt.payload.expectedVersion);
}

export function reservationPreviewReadback(attempt: ReservationLifecycleAttempt, record: Reservation, acknowledged = false, receiptVersion = 0, pendingVersion = 0): "pending" | "success" | "rejected" | "unknown" {
  if (record.propertyId !== attempt.payload.propertyId || record.reservationId !== attempt.payload.reservationId
    || record.version <= attempt.payload.expectedVersion || record.version < receiptVersion) return "unknown";
  const status = reservationStatusKey(record.status);
  if (attempt.payload.action === "check-in") {
    return status === "checkedIn" && record.holdsInventory && record.checkedInBusinessDate === attempt.payload.businessDate ? "success" : "unknown";
  }
  if (status === "checkoutPending" && record.pendingStayBusinessDate === attempt.payload.businessDate) return "pending";
  if (status === "checkedOut" && !record.holdsInventory && record.checkedOutBusinessDate === attempt.payload.businessDate) return "success";
  // Full detail has no release-rejection field. Only an acknowledged exact
  // operation plus the restored state can resolve this as an unsuccessful release.
  if (acknowledged && status === "checkedIn" && record.version > Math.max(attempt.payload.expectedVersion + 1, pendingVersion)) return "rejected";
  return "unknown";
}

export function reservationPreviewInvalidations(tenantId: string, propertyId: string, reservationId: string) {
  return [
    { queryKey: ["operational-preview", tenantId, propertyId, "reservation", reservationId], exact: true },
    { queryKey: ["reservation", propertyId, reservationId], exact: true },
    ...["reservations", "reservation-calendar", "reservation-operations", "guest-stays", "availability", "inventory-rooms", "rooms", "beds"]
      .map(prefix => ({ queryKey: [prefix, propertyId] })),
    { queryKey: ["reservation-history", propertyId, reservationId] },
  ];
}

export function reservationPreviewNavigationPending(owner: ReservationPreviewLifecycleOwner | null): boolean {
  return Boolean(owner && ["sending", "checking", "pending"].includes(owner.phase));
}
