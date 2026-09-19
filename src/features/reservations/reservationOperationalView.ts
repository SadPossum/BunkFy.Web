import type { ReservationListItem } from "../../api/types";
import { reservationStatusKey } from "../../app/liveUpdates";
import { validDateKey } from "../../app/propertyDate";

export type ReservationAttention = {
  key: "allocation-pending" | "allocation-rejected" | "cancellation-pending" | "no-show-pending" | "checkout-pending" | "arrival-overdue" | "checkout-overdue";
  label: string;
  description: string;
  tone: "warning" | "error";
  scheduledDate?: string;
  daysOverdue?: number;
};

const pending: Partial<Record<string, ReservationAttention>> = {
    pendingAllocation: { key: "allocation-pending", label: "Allocation pending", description: "Room or bed allocation has not completed. Open the reservation to review its progress.", tone: "warning" },
    allocationRejected: { key: "allocation-rejected", label: "Allocation rejected", description: "The requested room or bed was not held. Open the reservation to review the request, or check availability in Spaces.", tone: "error" },
    cancellationPending: { key: "cancellation-pending", label: "Cancellation pending", description: "Cancellation is still being processed. Open the reservation to review its progress.", tone: "warning" },
    noShowPending: { key: "no-show-pending", label: "No-show pending", description: "The no-show update is still being processed. Open the reservation to review its progress.", tone: "warning" },
    checkoutPending: { key: "checkout-pending", label: "Checkout pending", description: "Checkout is still being processed. Open the reservation to review its progress.", tone: "warning" },
};

// A retained lifecycle label is not evidence that its operational reason is current.
export function reservationPendingAttention(status: ReservationListItem["status"]): ReservationAttention | undefined {
  return pending[reservationStatusKey(status)];
}

export function reservationAttentionReasons(
  reservation: Pick<ReservationListItem, "status" | "arrival" | "departure">,
  operatingDate?: string | null,
): ReservationAttention[] {
  if (!validDateKey(operatingDate)) return [];
  const status = reservationStatusKey(reservation.status);
  const pendingReason = reservationPendingAttention(reservation.status);
  if (pendingReason) return [pendingReason];
  const scheduledDate = status === "confirmed" ? reservation.arrival : status === "checkedIn" ? reservation.departure : null;
  if (!validDateKey(scheduledDate) || scheduledDate >= operatingDate) return [];
  const arrival = status === "confirmed";
  return [{
    key: arrival ? "arrival-overdue" : "checkout-overdue",
    label: arrival ? "Arrival overdue" : "Checkout overdue",
    description: arrival ? "Check-in has not been recorded. Review the stay before changing its status." : "Checkout has not been recorded. Confirm whether the guest is leaving or staying longer.",
    tone: "warning",
    scheduledDate,
    daysOverdue: Math.round((Date.parse(`${operatingDate}T12:00:00Z`) - Date.parse(`${scheduledDate}T12:00:00Z`)) / 86_400_000),
  }];
}

export function reservationAttentionReason(
  reservation: ReservationListItem,
  operatingDate?: string,
) {
  return reservationAttentionReasons(reservation, operatingDate)[0]?.label ?? null;
}

export function reservationInventorySummary(
  reservation: ReservationListItem,
): string {
  return reservationInventoryPresentation(reservation).summary;
}

export function reservationInventoryPresentation(
  reservation: Pick<ReservationListItem, "status" | "holdsInventory" | "inventoryUnitCount">,
) {
  if (reservation.holdsInventory) {
    return {
      summary: `${reservation.inventoryUnitCount} ${reservation.inventoryUnitCount === 1 ? "unit held" : "units held"}`,
      heading: "Assigned inventory",
      contextLabel: "Assigned room or bed",
      explanation: null,
    };
  }

  const status = reservationStatusKey(reservation.status);
  if (status === "pendingAllocation" || status === "allocationRejected") {
    return {
      summary: "Requested · not held",
      heading: "Requested inventory — not held",
      contextLabel: "Requested room or bed",
      explanation: status === "allocationRejected"
        ? "The requested inventory could not be allocated. This reservation does not hold a room or bed."
        : "This request does not reserve a room or bed yet. Availability can change until allocation succeeds.",
    };
  }
  if (["cancelled", "noShow", "checkedOut"].includes(status)) {
    return {
      summary: "Inventory released",
      heading: "Recorded inventory",
      contextLabel: "Recorded room or bed",
      explanation: null,
    };
  }
  return {
    summary: "Inventory not held",
    heading: "Recorded inventory",
    contextLabel: "Recorded room or bed",
    explanation: null,
  };
}
