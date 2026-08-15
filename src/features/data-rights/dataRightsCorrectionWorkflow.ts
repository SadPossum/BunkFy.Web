import type {
  DataRightsCorrectionExecutionDetails,
  GuestDataRightsCorrectionRequest,
  GuestProfile,
  Reservation,
  ReservationDataRightsCorrectionRequest,
  WorkspaceStaffOnboardingDataRightsCorrectionRequest,
  WorkspaceStaffOnboardingDataRightsCorrectionTarget,
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

export type WorkspaceStaffOnboardingCorrectionValues = {
  displayName: string;
  legalName: string;
  workEmail: string;
  workPhone: string;
  employeeNumber: string;
  jobTitle: string;
  department: string;
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

export function workspaceStaffOnboardingCorrectionValues(
  target: WorkspaceStaffOnboardingDataRightsCorrectionTarget,
): WorkspaceStaffOnboardingCorrectionValues {
  return {
    displayName: target.displayName,
    legalName: target.legalName ?? "",
    workEmail: target.workEmail ?? "",
    workPhone: target.workPhone ?? "",
    employeeNumber: target.employeeNumber ?? "",
    jobTitle: target.jobTitle ?? "",
    department: target.department ?? "",
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

export function buildWorkspaceStaffOnboardingCorrectionRequest(
  target: WorkspaceStaffOnboardingDataRightsCorrectionTarget,
  execution: DataRightsCorrectionExecutionDetails,
  values: WorkspaceStaffOnboardingCorrectionValues,
): WorkspaceStaffOnboardingDataRightsCorrectionRequest {
  return {
    executionId: execution.executionId,
    caseId: execution.caseId,
    approvalRevision: execution.approvalRevision,
    applicationId: target.applicationId,
    expectedVersion: execution.subject.recordVersion,
    ...normalizeWorkspaceStaffOnboardingCorrectionValues(values),
  };
}

export function workspaceStaffOnboardingCorrectionTargetPath(
  execution: DataRightsCorrectionExecutionDetails,
): string {
  const query = new URLSearchParams({
    executionId: execution.executionId,
    caseId: execution.caseId,
    approvalRevision: String(execution.approvalRevision),
    expectedVersion: String(execution.subject.recordVersion),
  });
  return `/api/workspace-staff-enrollment/data-rights-corrections/${
    encodeURIComponent(execution.subject.recordId)
  }?${query.toString()}`;
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

export function workspaceStaffOnboardingCorrectionChanged(
  target: WorkspaceStaffOnboardingDataRightsCorrectionTarget,
  values: WorkspaceStaffOnboardingCorrectionValues,
): boolean {
  return JSON.stringify(
    normalizeWorkspaceStaffOnboardingCorrectionValues(values),
  ) !== JSON.stringify(
    normalizeWorkspaceStaffOnboardingCorrectionValues(
      workspaceStaffOnboardingCorrectionValues(target),
    ),
  );
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

export type CorrectionClaimAction = "none" | "renew" | "takeover";

export function correctionClaimAction(
  execution: DataRightsCorrectionExecutionDetails | undefined,
  now: number,
): CorrectionClaimAction {
  if (!execution || !correctionClaimExpired(execution, now)) return "none";
  return execution.isCurrentActor ? "renew" : "takeover";
}

export function canEditCorrectionClaim(
  execution: DataRightsCorrectionExecutionDetails | undefined,
  now: number,
): boolean {
  return Boolean(
    execution &&
    execution.isCurrentActor &&
    correctionExecutionStatus(execution.status) === "claimed" &&
    !correctionClaimExpired(execution, now),
  );
}

export function correctionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "DataRights.CorrectionOwnerUnavailable") {
      return "The correction owner is temporarily unavailable. Wait a moment and try again.";
    }
    if (error.code === "DataRights.CorrectionOwnerCatalogInvalid") {
      return "Correction processing is not configured correctly. Contact a system administrator.";
    }
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

function normalizeWorkspaceStaffOnboardingCorrectionValues(
  values: WorkspaceStaffOnboardingCorrectionValues,
) {
  return {
    displayName: values.displayName.trim(),
    legalName: optional(values.legalName),
    workEmail: optional(values.workEmail),
    workPhone: optional(values.workPhone),
    employeeNumber: optional(values.employeeNumber),
    jobTitle: optional(values.jobTitle),
    department: optional(values.department),
  };
}

function optional(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}
