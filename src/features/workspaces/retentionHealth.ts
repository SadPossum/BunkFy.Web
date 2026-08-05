import type {
  RetentionExecutionStatus,
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
  return item.overdue || status === "blocked" || status === "failed";
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
