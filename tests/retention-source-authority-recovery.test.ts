import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  RetentionRunRetryReceipt,
  RetentionScheduleHealth,
} from "../src/api/types";
import { createRetentionRetryIntent } from "../src/features/workspaces/retentionRetryAttempt";
import {
  retentionOperatorScopeKey,
  retentionRetryAllowed,
  retentionRetryConvergencePending,
  retentionSchedulesQueryKey,
  retentionSchedulesQueryPrefix,
} from "../src/features/workspaces/retentionSourceAuthority";

const repositoryRoot = process.cwd();
const runId = "f0379ccf-588e-40b6-a61e-13aa14f05a43";
const requestId = "34d9740d-8d17-4ea8-9d56-4ec7ec5f204c";

function source(path: string): string {
  return readFileSync(join(repositoryRoot, "src", ...path.split("/")), "utf8")
    .replaceAll("\r\n", "\n");
}

describe("retention operator source authority recovery", () => {
  it("isolates cached health by normalized signed-in operator", () => {
    const operator = retentionOperatorScopeKey({
      tenantId: "workspace-a",
      username: "  Maya.Chen@Example.Test ",
    });

    expect(operator).toBe('["workspace-a","maya.chen@example.test"]');
    expect(retentionSchedulesQueryKey(operator, 3)).toEqual([
      "retention",
      "schedules",
      operator,
      3,
    ]);
    expect(retentionSchedulesQueryPrefix(operator)).toEqual([
      "retention",
      "schedules",
      operator,
    ]);
    expect(retentionOperatorScopeKey(null)).toBe("");
  });

  it("requires current permission, source, operator, and exact failed evidence", () => {
    const intent = createRetentionRetryIntent(schedule())!;
    const current = {
      activeOperatorScopeKey: "operator-a",
      candidateOperatorScopeKey: "operator-a",
      retryPermissionCurrent: true,
      scheduleSourceCurrent: true,
      intent,
      schedule: schedule(),
    };

    expect(retentionRetryAllowed(current)).toBe(true);
    expect(retentionRetryAllowed({
      ...current,
      candidateOperatorScopeKey: "operator-b",
    })).toBe(false);
    expect(retentionRetryAllowed({
      ...current,
      retryPermissionCurrent: false,
    })).toBe(false);
    expect(retentionRetryAllowed({
      ...current,
      scheduleSourceCurrent: false,
    })).toBe(false);
    expect(retentionRetryAllowed({
      ...current,
      schedule: schedule({ evidenceVersion: 13 }),
    })).toBe(false);
  });

  it("keeps queued and accepted recovery converging until schedule evidence advances", () => {
    const intent = createRetentionRetryIntent(schedule())!;

    for (const status of [1, 2] as const) {
      expect(retentionRetryConvergencePending({
        intent,
        requestId,
        schedules: [schedule({ retry: receipt(status) })],
        scheduleSourceCurrent: true,
      })).toBe(true);
    }

    expect(retentionRetryConvergencePending({
      intent,
      requestId,
      schedules: [schedule({ retry: receipt(3) })],
      scheduleSourceCurrent: true,
    })).toBe(false);
    expect(retentionRetryConvergencePending({
      intent,
      requestId,
      schedules: [schedule({ retry: receipt(2, "another-request") })],
      scheduleSourceCurrent: true,
    })).toBe(false);
    expect(retentionRetryConvergencePending({
      intent,
      requestId,
      schedules: [schedule({ status: 2, evidenceVersion: 13 })],
      scheduleSourceCurrent: true,
    })).toBe(false);
  });

  it("does not mistake an absent stale page for authoritative convergence", () => {
    const intent = createRetentionRetryIntent(schedule())!;

    expect(retentionRetryConvergencePending({
      intent,
      requestId,
      schedules: [],
      scheduleSourceCurrent: false,
    })).toBe(true);
    expect(retentionRetryConvergencePending({
      intent,
      requestId,
      schedules: [],
      scheduleSourceCurrent: true,
    })).toBe(false);
  });

  it("preserves stale inspection while fencing every retry continuation", () => {
    const settings = source("features/workspaces/RetentionHealthSettings.tsx");
    const modal = source("features/workspaces/RetentionRetryModal.tsx");
    const workspace = source("features/workspaces/WorkspaceSettingsPage.tsx");

    expect(settings).toContain("const scheduleSource = createCompositeSource({");
    expect(settings).toContain("const scheduleSourceUsable = compositeSourceUsable");
    expect(settings).toContain("retryPermissionCurrent && scheduleSourceCurrent");
    expect(settings).toContain("const authorityRef = useRef({");
    expect(settings).toContain("retentionRetryAllowed({");
    expect(settings).toContain("retentionRetryConvergencePending({");
    expect(settings).toContain("receipt.status === 1 || receipt.status === 2");
    expect(settings).toContain("item.retry?.status === 1 || item.retry?.status === 2");
    expect(settings).toContain('accepted ? "Retry accepted"');
    expect(settings).not.toContain('receipt.status === 2 ? "Retry completed"');
    expect(settings).toContain("disabled={!scheduleSourceCurrent}");
    expect(settings).not.toContain("{schedules.error &&");

    expect(modal).toContain("{needsAuthentication && current && (");
    expect(modal).toContain("Retry authority or schedule changed");
    expect(workspace).toContain("authorityCurrent={permissionAuthorityCurrent}");
    expect(workspace).toContain("onRefreshAuthority={refreshRetentionAuthority}");
    expect(workspace).toContain("key={`${workspace.organizationId}:${session?.username");
  });
});

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

function receipt(
  status: RetentionRunRetryReceipt["status"],
  id = requestId,
): RetentionRunRetryReceipt {
  return {
    requestId: id,
    runId,
    evidenceVersion: 12,
    attempt: 1,
    status,
    requestedAtUtc: "2026-08-15T10:02:00Z",
    scheduledAtUtc: status === 1 ? null : "2026-08-15T10:02:01Z",
    completedAtUtc: status === 3 ? "2026-08-15T10:02:02Z" : null,
    failureCode: status === 3 ? "task-run-state-changed" : null,
  };
}
