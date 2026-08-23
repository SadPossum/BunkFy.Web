import type { ApiSession } from "../../api/client";
import type { RetentionScheduleHealth } from "../../api/types";
import {
  isRetentionRetryIntentCurrent,
  retentionRetryIntentMatchesSchedule,
  type RetentionRetryIntent,
} from "./retentionRetryAttempt";

export type RetentionRetryAuthorityEvidence = {
  activeOperatorScopeKey: string;
  candidateOperatorScopeKey: string;
  retryPermissionCurrent: boolean;
  scheduleSourceCurrent: boolean;
  intent: RetentionRetryIntent;
  schedule: RetentionScheduleHealth | undefined;
};

export function retentionOperatorScopeKey(
  session: Pick<ApiSession, "tenantId" | "username"> | null | undefined,
): string {
  if (!session?.tenantId || !session.username.trim()) return "";
  return JSON.stringify([
    session.tenantId,
    session.username.trim().toLowerCase(),
  ]);
}

export function retentionSchedulesQueryKey(
  operatorScopeKey: string,
  page: number,
) {
  return ["retention", "schedules", operatorScopeKey, page] as const;
}

export function retentionSchedulesQueryPrefix(operatorScopeKey: string) {
  return ["retention", "schedules", operatorScopeKey] as const;
}

export function retentionRetryAllowed(
  evidence: RetentionRetryAuthorityEvidence,
): boolean {
  return Boolean(
    evidence.activeOperatorScopeKey &&
      evidence.activeOperatorScopeKey === evidence.candidateOperatorScopeKey &&
      evidence.retryPermissionCurrent &&
      evidence.scheduleSourceCurrent &&
      isRetentionRetryIntentCurrent(evidence.intent, evidence.schedule),
  );
}

export function retentionRetryConvergencePending({
  intent,
  requestId,
  schedules,
  scheduleSourceCurrent,
}: {
  intent: RetentionRetryIntent;
  requestId: string;
  schedules: RetentionScheduleHealth[];
  scheduleSourceCurrent: boolean;
}): boolean {
  const schedule = schedules.find((item) =>
    retentionRetryIntentMatchesSchedule(intent, item));
  if (!schedule) return !scheduleSourceCurrent;

  const receipt = schedule.retry;
  if (receipt && receipt.requestId !== requestId) return false;
  if (receipt?.requestId === requestId && receipt.status === 3) return false;
  return isRetentionRetryIntentCurrent(intent, schedule);
}

export function retentionSourceChangedError(): Error {
  return new Error(
    "The retention schedule or workspace authority changed. Refresh current health before retrying.",
  );
}
