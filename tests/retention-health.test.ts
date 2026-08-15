import { describe, expect, it } from "vitest";
import type { RetentionScheduleHealth } from "../src/api/types";
import {
  humanizeRetentionKey,
  retentionNeedsAttention,
  retentionOutcomeGuidance,
  retentionRetryFailureGuidance,
  retentionRetryStatusLabel,
  retentionStatusLabel,
  summarizeRetentionHealth,
} from "../src/features/workspaces/retentionHealth";

function schedule(
  status: RetentionScheduleHealth["status"],
  overdue = false,
): RetentionScheduleHealth {
  return {
    ownerKey: "ingestion",
    dataClassKey: "raw-source-evidence",
    targetScopeKind: 1,
    propertyId: null,
    executionPolicyVersion: 1,
    evidenceVersion: 0,
    status,
    lastRunId: null,
    lastStartedAtUtc: null,
    lastCompletedAtUtc: null,
    nextDueAtUtc: "2026-07-27T12:00:00Z",
    overdue,
    consecutiveFailures: 0,
    lastScannedCount: null,
    lastAffectedCount: null,
    lastRemainingCount: null,
    outcomeCode: null,
    holdReviewDueAtUtc: null,
    retry: null,
  };
}

describe("retention health", () => {
  it("treats missing evidence, overdue, blocked and failed schedules as attention", () => {
    expect(retentionNeedsAttention(schedule(0))).toBe(true);
    expect(retentionNeedsAttention(schedule(1))).toBe(true);
    expect(retentionNeedsAttention(schedule(3, true))).toBe(true);
    expect(retentionNeedsAttention(schedule(4))).toBe(true);
    expect(retentionNeedsAttention(schedule(5))).toBe(true);
    expect(retentionNeedsAttention(schedule(3))).toBe(false);
  });

  it("summarizes operational states without counting never-run as healthy", () => {
    expect(summarizeRetentionHealth([
      schedule(3),
      schedule(2),
      schedule(1),
      schedule(5),
    ])).toEqual({
      total: 4,
      healthy: 1,
      running: 1,
      needsAttention: 2,
    });
  });

  it("maps stable codes to readable labels", () => {
    expect(retentionStatusLabel(4)).toBe("blocked");
    expect(humanizeRetentionKey("raw-source-evidence")).toBe("Raw Source Evidence");
  });

  it("keeps stable codes while providing operator guidance", () => {
    const failed = {
      ...schedule(5),
      outcomeCode: "retention.owner-timeout",
    };

    expect(retentionOutcomeGuidance(failed)).toContain("did not finish in time");
    expect(retentionRetryStatusLabel(2)).toBe("accepted");
    expect(retentionRetryFailureGuidance("task-run-state-changed"))
      .toContain("changed before the retry");
  });
});
