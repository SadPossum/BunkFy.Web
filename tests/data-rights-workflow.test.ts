import { describe, expect, it } from "vitest";
import type { DataRightsCase } from "../src/api/types";
import {
  DATA_RIGHTS_ANONYMISATION,
  DATA_RIGHTS_CORRECTION,
  DATA_RIGHTS_RESTRICTION,
  DATA_RIGHTS_RESTRICTION_APPLY,
  DATA_RIGHTS_RESTRICTION_RELEASE,
  availableDataRightsActions,
  dataRightsActionRequiresReviewEvidence,
  dataRightsCaseNeedsLiveRefresh,
  dataRightsExportNeedsLiveRefresh,
  dataRightsExportStatusLabel,
  dataRightsRequestLabel,
  dataRightsRequesterLabel,
  dataRightsSelectedEvidencePath,
  isDataRightsSelectedEvidenceCurrent,
  dataRightsCaseStatusLabel,
  dataRightsExecutionBatchNeedsLiveRefresh,
  dataRightsExecutionNeedsLiveRefresh,
  dataRightsCasesPath,
  dataRightsOperationKind,
  dataRightsResponseDeadlineRightLabel,
  dataRightsResponseDeadlineState,
  dataRightsScopeKey,
  shortDataRightsCaseId,
  type DataRightsAction,
  type DataRightsCapabilities,
} from "../src/features/data-rights/dataRightsWorkflow";

const allCapabilities: DataRightsCapabilities = {
  read: true,
  create: true,
  discover: true,
  review: true,
  decide: true,
  execute: true,
  manage: true,
  export: true,
  downloadExport: true,
  restrict: true,
  erase: true,
};

