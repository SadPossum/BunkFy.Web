import type {
  RetentionRunRetryReceipt,
  RetentionScheduleHealth,
  RetentionTargetScopeKind,
  RetryRetentionScheduleRequest,
} from "../../api/types";

export type RetentionRetryIntent = {
  runId: string;
  ownerKey: string;
  dataClassKey: string;
  targetScopeKind: RetentionTargetScopeKind;
  propertyId: string | null;
  executionPolicyVersion: number;
  evidenceVersion: number;
  evidenceAtUtc: string | null;
};

export function createRetentionRetryIntent(
  schedule: RetentionScheduleHealth,
): RetentionRetryIntent | null {
  if (schedule.status !== 5 || !schedule.lastRunId) return null;

  return {
    runId: schedule.lastRunId,
    ownerKey: schedule.ownerKey,
    dataClassKey: schedule.dataClassKey,
    targetScopeKind: schedule.targetScopeKind,
    propertyId: schedule.propertyId,
    executionPolicyVersion: schedule.executionPolicyVersion,
    evidenceVersion: schedule.evidenceVersion,
    evidenceAtUtc: schedule.lastCompletedAtUtc ?? schedule.lastStartedAtUtc,
  };
}

export function createRetentionRetryRequest(
  intent: RetentionRetryIntent,
): RetryRetentionScheduleRequest {
  return {
    confirmed: true,
    ownerKey: intent.ownerKey,
    dataClassKey: intent.dataClassKey,
    targetScopeKind: intent.targetScopeKind,
    propertyId: intent.propertyId,
    executionPolicyVersion: intent.executionPolicyVersion,
    evidenceVersion: intent.evidenceVersion,
  };
}

export function isRetentionRetryIntentCurrent(
  intent: RetentionRetryIntent,
  schedule: RetentionScheduleHealth | undefined,
): boolean {
  return Boolean(
    schedule &&
    retentionRetryIntentMatchesSchedule(intent, schedule) &&
    schedule.status === 5 &&
    schedule.lastRunId === intent.runId &&
    schedule.evidenceVersion === intent.evidenceVersion &&
    (schedule.lastCompletedAtUtc ?? schedule.lastStartedAtUtc) === intent.evidenceAtUtc,
  );
}

export function retentionRetryIntentMatchesSchedule(
  intent: RetentionRetryIntent,
  schedule: RetentionScheduleHealth,
): boolean {
  return schedule.ownerKey === intent.ownerKey &&
    schedule.dataClassKey === intent.dataClassKey &&
    schedule.targetScopeKind === intent.targetScopeKind &&
    schedule.propertyId === intent.propertyId &&
    schedule.executionPolicyVersion === intent.executionPolicyVersion;
}

export function retentionRetryReceiptMatchesIntent(
  intent: RetentionRetryIntent,
  receipt: RetentionRunRetryReceipt,
): boolean {
  return receipt.runId === intent.runId &&
    receipt.evidenceVersion === intent.evidenceVersion;
}

export function retentionRetryIntentKey(intent: RetentionRetryIntent): string {
  return [
    intent.ownerKey,
    intent.dataClassKey,
    intent.propertyId ?? "tenant",
    intent.executionPolicyVersion,
    intent.runId,
    intent.evidenceVersion,
  ].join(":");
}
