import type {
  DataRightsCorrectionExecutionDetails,
  GuestDataRightsCorrectionRequest,
  GuestProfile,
  Reservation,
  ReservationDataRightsCorrectionRequest,
} from "../../api/types";
import { ApiError } from "../../api/client";

export type GuestCorrectionValues = {
  displayName: string;
  legalName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  nationalityCountryCode: string;
  preferredLanguageTag: string;
  notes: string;
};

export type ReservationCorrectionValues = {
  primaryGuestName: string;
  email: string;
  phone: string;
  guestCount: string;
  notes: string;
  expectedArrivalTime: string;
  expectedDepartureTime: string;
};

export function guestCorrectionValues(profile: GuestProfile): GuestCorrectionValues {
  return {
    displayName: profile.displayName,
    legalName: profile.legalName ?? "",
    email: profile.email ?? "",
    phone: profile.phone ?? "",
    dateOfBirth: profile.dateOfBirth ?? "",
    nationalityCountryCode: profile.nationalityCountryCode ?? "",
    preferredLanguageTag: profile.preferredLanguageTag ?? "",
    notes: profile.notes ?? "",
  };
}

export function reservationCorrectionValues(
  reservation: Reservation,
): ReservationCorrectionValues {
  return {
    primaryGuestName: reservation.primaryGuestName,
    email: reservation.email ?? "",
    phone: reservation.phone ?? "",
    guestCount: String(reservation.guestCount),
    notes: reservation.notes ?? "",
    expectedArrivalTime: reservation.expectedArrivalTime ?? "",
    expectedDepartureTime: reservation.expectedDepartureTime ?? "",
  };
}

export function buildGuestCorrectionRequest(
  profile: GuestProfile,
  execution: DataRightsCorrectionExecutionDetails,
  values: GuestCorrectionValues,
): GuestDataRightsCorrectionRequest {
  return {
    idempotencyKey: execution.executionId,
    caseId: execution.caseId,
    approvalRevision: execution.approvalRevision,
    guestId: profile.guestId,
    expectedVersion: execution.subject.recordVersion,
    ...normalizeGuestCorrectionValues(values),
  };
}

export function buildReservationCorrectionRequest(
  reservation: Reservation,
  execution: DataRightsCorrectionExecutionDetails,
  values: ReservationCorrectionValues,
): ReservationDataRightsCorrectionRequest {
  return {
    executionId: execution.executionId,
    caseId: execution.caseId,
    approvalRevision: execution.approvalRevision,
    reservationId: reservation.reservationId,
    expectedVersion: execution.subject.recordVersion,
    expectedDetailsRevision: reservation.detailsRevision,
    ...normalizeReservationCorrectionValues(values),
  };
}

export function guestCorrectionChanged(
  profile: GuestProfile,
  values: GuestCorrectionValues,
): boolean {
  return JSON.stringify(normalizeGuestCorrectionValues(values)) !==
    JSON.stringify(normalizeGuestCorrectionValues(guestCorrectionValues(profile)));
}

export function reservationCorrectionChanged(
  reservation: Reservation,
  values: ReservationCorrectionValues,
): boolean {
  return JSON.stringify(normalizeReservationCorrectionValues(values)) !==
    JSON.stringify(normalizeReservationCorrectionValues(
      reservationCorrectionValues(reservation),
    ));
}

export function isSelectedCorrectionRevisionCurrent(
  currentVersion: number,
  execution: DataRightsCorrectionExecutionDetails,
): boolean {
  return currentVersion === execution.subject.recordVersion;
}

export function correctionCaseStatus(status: number | string): string {
  if (typeof status === "number") {
    return ({
      5: "approved",
      7: "executing",
      9: "completed",
    } as Record<number, string>)[status] ?? "other";
  }
  return status.trim().toLowerCase();
}

export function correctionExecutionStatus(
  status: number | string | undefined,
): "unknown" | "claimed" | "completed" {
  if (status === undefined) return "unknown";
  if (typeof status === "number") {
    if (status === 2) return "completed";
    if (status === 1) return "claimed";
    return "unknown";
  }
  const normalized = status.trim().toLowerCase();
  if (normalized === "completed") return "completed";
  if (normalized === "claimed") return "claimed";
  return "unknown";
}

export function correctionClaimExpired(
  execution: DataRightsCorrectionExecutionDetails | undefined,
  now: number,
): boolean {
  return Boolean(
    execution &&
    correctionExecutionStatus(execution.status) === "claimed" &&
    new Date(execution.expiresAtUtc).getTime() <= now,
  );
}

export function correctionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (
      error.code === "DataRights.CorrectionExecutionConflict" ||
      error.code === "DataRights.VersionConflict" ||
      error.status === 409
    ) {
      return "The approved record or correction claim changed. Refresh the request before continuing.";
    }
    if (error.code === "Security.InsufficientAuthentication") {
      return "Sign in again before starting or renewing this correction.";
    }
    if (error.status === 403) {
      return "Your account does not have access to this correction.";
    }
    if (error.status === 404) {
      return "The selected record is no longer available.";
    }
  }
  return "The correction could not be completed. Refresh the request and try again.";
}

function normalizeGuestCorrectionValues(values: GuestCorrectionValues) {
  return {
    displayName: values.displayName.trim(),
    legalName: optional(values.legalName),
    email: optional(values.email),
    phone: optional(values.phone),
    dateOfBirth: optional(values.dateOfBirth),
    nationalityCountryCode: optional(values.nationalityCountryCode)?.toUpperCase() ?? null,
    preferredLanguageTag: optional(values.preferredLanguageTag),
    notes: optional(values.notes),
  };
}

function normalizeReservationCorrectionValues(values: ReservationCorrectionValues) {
  return {
    primaryGuestName: values.primaryGuestName.trim(),
    email: optional(values.email),
    phone: optional(values.phone),
    guestCount: Number(values.guestCount),
    notes: optional(values.notes),
    expectedArrivalTime: optional(values.expectedArrivalTime),
    expectedDepartureTime: optional(values.expectedDepartureTime),
  };
}

function optional(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}
