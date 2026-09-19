import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../src/api/client";
import type {
  DataRightsCorrectionExecutionDetails,
  GuestProfile,
  Reservation,
  WorkspaceStaffOnboardingDataRightsCorrectionTarget,
} from "../src/api/types";
import {
  buildGuestCorrectionRequest,
  buildReservationCorrectionRequest,
  buildWorkspaceStaffOnboardingCorrectionRequest,
  canEditCorrectionClaim,
  correctionCaseStatus,
  correctionClaimAction,
  correctionClaimExpired,
  correctionErrorMessage,
  correctionExecutionStatus,
  guestCorrectionChanged,
  guestCorrectionValues,
  guestCorrectionDraftReady,
  isSelectedCorrectionRevisionCurrent,
  reservationCorrectionChanged,
  reservationCorrectionValues,
  workspaceStaffOnboardingCorrectionChanged,
  workspaceStaffOnboardingCorrectionTargetPath,
  workspaceStaffOnboardingCorrectionValues,
} from "../src/features/data-rights/dataRightsCorrectionWorkflow";
import { CorrectionClaimWindow } from "../src/features/data-rights/PrivacyRequestCorrection";

describe("data-rights correction operator workflow", () => {
  it("admits only the exact ready Guest draft context, independently of routine fetching", () => {
    expect(guestCorrectionDraftReady(draftContext())).toBe(true);
  });
  it.each([
    "missing-context", "missing-operator", "operator", "scope", "property", "case-property", "context-case", "context-version",
    "case-status", "case-count", "case-ready", "selected-ready", "permission", "claim-ready", "missing-claim",
    "execution-case", "execution-revision", "execution-property", "expired", "foreign-claim", "completed-claim", "invalid-expiry",
    "selected-case", "selected-count", "selected-owner", "selected-type", "selected-id", "selected-version",
  ])("rejects %s without relaxing command authority", mode => {
    const value = draftContext();
    switch (mode) {
      case "missing-context": value.context = undefined; break;
      case "missing-operator": value.operatorScopeKey = ""; break;
      case "operator": value.operatorScopeKey = "different"; break;
      case "scope": value.scopeKey = "staff"; break;
      case "property": value.propertyId = "different"; break;
      case "case-property": value.dataRightsCase.propertyId = "different"; break;
      case "context-case": value.context!.caseId = "different"; break;
      case "context-version": value.context!.caseVersion++; break;
      case "case-status": value.dataRightsCase.status = 9; break;
      case "case-count": value.dataRightsCase.selectedSubjectCount = 2; break;
      case "case-ready": value.context!.caseReady = false; break;
      case "selected-ready": value.context!.selectedReady = false; break;
      case "permission": value.permissionCurrent = false; break;
      case "claim-ready": value.correctionReady = false; break;
      case "missing-claim": value.execution = undefined; break;
      case "execution-case": value.execution!.caseId = "different"; break;
      case "execution-revision": value.execution!.executionRevision++; break;
      case "execution-property": value.execution!.propertyId = "different"; break;
      case "expired": value.now = Date.parse(value.execution!.expiresAtUtc) + 1; break;
      case "foreign-claim": value.execution!.isCurrentActor = false; break;
      case "completed-claim": value.execution!.status = 2; break;
      case "invalid-expiry": value.execution!.expiresAtUtc = "invalid"; break;
      case "selected-case": value.context!.selectedEvidence!.caseVersion++; break;
      case "selected-count": value.context!.selectedEvidence!.subjects = []; break;
      case "selected-owner": value.context!.selectedEvidence!.subjects[0].ownerKey = "reservations"; break;
      case "selected-type": value.context!.selectedEvidence!.subjects[0].recordType = "reservation"; break;
      case "selected-id": value.context!.selectedEvidence!.subjects[0].recordId = "different"; break;
      case "selected-version": value.context!.selectedEvidence!.subjects[0].recordVersion++; break;
    }
    expect(guestCorrectionDraftReady(value)).toBe(false);
  });
  it.each(["ZZ", ""]) ("retains optional nationality %s while preserving correction revision/idempotency and every other value", code => {
    const initial = guestCorrectionValues(guest), baseline = buildGuestCorrectionRequest(guest, guestExecution, initial);
    expect(buildGuestCorrectionRequest(guest, guestExecution, { ...initial, nationalityCountryCode: code.toLowerCase() })).toEqual({ ...baseline, nationalityCountryCode: code || null });
  });
  it("builds a Guest owner request bound to the claim and approved revision", () => {
    const values = {
      ...guestCorrectionValues(guest),
      displayName: "  Maya Chen  ",
      email: "",
      nationalityCountryCode: "gb",
    };

    expect(guestCorrectionChanged(guest, values)).toBe(true);
    expect(buildGuestCorrectionRequest(guest, guestExecution, values)).toEqual({
      idempotencyKey: "11111111-1111-1111-1111-111111111111",
      caseId: "22222222-2222-2222-2222-222222222222",
      approvalRevision: 7,
      guestId: guest.guestId,
      expectedVersion: 12,
      displayName: "Maya Chen",
      legalName: "Maya Chen",
      email: null,
      phone: "+44 20 1234 5678",
      dateOfBirth: "1995-05-20",
      nationalityCountryCode: "GB",
      preferredLanguageTag: "en-GB",
      languageTags: ["en-GB"],
      notes: "Late arrival",
    });
  });

  it("builds a Reservation owner request with both approved revisions", () => {
    const values = {
      ...reservationCorrectionValues(reservation),
      guestCount: "3",
      expectedArrivalTime: "",
      expectedDepartureTime: "11:00:00",
    };

    expect(reservationCorrectionChanged(reservation, values)).toBe(true);
    expect(buildReservationCorrectionRequest(
      reservation,
      reservationExecution,
      values,
    )).toMatchObject({
      executionId: "33333333-3333-3333-3333-333333333333",
      caseId: "22222222-2222-2222-2222-222222222222",
      approvalRevision: 7,
      reservationId: reservation.reservationId,
      expectedVersion: 21,
      expectedDetailsRevision: 4,
      guestCount: 3,
      expectedArrivalTime: null,
      expectedDepartureTime: "11:00:00",
    });
  });

  it("builds a Workspaces owner request bound to the exact tenant claim", () => {
    const values = {
      ...workspaceStaffOnboardingCorrectionValues(workspaceTarget),
      displayName: "  Ada Corrected  ",
      workEmail: "",
      department: " Guest operations ",
    };

    expect(
      workspaceStaffOnboardingCorrectionChanged(workspaceTarget, values),
    ).toBe(true);
    expect(
      buildWorkspaceStaffOnboardingCorrectionRequest(
        workspaceTarget,
        workspaceExecution,
        values,
      ),
    ).toEqual({
      executionId: "44444444-4444-4444-4444-444444444444",
      caseId: "22222222-2222-2222-2222-222222222222",
      approvalRevision: 7,
      applicationId: workspaceTarget.applicationId,
      expectedVersion: 3,
      displayName: "Ada Corrected",
      legalName: "Ada Lovelace",
      workEmail: null,
      workPhone: "+44 20 5555 0100",
      employeeNumber: "EMP-100",
      jobTitle: "Manager",
      department: "Guest operations",
    });
    expect(
      workspaceStaffOnboardingCorrectionTargetPath(workspaceExecution),
    ).toBe(
      "/api/workspace-staff-enrollment/data-rights-corrections/" +
      `${workspaceTarget.applicationId}?` +
      "executionId=44444444-4444-4444-4444-444444444444&" +
      "caseId=22222222-2222-2222-2222-222222222222&" +
      "approvalRevision=7&expectedVersion=3",
    );
  });

  it("fails the editor closed when the owner record no longer matches selection", () => {
    expect(isSelectedCorrectionRevisionCurrent(12, guestExecution)).toBe(true);
    expect(isSelectedCorrectionRevisionCurrent(13, guestExecution)).toBe(false);
  });

  it("distinguishes active, expired and completed correction progress", () => {
    expect(correctionCaseStatus(7)).toBe("executing");
    expect(correctionExecutionStatus(1)).toBe("claimed");
    expect(correctionClaimExpired(guestExecution, Date.parse("2026-07-27T12:05:00Z")))
      .toBe(false);
    expect(correctionClaimExpired(guestExecution, Date.parse("2026-07-27T12:11:00Z")))
      .toBe(true);
    expect(correctionExecutionStatus(2)).toBe("completed");
    expect(correctionClaimExpired({ ...guestExecution, status: 2 }, Date.parse("2026-07-27T12:11:00Z")))
      .toBe(false);
  });

  it("keeps active claims exclusive and offers the correct recovery action", () => {
    const activeAt = Date.parse("2026-07-27T12:05:00Z");
    const expiredAt = Date.parse("2026-07-27T12:10:00Z");
    const foreignExecution = { ...guestExecution, isCurrentActor: false };

    expect(canEditCorrectionClaim(guestExecution, activeAt)).toBe(true);
    expect(canEditCorrectionClaim(foreignExecution, activeAt)).toBe(false);
    expect(correctionClaimAction(guestExecution, activeAt)).toBe("none");
    expect(correctionClaimAction(foreignExecution, activeAt)).toBe("none");

    expect(canEditCorrectionClaim(guestExecution, expiredAt)).toBe(false);
    expect(canEditCorrectionClaim(foreignExecution, expiredAt)).toBe(false);
    expect(correctionClaimAction(guestExecution, expiredAt)).toBe("renew");
    expect(correctionClaimAction(foreignExecution, expiredAt)).toBe("takeover");
    expect(correctionClaimAction(
      { ...guestExecution, status: 2 },
      expiredAt,
    )).toBe("none");
  });

  it("renders a foreign claim as held until its takeover window opens", () => {
    const foreignExecution = { ...guestExecution, isCurrentActor: false };
    const active = renderToStaticMarkup(createElement(CorrectionClaimWindow, {
      execution: foreignExecution,
      expired: false,
      action: "none",
      renewing: false,
      onRenew: () => undefined,
    }));
    const expired = renderToStaticMarkup(createElement(CorrectionClaimWindow, {
      execution: foreignExecution,
      expired: true,
      action: "takeover",
      renewing: false,
      onRenew: () => undefined,
    }));

    expect(active).toContain("Correction claim held by another operator");
    expect(active).toContain("operator-b");
    expect(active).not.toContain("Take over window");
    expect(expired).toContain("Editing window available for takeover");
    expect(expired).toContain("Take over window");
  });

  it("never exposes server detail or entered values in correction errors", () => {
    const sensitive = new ApiError(
      "Maya Chen and maya@example.test caused a conflict",
      409,
      "DataRights.CorrectionExecutionConflict",
    );
    const unknown = new Error("Late arrival note was rejected");

    expect(correctionErrorMessage(sensitive)).toBe(
      "The approved record or correction claim changed. Refresh the request before continuing.",
    );
    expect(correctionErrorMessage(unknown)).toBe(
      "The correction could not be completed. Refresh the request and try again.",
    );
    expect(correctionErrorMessage(sensitive)).not.toContain("Maya");
    expect(correctionErrorMessage(unknown)).not.toContain("Late arrival");
  });

  it("distinguishes unavailable correction owners from invalid composition", () => {
    expect(correctionErrorMessage(new ApiError(
      "owner unavailable",
      503,
      "DataRights.CorrectionOwnerUnavailable",
    ))).toBe(
      "The correction owner is temporarily unavailable. Wait a moment and try again.",
    );
    expect(correctionErrorMessage(new ApiError(
      "duplicate owner",
      500,
      "DataRights.CorrectionOwnerCatalogInvalid",
    ))).toBe(
      "Correction processing is not configured correctly. Contact a system administrator.",
    );
  });
});

