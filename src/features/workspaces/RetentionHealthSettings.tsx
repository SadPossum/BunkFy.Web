import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  PauseCircle,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type {
  RetentionScheduleHealth,
  RetentionScheduleHealthListResponse,
} from "../../api/types";
import { useSession } from "../../app/session";
import { PaginationBar } from "../../components/ui/PaginationBar";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from "../../components/ui/primitives";
import {
  humanizeRetentionKey,
  retentionNeedsAttention,
  retentionStatusLabel,
  summarizeRetentionHealth,
} from "./retentionHealth";

const RUNNING_REFRESH_MS = 10_000;
const IDLE_REFRESH_MS = 300_000;
const PAGE_SIZE = 25;

export function RetentionHealthSettings() {
  const { request } = useSession();
  const [page, setPage] = useState(1);
  const schedules = useQuery({
    queryKey: ["retention", "schedules", page],
    queryFn: () => request<RetentionScheduleHealthListResponse>(
      `/api/retention/schedules?page=${page}&pageSize=${PAGE_SIZE}`,
    ),
    refetchInterval: (query) => (query.state.data?.summary.running ?? 0) > 0
      ? RUNNING_REFRESH_MS
      : IDLE_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const items = schedules.data?.items ?? [];
  const summary = schedules.data?.summary ?? summarizeRetentionHealth(items);

  useEffect(() => {
    if (!schedules.isFetching && page > 1 && schedules.data?.items.length === 0) {
      setPage((currentPage) => Math.max(1, currentPage - 1));
    }
  }, [page, schedules.data?.items.length, schedules.isFetching]);

  return (
    <section>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <DatabaseZap size={20} />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold">Data retention</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-base-content/55">
            Monitor automatic cleanup and redaction without exposing retained data.
          </p>
        </div>
      </div>

      {schedules.isLoading && <LoadingState label="Loading retention health" />}
      {schedules.error && (
        <div className="mt-5">
          <ErrorState
            error={schedules.error}
            retry={() => void schedules.refetch()}
            title="Retention health is unavailable"
          />
        </div>
      )}
      {!schedules.isLoading && !schedules.error && items.length === 0 && (
        <div className="mt-5">
          <EmptyState
            icon={<Clock3 />}
            title="No schedules yet"
            description="Automatic schedules appear after the workspace scope is projected and a retention owner is registered."
          />
        </div>
      )}
      {!schedules.isLoading && !schedules.error && items.length > 0 && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <HealthMetric
              icon={<Activity size={18} />}
              label="Schedules"
              value={summary.total}
            />
            <HealthMetric
              icon={<CheckCircle2 size={18} />}
              label="Healthy"
              value={summary.healthy}
              tone="success"
            />
            <HealthMetric
              icon={<Clock3 size={18} />}
              label="Running"
              value={summary.running}
              tone="info"
            />
            <HealthMetric
              icon={<AlertTriangle size={18} />}
              label="Needs attention"
              value={summary.needsAttention}
              tone={summary.needsAttention > 0 ? "warning" : "neutral"}
            />
          </div>

          <div className="mt-6 border-y border-base-300">
            <div className="divide-y divide-base-300">
              {items.map((item) => (
                <ScheduleRow
                  key={[
                    item.ownerKey,
                    item.dataClassKey,
                    item.propertyId ?? "tenant",
                    item.executionPolicyVersion,
                  ].join(":")}
                  item={item}
                />
              ))}
            </div>
            <PaginationBar
              page={page}
              pageSize={PAGE_SIZE}
              itemCount={items.length}
              itemLabel="schedule"
              hasMore={schedules.data?.hasMore}
              disabled={schedules.isFetching}
              onPageChange={setPage}
            />
          </div>
        </>
      )}
    </section>
  );
}

function ScheduleRow({ item }: { item: RetentionScheduleHealth }) {
  const status = retentionStatusLabel(item.status);
  const attention = retentionNeedsAttention(item);
  const blocked = status === "blocked";
  return (
    <article className={`grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${attention ? "bg-warning/5 px-3" : ""}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg ${attention ? "bg-warning/15 text-warning-content" : "bg-primary/10 text-primary"}`}>
          {blocked ? <PauseCircle size={18} /> : attention ? <AlertTriangle size={18} /> : <DatabaseZap size={18} />}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">
              {humanizeRetentionKey(item.dataClassKey)}
            </h3>
            <StatusBadge status={item.overdue ? "overdue" : status} />
          </div>
          <p className="mt-1 text-xs text-base-content/50">
            {humanizeRetentionKey(item.ownerKey)} · policy v{item.executionPolicyVersion}
            {item.propertyId ? ` · property ${item.propertyId.slice(0, 8).toUpperCase()}` : " · workspace"}
          </p>
          {item.outcomeCode && (
            <p className="mt-2 font-mono text-xs text-base-content/55">
              {item.outcomeCode}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:min-w-80 sm:text-right">
        <ScheduleFact label="Next due" value={formatDateTime(item.nextDueAtUtc)} />
        <ScheduleFact
          label="Last completed"
          value={item.lastCompletedAtUtc ? formatDateTime(item.lastCompletedAtUtc) : "Never"}
        />
        <ScheduleFact
          label="Last affected"
          value={item.lastAffectedCount == null ? "Not run" : formatCount(item.lastAffectedCount)}
        />
        <ScheduleFact
          label={blocked ? "Hold review" : "Remaining"}
          value={blocked && item.holdReviewDueAtUtc
            ? formatDateTime(item.holdReviewDueAtUtc)
            : item.lastRemainingCount == null
              ? "Not run"
              : formatCount(item.lastRemainingCount)}
        />
      </div>
    </article>
  );
}

function HealthMetric({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "success" | "info" | "warning";
}) {
  const toneClass = {
    neutral: "bg-base-200 text-base-content/65",
    success: "bg-success/10 text-success",
    info: "bg-info/10 text-info-content",
    warning: "bg-warning/15 text-warning-content",
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-lg bg-base-200/55 p-4">
      <span className={`grid size-9 place-items-center rounded-lg ${toneClass}`}>
        {icon}
      </span>
      <div>
        <p className="text-2xl font-semibold leading-none">{value}</p>
        <p className="mt-1 text-xs text-base-content/50">{label}</p>
      </div>
    </div>
  );
}

function ScheduleFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-base-content/40">{label}</p>
      <p className="mt-0.5 font-medium text-base-content/75">{value}</p>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}
