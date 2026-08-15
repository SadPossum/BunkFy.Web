import { describe, expect, it } from "vitest";
import type { RetentionScheduleHealth } from "../src/api/types";
import {
  createRetentionRetryIntent,
  createRetentionRetryRequest,
  isRetentionRetryIntentCurrent,
  retentionRetryIntentKey,
} from "../src/features/workspaces/retentionRetryAttempt";

const runId = "f0379ccf-588e-40b6-a61e-13aa14f05a43";

function schedule(
  overrides: Partial<RetentionScheduleHealth> = {},
): RetentionScheduleHealth {
  return {
    ownerKey: "guests",
    dataClassKey: "guest-operational",
    targetScopeKind: 2,
    propertyId: "d7659ad6-f26b-42df-880c-57f338777bd8",
    executionPolicyVersion: 4,
    evidenceVersion: 12,
    status: 5,
    lastRunId: runId,
    lastStartedAtUtc: "2026-08-15T10:00:00Z",
    lastCompletedAtUtc: "2026-08-15T10:01:00Z",
    nextDueAtUtc: "2026-08-16T10:00:00Z",
    overdue: false,
    consecutiveFailures: 1,
    lastScannedCount: 14,
    lastAffectedCount: 0,
    lastRemainingCount: 14,
    outcomeCode: "retention.owner-timeout",
    holdReviewDueAtUtc: null,
    retry: null,
    ...overrides,
  };
}

describe("retention retry attempt", () => {
  it("captures the exact failed run and confirms a pinned request", () => {
    const intent = createRetentionRetryIntent(schedule());

    expect(intent).not.toBeNull();
    expect(intent).toMatchObject({
      runId,
      ownerKey: "guests",
      dataClassKey: "guest-operational",
      executionPolicyVersion: 4,
      evidenceVersion: 12,
      evidenceAtUtc: "2026-08-15T10:01:00Z",
    });
    expect(createRetentionRetryRequest(intent!)).toEqual({
      confirmed: true,
      ownerKey: "guests",
      dataClassKey: "guest-operational",
      targetScopeKind: 2,
      propertyId: "d7659ad6-f26b-42df-880c-57f338777bd8",
      executionPolicyVersion: 4,
      evidenceVersion: 12,
    });
  });

  it("does not offer recovery for a nonfailed or unbound run", () => {
    expect(createRetentionRetryIntent(schedule({ status: 3 }))).toBeNull();
    expect(createRetentionRetryIntent(schedule({ lastRunId: null }))).toBeNull();
  });

  it("detects changed evidence without rebuilding the captured intent", () => {
    const intent = createRetentionRetryIntent(schedule())!;

    expect(isRetentionRetryIntentCurrent(intent, schedule())).toBe(true);
    expect(isRetentionRetryIntentCurrent(
      intent,
      schedule({ evidenceVersion: 13 }),
    )).toBe(false);
    expect(isRetentionRetryIntentCurrent(
      intent,
      schedule({ lastRunId: "e39dcddb-ad1e-4240-9bfe-a7729c44fa25" }),
    )).toBe(false);
    expect(retentionRetryIntentKey(intent)).toContain(`${runId}:12`);
  });
});