describe("privacy request workflow", () => {
  it("derives only the next valid draft actions", () => {
    expect(availableDataRightsActions(dataRightsCase({
      status: 1,
      verificationStatus: 1,
      routingStatus: 1,
    }), allCapabilities)).toEqual([
      "verify-requester",
      "reject-verification",
      "route-request",
      "cancel",
    ]);

    expect(availableDataRightsActions(dataRightsCase({
      status: 1,
      verificationStatus: 2,
      routingStatus: 2,
    }), allCapabilities)).toEqual(["begin-discovery", "cancel"]);
  });

  it("requires at least one explicitly selected subject before review", () => {
    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      selectedSubjectCount: 0,
    }), allCapabilities)).toEqual(["discover-subject", "cancel"]);
    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      selectedSubjectCount: 1,
    }), allCapabilities)).toEqual(["discover-subject", "review", "cancel"]);
    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      selectedSubjectCount: 3,
    }), allCapabilities)).toEqual(["discover-subject", "review", "cancel"]);
  });

  it("lets a reviewer advance selected scope without subject discovery", () => {
    const reviewOnly = {
      ...allCapabilities,
      discover: false,
    };

    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      selectedSubjectCount: 1,
    }), reviewOnly)).toEqual(["review", "cancel"]);
  });

  it("chooses the least-privileged selected evidence route", () => {
    const scope = { kind: "guest", propertyId: "property-1" } as const;
    expect(dataRightsSelectedEvidencePath(scope, "case-1", {
      discover: true,
      review: true,
    })).toBe(
      "/api/data-rights/properties/property-1/cases/case-1/review-evidence",
    );
    expect(dataRightsSelectedEvidencePath({ kind: "staff" }, "case-2", {
      discover: true,
      review: false,
    })).toBe("/api/data-rights/tenant/cases/case-2/subjects");
    expect(dataRightsSelectedEvidencePath(scope, "case-1", {
      discover: false,
      review: false,
    })).toBeNull();
  });

  it("requires version-matched and complete selected evidence for review actions", () => {
    const currentCase = dataRightsCase({
      selectedSubjectCount: 1,
      version: 7,
    });
    const evidence = {
      caseVersion: 7,
      subjects: [{
        ownerKey: "guests",
        recordType: "guest-record",
        recordId: "00000000-0000-0000-0000-000000000001",
        recordVersion: 4,
        selectedAtUtc: "2026-08-23T10:00:00Z",
      }],
    };

    expect(isDataRightsSelectedEvidenceCurrent(currentCase, evidence)).toBe(true);
    expect(isDataRightsSelectedEvidenceCurrent(currentCase, {
      ...evidence,
      caseVersion: 6,
    })).toBe(false);
    expect(isDataRightsSelectedEvidenceCurrent(currentCase, {
      ...evidence,
      subjects: [],
    })).toBe(false);
    const reviewActions: DataRightsAction[] = [
      "review",
      "begin-decision",
      "approve",
      "deny",
    ];
    expect(reviewActions.every(dataRightsActionRequiresReviewEvidence)).toBe(true);
    expect(dataRightsActionRequiresReviewEvidence("cancel")).toBe(false);
  });

  it("requires exactly one selected subject before restriction review", () => {
    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      requestedOperations: DATA_RIGHTS_RESTRICTION,
      restrictionDirective: DATA_RIGHTS_RESTRICTION_APPLY,
      selectedSubjectCount: 0,
    }), allCapabilities)).not.toContain("review");
    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      requestedOperations: DATA_RIGHTS_RESTRICTION,
      restrictionDirective: DATA_RIGHTS_RESTRICTION_APPLY,
      selectedSubjectCount: 1,
    }), allCapabilities)).toContain("review");
    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      requestedOperations: DATA_RIGHTS_RESTRICTION,
      restrictionDirective: DATA_RIGHTS_RESTRICTION_APPLY,
      selectedSubjectCount: 2,
    }), allCapabilities)).not.toContain("review");
  });

  it("requires a selected target for current restriction-release cases", () => {
    const currentRelease = {
      status: 2,
      requestedOperations: DATA_RIGHTS_RESTRICTION,
      restrictionDirective: DATA_RIGHTS_RESTRICTION_RELEASE,
      selectedSubjectCount: 1,
      restrictionTargetingContractVersion: 1,
    } satisfies Partial<DataRightsCase>;

    expect(availableDataRightsActions(dataRightsCase({
      ...currentRelease,
      restrictionReleaseTarget: null,
    }), allCapabilities)).not.toContain("review");
    expect(availableDataRightsActions(dataRightsCase({
      ...currentRelease,
      restrictionReleaseTarget: {
        ownerKey: "guests",
        ownerOperationId: "8d000000-0000-0000-0000-000000000020",
        ownerOperationVersion: 4,
        selectedAtUtc: "2026-08-15T12:00:00Z",
      },
    }), allCapabilities)).toContain("review");
    expect(availableDataRightsActions(dataRightsCase({
      ...currentRelease,
      restrictionTargetingContractVersion: null,
      restrictionReleaseTarget: null,
    }), allCapabilities)).toContain("review");
  });

  it("requires exactly one selected subject before correction review", () => {
    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      requestedOperations: DATA_RIGHTS_CORRECTION,
      selectedSubjectCount: 0,
    }), allCapabilities)).not.toContain("review");
    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      requestedOperations: DATA_RIGHTS_CORRECTION,
      selectedSubjectCount: 1,
    }), allCapabilities)).toContain("review");
    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      requestedOperations: DATA_RIGHTS_CORRECTION,
      selectedSubjectCount: 2,
    }), allCapabilities)).not.toContain("review");
  });

  it("keeps approval and destructive execution as separate actions", () => {
    expect(availableDataRightsActions(dataRightsCase({ status: 4 }), allCapabilities))
      .toEqual(["approve", "deny", "cancel"]);
    expect(availableDataRightsActions(dataRightsCase({ status: 5 }), allCapabilities))
      .toEqual(["execute-removal"]);
  });

  it("offers approved Staff removal only to tenant erasers", () => {
    const approvedStaffRemoval = dataRightsCase({
      type: 3,
      propertyId: null,
      status: 5,
      requestedOperations: DATA_RIGHTS_ANONYMISATION,
    });

    expect(availableDataRightsActions(approvedStaffRemoval, allCapabilities))
      .toEqual(["execute-removal"]);
    expect(availableDataRightsActions(approvedStaffRemoval, {
      ...allCapabilities,
      erase: false,
    })).toEqual([]);
    expect(dataRightsRequestLabel(approvedStaffRemoval)).toBe("Staff data removal");
  });

  it("requires exactly one Staff profile before review", () => {
    const staffRemoval: Partial<DataRightsCase> = {
      type: 3,
      propertyId: null,
      status: 2,
      requestedOperations: DATA_RIGHTS_ANONYMISATION,
    };

    expect(availableDataRightsActions(dataRightsCase({
      ...staffRemoval,
      selectedSubjectCount: 0,
    }), allCapabilities)).not.toContain("review");
    expect(availableDataRightsActions(dataRightsCase({
      ...staffRemoval,
      selectedSubjectCount: 1,
    }), allCapabilities)).toContain("review");
    expect(availableDataRightsActions(dataRightsCase({
      ...staffRemoval,
      selectedSubjectCount: 2,
    }), allCapabilities)).not.toContain("review");
  });

  it("uses protected generation rather than destructive execution for an access export", () => {
    expect(availableDataRightsActions(dataRightsCase({
      status: 5,
      requestedOperations: 1,
    }), allCapabilities)).toEqual(["generate-export"]);
    expect(availableDataRightsActions(dataRightsCase({
      status: 5,
      requestedOperations: 1,
    }), { ...allCapabilities, export: false })).toEqual([]);
  });

  it("uses a dedicated capability and action for restriction execution", () => {
    const approved = dataRightsCase({
      status: 5,
      requestedOperations: DATA_RIGHTS_RESTRICTION,
      restrictionDirective: DATA_RIGHTS_RESTRICTION_APPLY,
      selectedSubjectCount: 1,
    });

    expect(availableDataRightsActions(approved, allCapabilities))
      .toEqual(["execute-restriction"]);
    expect(availableDataRightsActions(approved, {
      ...allCapabilities,
      restrict: false,
    })).toEqual([]);
    expect(dataRightsRequestLabel({ ...approved, type: 3 }))
      .toBe("Limit staff data processing");
    expect(dataRightsRequestLabel({
      ...approved,
      type: 3,
      restrictionDirective: DATA_RIGHTS_RESTRICTION_RELEASE,
    })).toBe("Release staff processing limit");
  });

  it("uses a dedicated capability and action for correction execution", () => {
    const approved = dataRightsCase({
      status: 5,
      requestedOperations: DATA_RIGHTS_CORRECTION,
      selectedSubjectCount: 1,
    });

    expect(availableDataRightsActions(approved, allCapabilities))
      .toEqual(["execute-correction"]);
    expect(availableDataRightsActions(approved, {
      ...allCapabilities,
      execute: false,
    })).toEqual([]);
    expect(dataRightsOperationKind(approved)).toBe("correction");
    expect(dataRightsRequestLabel(approved)).toBe("Correct guest data");
  });

  it("stops polling terminal case and work item states", () => {
    expect(dataRightsCaseNeedsLiveRefresh(7)).toBe(true);
    expect(dataRightsCaseNeedsLiveRefresh(9)).toBe(false);
    expect(dataRightsExecutionNeedsLiveRefresh(1)).toBe(true);
    expect(dataRightsExecutionNeedsLiveRefresh(2)).toBe(true);
    expect(dataRightsExecutionNeedsLiveRefresh(5)).toBe(false);
    expect(dataRightsExecutionNeedsLiveRefresh(6)).toBe(false);
    expect(dataRightsExecutionBatchNeedsLiveRefresh([{ status: 5 }, { status: 2 }])).toBe(true);
    expect(dataRightsExecutionBatchNeedsLiveRefresh([{ status: 5 }, { status: 6 }])).toBe(false);
    expect(dataRightsExecutionBatchNeedsLiveRefresh([])).toBe(false);
    expect(dataRightsExportNeedsLiveRefresh(1)).toBe(true);
    expect(dataRightsExportNeedsLiveRefresh(2)).toBe(true);
    expect(dataRightsExportNeedsLiveRefresh(3)).toBe(false);
  });

  it("classifies only external guest response deadlines and closes urgency with the case", () => {
    const now = new Date("2026-07-25T10:00:00Z");

    expect(dataRightsResponseDeadlineState(dataRightsCase({
      type: 1,
      requesterRelationship: 1,
      dueAtUtc: null,
    }), now)).toBe("pending");
    expect(dataRightsResponseDeadlineState(dataRightsCase({
      type: 1,
      requesterRelationship: 2,
      dueAtUtc: "2026-07-26T09:00:00Z",
    }), now)).toBe("due-soon");
    expect(dataRightsResponseDeadlineState(dataRightsCase({
      type: 1,
      requesterRelationship: 1,
      dueAtUtc: "2026-07-25T09:00:00Z",
    }), now)).toBe("overdue");
    expect(dataRightsResponseDeadlineState(dataRightsCase({
      type: 1,
      requesterRelationship: 1,
      status: 9,
      dueAtUtc: "2026-07-25T09:00:00Z",
    }), now)).toBe("closed");
    expect(dataRightsResponseDeadlineState(dataRightsCase({
      type: 1,
      requesterRelationship: 3,
      dueAtUtc: null,
    }), now)).toBe("not-applicable");
    expect(dataRightsResponseDeadlineState(dataRightsCase({
      type: 3,
      requesterRelationship: 1,
      dueAtUtc: null,
    }), now)).toBe("not-applicable");
  });

  it("labels the immutable controlling response right", () => {
    expect(dataRightsResponseDeadlineRightLabel(1)).toBe("Access and export");
    expect(dataRightsResponseDeadlineRightLabel(4)).toBe("Erasure");
  });

  it("formats safe operator labels without exposing coordinates", () => {
    expect(dataRightsCaseStatusLabel(3)).toBe("Review required");
    expect(dataRightsExportStatusLabel(3)).toBe("Available");
    expect(dataRightsRequestLabel(dataRightsCase({ requestedOperations: 1, type: 1 })))
      .toBe("Guest data export");
    expect(dataRightsRequestLabel(dataRightsCase({ requestedOperations: 1, type: 3 })))
      .toBe("Staff data export");
    expect(dataRightsRequestLabel(dataRightsCase({
      requestedOperations: DATA_RIGHTS_ANONYMISATION,
      type: 1,
    }))).toBe("Guest data removal");
    const applyRestriction = dataRightsCase({
      requestedOperations: DATA_RIGHTS_RESTRICTION,
      restrictionDirective: DATA_RIGHTS_RESTRICTION_APPLY,
    });
    const releaseRestriction = dataRightsCase({
      requestedOperations: DATA_RIGHTS_RESTRICTION,
      restrictionDirective: DATA_RIGHTS_RESTRICTION_RELEASE,
    });
    expect(dataRightsOperationKind(applyRestriction)).toBe("restriction-apply");
    expect(dataRightsRequestLabel(applyRestriction)).toBe("Limit guest data processing");
    expect(dataRightsOperationKind(releaseRestriction)).toBe("restriction-release");
    expect(dataRightsRequestLabel(releaseRestriction))
      .toBe("Release guest processing limit");
    expect(dataRightsRequesterLabel(1, "guest")).toBe("Requested by the guest");
    expect(dataRightsRequesterLabel(1, "staff"))
      .toBe("Requested by the staff member");
    expect(shortDataRightsCaseId("91234567-89ab-cdef-0123-456789abcdef")).toBe("91234567");
  });

  it("keeps tenant staff and property guest routes explicit", () => {
    expect(dataRightsScopeKey({ kind: "staff" })).toBe("staff");
    expect(dataRightsCasesPath({ kind: "staff" })).toBe("/api/data-rights/tenant/cases");
    expect(dataRightsScopeKey({ kind: "guest", propertyId: "property-1" }))
      .toBe("guest:property-1");
    expect(dataRightsCasesPath({ kind: "guest", propertyId: "property-1" }))
      .toBe("/api/data-rights/properties/property-1/cases");
  });
});

function dataRightsCase(overrides: Partial<DataRightsCase>): DataRightsCase {
  return {
    id: "91234567-89ab-cdef-0123-456789abcdef",
    propertyId: "property-1",
    type: 1,
    requestedOperations: 16,
    restrictionDirective: 0,
    requesterRelationship: 3,
    verificationStatus: 4,
    routingStatus: 3,
    status: 1,
    decision: 0,
    decisionReason: 0,
    decisionRevision: null,
    decidedAtUtc: null,
    executionRevision: null,
    executionStartedAtUtc: null,
    selectedSubjectCount: 0,
    dueAtUtc: null,
    version: 1,
    createdAtUtc: "2026-07-25T10:00:00Z",
    lastChangedAtUtc: "2026-07-25T10:00:00Z",
    approvalEvidence: null,
    responseDeadlineEvidence: null,
    restrictionTargetingContractVersion: null,
    restrictionReleaseTarget: null,
    restrictionExecutionProof: null,
    ...overrides,
  };
}
