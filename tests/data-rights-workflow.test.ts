import { describe, expect, it } from "vitest";
import type { DataRightsCase } from "../src/api/types";
import {
  availableDataRightsActions,
  dataRightsCaseNeedsLiveRefresh,
  dataRightsCaseStatusLabel,
  dataRightsExecutionNeedsLiveRefresh,
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

  it("requires one selected reservation before review", () => {
    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      selectedSubjectCount: 0,
    }), allCapabilities)).toEqual(["discover-subject", "cancel"]);
    expect(availableDataRightsActions(dataRightsCase({
      status: 2,
      selectedSubjectCount: 1,
    }), allCapabilities)).toEqual(["discover-subject", "review", "cancel"]);
  });

  it("keeps approval and destructive execution as separate actions", () => {
    expect(availableDataRightsActions(dataRightsCase({ status: 4 }), allCapabilities))
      .toEqual(["approve", "deny", "cancel"]);
    expect(availableDataRightsActions(dataRightsCase({ status: 5 }), allCapabilities))
      .toEqual(["execute"]);
  });

  it("stops polling terminal case and work item states", () => {
    expect(dataRightsCaseNeedsLiveRefresh(7)).toBe(true);
    expect(dataRightsCaseNeedsLiveRefresh(9)).toBe(false);
    expect(dataRightsExecutionNeedsLiveRefresh(1)).toBe(true);
    expect(dataRightsExecutionNeedsLiveRefresh(2)).toBe(true);
    expect(dataRightsExecutionNeedsLiveRefresh(5)).toBe(false);
    expect(dataRightsExecutionNeedsLiveRefresh(6)).toBe(false);
  });

  it("formats safe operator labels without exposing coordinates", () => {
    expect(dataRightsCaseStatusLabel(3)).toBe("Review required");
    expect(shortDataRightsCaseId("91234567-89ab-cdef-0123-456789abcdef")).toBe("91234567");
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
