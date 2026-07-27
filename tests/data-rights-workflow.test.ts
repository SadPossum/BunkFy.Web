import { describe, expect, it } from "vitest";
import type { DataRightsCase } from "../src/api/types";
import {
  availableDataRightsActions,
  dataRightsCaseNeedsLiveRefresh,
  dataRightsExportNeedsLiveRefresh,
  dataRightsExportStatusLabel,
  dataRightsRequestLabel,
  dataRightsRequesterLabel,
  dataRightsCaseStatusLabel,
  dataRightsExecutionBatchNeedsLiveRefresh,
  dataRightsExecutionNeedsLiveRefresh,
  dataRightsCasesPath,
  dataRightsScopeKey,
  shortDataRightsCaseId,
  type DataRightsCapabilities,
} from "../src/features/data-rights/dataRightsWorkflow";

const allCapabilities: DataRightsCapabilities = {
  read: true,
  create: true,
  discover: true,
  review: true,
  decide: true,
  manage: true,
  export: true,
  downloadExport: true,
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

  it("keeps approval and destructive execution as separate actions", () => {
    expect(availableDataRightsActions(dataRightsCase({ status: 4 }), allCapabilities))
      .toEqual(["approve", "deny", "cancel"]);
    expect(availableDataRightsActions(dataRightsCase({ status: 5 }), allCapabilities))
      .toEqual(["execute"]);
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

  it("formats safe operator labels without exposing coordinates", () => {
    expect(dataRightsCaseStatusLabel(3)).toBe("Review required");
    expect(dataRightsExportStatusLabel(3)).toBe("Available");
    expect(dataRightsRequestLabel(dataRightsCase({ requestedOperations: 1, type: 1 })))
      .toBe("Guest data export");
    expect(dataRightsRequestLabel(dataRightsCase({ requestedOperations: 1, type: 3 })))
      .toBe("Staff data export");
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
    ...overrides,
  };
}
