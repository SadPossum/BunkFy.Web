import type {
  RetentionExecutionStatus,
  RetentionRunRetryStatus,
  RetentionScheduleHealth,
} from "../../api/types";

export type RetentionHealthSummary = {
  total: number;
  healthy: number;
  running: number;
  needsAttention: number;
};

export function retentionStatusLabel(status: RetentionExecutionStatus): string {
  return ({
    0: "unknown",
    1: "never run",
    2: "running",
    3: "completed",
    4: "blocked",
    5: "failed",
  } as Record<number, string>)[status] ?? "unknown";
}

export function retentionNeedsAttention(item: RetentionScheduleHealth): boolean {
  const status = retentionStatusLabel(item.status);
  return item.overdue || status === "unknown" || status === "never run" ||
    status === "blocked" || status === "failed";
}

export function retentionOutcomeGuidance(item: RetentionScheduleHealth): string | null {
  const status = retentionStatusLabel(item.status);
  if (status === "blocked") {
    return "Automatic cleanup is paused by a hold. Review the hold before changing the schedule.";
  }
  if (status === "failed") {
    if (item.outcomeCode === "retention.owner-timeout") {
      return "The retention owner did not finish in time. Retry after checking worker health.";
    }
    if (item.outcomeCode === "retention.owner-exception") {
      return "The retention owner stopped unexpectedly. Retry after checking the worker logs.";
    }
    return "The last cleanup attempt failed. Use the support code below when investigating.";
  }
  if (status === "never run") {
    return "No execution evidence exists yet. Check worker scheduling if this remains unchanged.";
  }
  if (status === "unknown") {
    return "The schedule has not reported a recognized execution state.";
  }
  if (item.overdue) {
    return "The next cleanup run is overdue. Check worker scheduling and queue health.";
  }
  return null;
}

export function retentionRetryStatusLabel(status: RetentionRunRetryStatus): string {
  return ({
    1: "queued",
    2: "accepted",
    3: "failed",
  } as Record<number, string>)[status] ?? "unknown";
}

export function retentionRetryFailureGuidance(failureCode: string | null): string {
  return ({
    "task-run-unavailable": "The original task run is no longer available to retry.",
    "task-run-state-changed": "The original task run changed before the retry could be applied.",
    "task-runtime-unavailable": "The task service is temporarily unavailable.",
    "task-run-concurrent-mutation": "Another task operation is already in progress.",
    "schedule-evidence-changed": "The schedule changed before the Worker could apply this retry.",
    "recovery-executor-unavailable": "The recovery service could not complete this request.",
  } as Record<string, string>)[failureCode ?? ""] ??
    "The retry could not be applied. Use the support code below when investigating.";
}

export function summarizeRetentionHealth(
  items: RetentionScheduleHealth[],
): RetentionHealthSummary {
  return items.reduce<RetentionHealthSummary>((summary, item) => {
    const status = retentionStatusLabel(item.status);
    summary.total += 1;
    if (retentionNeedsAttention(item)) summary.needsAttention += 1;
    else if (status === "running") summary.running += 1;
    else if (status === "completed") summary.healthy += 1;
    return summary;
  }, { total: 0, healthy: 0, running: 0, needsAttention: 0 });
}

export function humanizeRetentionKey(value: string): string {
  return value
    .replaceAll(".", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