const guest: GuestProfile = {
  guestId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  originPropertyId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  displayName: "Maya",
  legalName: "Maya Chen",
  email: "maya@example.test",
  phone: "+44 20 1234 5678",
  dateOfBirth: "1995-05-20",
  nationalityCountryCode: "GB",
  preferredLanguageTag: "en-GB",
  notes: "Late arrival",
  status: 1,
  version: 12,
  createdBy: "operator-a",
  createdAtUtc: "2026-07-20T10:00:00Z",
  lastChangedBy: "operator-a",
  lastChangedAtUtc: "2026-07-20T10:00:00Z",
};

const reservation = {
  reservationId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  primaryGuestName: "Maya Chen",
  email: "maya@example.test",
  phone: "+44 20 1234 5678",
  guestCount: 2,
  notes: "Late arrival",
  expectedArrivalTime: "22:00:00",
  expectedDepartureTime: null,
  detailsRevision: 4,
  version: 21,
} as Reservation;

const guestExecution: DataRightsCorrectionExecutionDetails = {
  executionId: "11111111-1111-1111-1111-111111111111",
  caseId: "22222222-2222-2222-2222-222222222222",
  caseType: 1,
  propertyId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  selectedCaseVersion: 9,
  executionRevision: 10,
  approvalRevision: 7,
  subject: {
    ownerKey: "guests",
    recordType: "guest-profile",
    recordId: guest.guestId,
    recordVersion: 12,
  },
  fieldPolicyKey: "guests.profile.correction.v1",
  claimedBy: "operator-b",
  isCurrentActor: true,
  startedAtUtc: "2026-07-27T12:00:00Z",
  expiresAtUtc: "2026-07-27T12:10:00Z",
  status: 1,
  receiptContractVersion: null,
  receiptId: null,
  currentRecordVersion: null,
  changedFieldCount: null,
  changedFieldsSha256: null,
  receiptSha256: null,
  completedAtUtc: null,
  version: 1,
};

