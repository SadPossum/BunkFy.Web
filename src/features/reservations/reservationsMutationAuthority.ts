import { guestStatusLabel } from "../../api/labels";
import type {
  GuestListItem,
  InventoryUnitAvailability,
  Reservation,
  ReservationMutationReceipt,
} from "../../api/types";
import type { ApiSession } from "../../api/client";
import { reservationStatusKey } from "../../app/liveUpdates";

export function reservationEditorIdentity(session: ApiSession | null, propertyId: string): string {
  return JSON.stringify([session?.tenantId, session?.subjectId, session?.sessionId, session?.generation, propertyId]);
}

export function reservationCreateReceiptMatches(receipt: ReservationMutationReceipt, propertyId: string): boolean {
  return receipt.propertyId === propertyId && Boolean(receipt.reservationId)
    && Number.isInteger(receipt.version) && receipt.version > 0
    && Number.isInteger(receipt.detailsRevision) && receipt.detailsRevision > 0
    && ["pendingAllocation", "confirmed", "allocationRejected", "cancellationPending", "cancelled", "checkedIn", "noShowPending", "noShow", "checkoutPending", "checkedOut"].includes(reservationStatusKey(receipt.status));
}

export function reservationCreationSubmitAllowed(evidence: {
  formValid: boolean;
  guestIntentCurrent: boolean;
  permissionsCurrent: boolean;
  canCreate: boolean;
  exactReplay: boolean;
  freshInventoryCurrent: boolean;
}): boolean {
  return evidence.formValid && evidence.guestIntentCurrent && evidence.permissionsCurrent && evidence.canCreate
    && (evidence.exactReplay || evidence.freshInventoryCurrent);
}

export function reservationEditorCompletionCurrent(capturedIdentity: string, currentIdentity: string, mounted: boolean): boolean {
  return mounted && capturedIdentity === currentIdentity;
}

export type ReservationMutationAction =
  | "create-reservation"
  | "update-details"
  | "lifecycle"
  | "link-existing-guest"
  | "create-and-link-guest";

export type ReservationMutationEvidence = {
  permissionsCurrent: boolean;
  reservationCurrent?: boolean;
  availabilityCurrent?: boolean;
  guestDirectoryCurrent?: boolean;
};

export function reservationMutationAllowed(
  action: ReservationMutationAction,
  evidence: ReservationMutationEvidence,
): boolean {
  if (!evidence.permissionsCurrent) return false;

  switch (action) {
    case "create-reservation":
      return evidence.availabilityCurrent === true;
    case "update-details":
    case "lifecycle":
    case "create-and-link-guest":
      return evidence.reservationCurrent === true;
    case "link-existing-guest":
      return evidence.reservationCurrent === true &&
        evidence.guestDirectoryCurrent === true;
  }
}

export function reservationRecordMatches(
  current: Reservation | null | undefined,
  candidate: Reservation,
): boolean {
  return current?.propertyId === candidate.propertyId &&
    current.reservationId === candidate.reservationId &&
    current.version === candidate.version &&
    current.detailsRevision === candidate.detailsRevision;
}

export function inventorySelectionIsCurrent(
  propertyId: string,
  units: InventoryUnitAvailability[],
  selectedUnitIds: string[],
): boolean {
  if (selectedUnitIds.length === 0) return false;

  const uniqueIds = new Set(selectedUnitIds);
  if (uniqueIds.size !== selectedUnitIds.length) return false;

  const availableIds = new Set(
    units
      .filter((item) =>
        item.isAvailable && item.unit.propertyId === propertyId)
      .map((item) => item.unit.inventoryUnitId),
  );

  return selectedUnitIds.every((id) => availableIds.has(id));
}

export function guestCandidateIsCurrent(
  guests: GuestListItem[],
  candidate: GuestListItem,
): boolean {
  if (guestStatusLabel(candidate.status) !== "active") return false;

  return guests.some((guest) =>
    guest.guestId === candidate.guestId &&
    guest.lastChangedAtUtc === candidate.lastChangedAtUtc &&
    guestStatusLabel(guest.status) === "active");
}
