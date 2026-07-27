import { describe, expect, it } from "vitest";
import type { RetentionScheduleHealth } from "../src/api/types";
import {
  humanizeRetentionKey,
  retentionNeedsAttention,
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
    status,
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
  };
}

describe("retention health", () => {
  it("treats overdue, blocked and failed schedules as attention", () => {
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
      attention: 1,
    });
  });

  it("maps stable codes to readable labels", () => {
    expect(retentionStatusLabel(4)).toBe("blocked");
    expect(humanizeRetentionKey("raw-source-evidence")).toBe("Raw Source Evidence");
  });
});