function draftContext(): Parameters<typeof guestCorrectionDraftReady>[0] {
  const propertyId = guestExecution.propertyId!;
  return {
    propertyId, operatorScopeKey: "current-actor", scopeKey: `guest:${propertyId}`,
    permissionCurrent: true, correctionReady: true, now: Date.parse("2026-07-27T12:05:00Z"),
    dataRightsCase: { id: guestExecution.caseId, propertyId, version: 10, status: 7, selectedSubjectCount: 1 },
    execution: structuredClone(guestExecution),
    context: { operatorScopeKey: "current-actor", scopeKey: `guest:${propertyId}`, caseId: guestExecution.caseId,
      caseVersion: 10, caseReady: true, selectedReady: true,
      selectedEvidence: { caseVersion: 10, subjects: [{ ...guestExecution.subject, selectedAtUtc: "2026-07-27T12:00:00Z" }] } },
  };
}

const reservationExecution: DataRightsCorrectionExecutionDetails = {
  ...guestExecution,
  executionId: "33333333-3333-3333-3333-333333333333",
  subject: {
    ownerKey: "reservations",
    recordType: "reservation",
    recordId: reservation.reservationId,
    recordVersion: 21,
  },
  fieldPolicyKey: "reservations.guest-details.correction.v1",
};

const workspaceTarget: WorkspaceStaffOnboardingDataRightsCorrectionTarget = {
  applicationId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  version: 3,
  displayName: "Ada Operator",
  legalName: "Ada Lovelace",
  workEmail: "ada@example.test",
  workPhone: "+44 20 5555 0100",
  employeeNumber: "EMP-100",
  jobTitle: "Manager",
  department: "Operations",
};

const workspaceExecution: DataRightsCorrectionExecutionDetails = {
  ...guestExecution,
  executionId: "44444444-4444-4444-4444-444444444444",
  caseType: 3,
  propertyId: null,
  subject: {
    ownerKey: "workspaces",
    recordType: "staff-onboarding",
    recordId: workspaceTarget.applicationId,
    recordVersion: 3,
  },
  fieldPolicyKey:
    "workspaces.staff-onboarding.applicant-correction.v1",
};
