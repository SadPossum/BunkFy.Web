import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  PauseCircle,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  RetentionRunRetryReceipt,
  RetentionScheduleHealth,
  RetentionScheduleHealthListResponse,
} from "../../api/types";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
} from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { PaginationBar } from "../../components/ui/PaginationBar";
import {
  EmptyState,
  LoadingState,
  StatusBadge,
} from "../../components/ui/primitives";
import {
  humanizeRetentionKey,
  retentionNeedsAttention,
  retentionOutcomeGuidance,
  retentionRetryFailureGuidance,
  retentionRetryStatusLabel,
  retentionStatusLabel,
  summarizeRetentionHealth,
} from "./retentionHealth";
import { RetentionRetryModal } from "./RetentionRetryModal";
import {
  createRetentionRetryIntent,
  createRetentionRetryRequest,
  isRetentionRetryIntentCurrent,
  retentionRetryIntentKey,
  retentionRetryReceiptMatchesIntent,
  type RetentionRetryIntent,
} from "./retentionRetryAttempt";
import {
  retentionOperatorScopeKey,
  retentionRetryAllowed,
  retentionRetryConvergencePending,
  retentionSchedulesQueryKey,
  retentionSchedulesQueryPrefix,
  retentionSourceChangedError,
} from "./retentionSourceAuthority";

const CONVERGENCE_REFRESH_MS = 2_000;
const CONVERGENCE_WINDOW_MS = 30_000;
const RUNNING_REFRESH_MS = 10_000;
const IDLE_REFRESH_MS = 300_000;
const PAGE_SIZE = 25;

type RetryConvergence = {
  requestId: string;
  intent: RetentionRetryIntent;
  until: number;
};

type RetrySubmission = {
  intent: RetentionRetryIntent;
  operatorScopeKey: string;
  page: number;
};

export function RetentionHealthSettings({
  canRetry,
  authorityCurrent,
  onRefreshAuthority,
}: {
  canRetry: boolean;
  authorityCurrent: boolean;
  onRefreshAuthority: () => Promise<unknown>;
}) {
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [retryIntent, setRetryIntent] = useState<RetentionRetryIntent | null>(null);
  const [convergence, setConvergence] = useState<RetryConvergence | null>(null);
  const operatorScopeKey = retentionOperatorScopeKey(session);
  const queryKey = retentionSchedulesQueryKey(operatorScopeKey, page);
  const schedules = useQuery({
    queryKey,
    queryFn: () => request<RetentionScheduleHealthListResponse>(
      `/api/retention/schedules?page=${page}&pageSize=${PAGE_SIZE}`,
    ),
    refetchInterval: (query) => {
      if (convergence && convergence.until > Date.now()) return CONVERGENCE_REFRESH_MS;

      const data = query.state.data;
      const retryPending = data?.items.some((item) =>
        item.retry?.status === 1 || item.retry?.status === 2) ?? false;
      return (data?.summary.running ?? 0) > 0 || retryPending
        ? RUNNING_REFRESH_MS
        : IDLE_REFRESH_MS;
    },
    refetchIntervalInBackground: false,
    enabled: Boolean(operatorScopeKey),
  });
  const scheduleSource = createCompositeSource({
    label: "Retention schedule health",
    hasData: schedules.data !== undefined,
    isLoading: schedules.isLoading,
    error: schedules.error,
    isFetching: schedules.isFetching,
    refetch: () => schedules.refetch(),
  });
  const scheduleSourceCurrent = compositeSourceCurrent(scheduleSource);
  const scheduleSourceUsable = compositeSourceUsable(scheduleSource.state);
  const response = scheduleSourceUsable ? schedules.data : undefined;
  const items = useMemo(() => response?.items ?? [], [response?.items]);
  const summary = response?.summary ?? summarizeRetentionHealth(items);
  const retryPermissionCurrent = canRetry && authorityCurrent;
  const authorityRef = useRef({
    operatorScopeKey,
    page,
    retryPermissionCurrent,
    scheduleSourceCurrent,
    items,
    retryIntent,
  });
  authorityRef.current = {
    operatorScopeKey,
    page,
    retryPermissionCurrent,
    scheduleSourceCurrent,
    items,
    retryIntent,
  };
  const retry = useMutation({
    mutationFn: (submission: RetrySubmission) => {
      const current = authorityRef.current;
      const schedule = current.items.find((item) =>
        isRetentionRetryIntentCurrent(submission.intent, item));
      if (current.page !== submission.page || !retentionRetryAllowed({
        activeOperatorScopeKey: current.operatorScopeKey,
        candidateOperatorScopeKey: submission.operatorScopeKey,
        retryPermissionCurrent: current.retryPermissionCurrent,
        scheduleSourceCurrent: current.scheduleSourceCurrent,
        intent: submission.intent,
        schedule,
      })) {
        throw retentionSourceChangedError();
      }
      return request<RetentionRunRetryReceipt>(
        `/api/retention/runs/${submission.intent.runId}/retry`,
        {
          method: "POST",
          body: JSON.stringify(createRetentionRetryRequest(submission.intent)),
        },
      );
    },
    onSuccess: (receipt, submission) => {
      const current = authorityRef.current;
      const schedule = current.items.find((item) =>
        isRetentionRetryIntentCurrent(submission.intent, item));
      if (!retentionRetryReceiptMatchesIntent(submission.intent, receipt) ||
        current.page !== submission.page || !retentionRetryAllowed({
          activeOperatorScopeKey: current.operatorScopeKey,
          candidateOperatorScopeKey: submission.operatorScopeKey,
          retryPermissionCurrent: current.retryPermissionCurrent,
          scheduleSourceCurrent: current.scheduleSourceCurrent,
          intent: submission.intent,
          schedule,
        })) {
        void queryClient.invalidateQueries({
          queryKey: retentionSchedulesQueryPrefix(submission.operatorScopeKey),
        });
        return;
      }
      const submittedQueryKey = retentionSchedulesQueryKey(
        submission.operatorScopeKey,
        submission.page,
      );
      queryClient.setQueryData<RetentionScheduleHealthListResponse>(submittedQueryKey, (cached) =>
        cached
          ? {
            ...cached,
            items: cached.items.map((item) =>
              isRetentionRetryIntentCurrent(submission.intent, item)
                ? { ...item, retry: receipt }
                : item),
          }
          : cached,
      );
      if (current.retryIntent && retentionRetryIntentKey(current.retryIntent) ===
        retentionRetryIntentKey(submission.intent)) {
        setRetryIntent(null);
      }
      setConvergence(receipt.status === 1 || receipt.status === 2
        ? {
          requestId: receipt.requestId,
          intent: submission.intent,
          until: Date.now() + CONVERGENCE_WINDOW_MS,
        }
        : null);
    },
    onSettled: async (_data, _error, submission) => {
      await queryClient.invalidateQueries({
        queryKey: retentionSchedulesQueryKey(
          submission.operatorScopeKey,
          submission.page,
        ),
      });
    },
  });
  const currentRetrySchedule = retryIntent
    ? items.find((item) => isRetentionRetryIntentCurrent(retryIntent, item))
    : undefined;
  const retryIntentCurrent = Boolean(
    retryIntent && currentRetrySchedule &&
    retentionRetryAllowed({
      activeOperatorScopeKey: operatorScopeKey,
      candidateOperatorScopeKey: operatorScopeKey,
      retryPermissionCurrent,
      scheduleSourceCurrent,
      intent: retryIntent,
      schedule: currentRetrySchedule,
    }),
  );
  const activeRetryKey = retryIntent ? retentionRetryIntentKey(retryIntent) : null;
  const submittedRetryKey = retry.variables
    ? retentionRetryIntentKey(retry.variables.intent)
    : null;
  const retryStateCurrent = activeRetryKey !== null && activeRetryKey === submittedRetryKey;

  useEffect(() => {
    setPage(1);
    setRetryIntent(null);
    setConvergence(null);
  }, [operatorScopeKey]);

  useEffect(() => {
    if (scheduleSourceCurrent && page > 1 && items.length === 0) {
      setRetryIntent(null);
      setConvergence(null);
      setPage((currentPage) => Math.max(1, currentPage - 1));
    }
  }, [items.length, page, scheduleSourceCurrent]);

  useEffect(() => {
    if (!convergence) return;

    if (!retentionRetryConvergencePending({
      intent: convergence.intent,
      requestId: convergence.requestId,
      schedules: items,
      scheduleSourceCurrent,
    })) {
      setConvergence(null);
      return;
    }

    const timeout = window.setTimeout(
      () => setConvergence((current) =>
        current?.requestId === convergence.requestId ? null : current),
      Math.max(0, convergence.until - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [convergence, items, scheduleSourceCurrent]);

  function closeRetry() {
    setRetryIntent(null);
    retry.reset();
  }

  function refreshRetryEvidence() {
    retry.reset();
    void Promise.allSettled([
      schedules.refetch(),
      onRefreshAuthority(),
    ]);
  }

  function changePage(nextPage: number) {
    setRetryIntent(null);
    setConvergence(null);
    retry.reset();
    setPage(nextPage);
  }

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

      <CompositeSourceNotice
        className="mt-5"
        sources={[scheduleSource]}
        title="Retention health is delayed"
      />
      {scheduleSource.state === "loading" && (
        <LoadingState label="Loading retention health" />
      )}
      {scheduleSource.state !== "loading" && !scheduleSourceUsable && (
        <CompositeSourceFallback
          state={scheduleSource.state}
          label="retention health"
        />
      )}
      {scheduleSourceUsable && items.length === 0 && !scheduleSourceCurrent && (
        scheduleSource.state === "ready" && schedules.isFetching
          ? <LoadingState label="Refreshing retention health" />
          : (
            <CompositeSourceFallback
              state={scheduleSource.state}
              label="current retention health"
            />
          )
      )}
      {scheduleSourceUsable && items.length === 0 && scheduleSourceCurrent && (
        <div className="mt-5">
          <EmptyState
            icon={<Clock3 />}
            title="No schedules yet"
            description="Automatic schedules appear after the workspace scope is projected and a retention owner is registered."
          />
        </div>
      )}
      {scheduleSourceUsable && items.length > 0 && (
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
                  key={scheduleKey(item)}
                  item={item}
                  canRetry={retryPermissionCurrent && scheduleSourceCurrent}
                  retryMutationPending={retry.isPending}
                  onRetry={(intent) => {
                    retry.reset();
                    setRetryIntent(intent);
                  }}
                />
              ))}
            </div>
            <PaginationBar
              page={page}
              pageSize={PAGE_SIZE}
              itemCount={items.length}
              itemLabel="schedule"
              hasMore={response?.hasMore}
              disabled={!scheduleSourceCurrent}
              onPageChange={changePage}
            />
          </div>
        </>
      )}

      <RetentionRetryModal
        intent={retryIntent}
        current={retryIntentCurrent}
        error={retryStateCurrent ? retry.error : null}
        submitting={retryStateCurrent && retry.isPending}
        onClose={closeRetry}
        onConfirm={(intent) => retry.mutate({ intent, operatorScopeKey, page })}
        onRefresh={refreshRetryEvidence}
      />
    </section>
  );
}

function ScheduleRow({
  item,
  canRetry,
  retryMutationPending,
  onRetry,
}: {
  item: RetentionScheduleHealth;
  canRetry: boolean;
  retryMutationPending: boolean;
  onRetry: (intent: RetentionRetryIntent) => void;
}) {
  const status = retentionStatusLabel(item.status);
  const attention = retentionNeedsAttention(item);
  const blocked = status === "blocked";
  const guidance = retentionOutcomeGuidance(item);
  const intent = createRetentionRetryIntent(item);
  const retryInFlight = item.retry?.status === 1 || item.retry?.status === 2;
  const retryAvailable = canRetry && intent && !retryInFlight && !retryMutationPending;

  return (
    <article className={`grid gap-5 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] sm:items-start ${attention ? "bg-warning/5 px-3" : ""}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg ${attention ? "bg-warning/15 text-warning-content" : "bg-primary/10 text-primary"}`}>
          {blocked ? <PauseCircle size={18} /> : attention ? <AlertTriangle size={18} /> : <DatabaseZap size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">
              {humanizeRetentionKey(item.dataClassKey)}
            </h3>
            <StatusBadge status={item.overdue ? "overdue" : status} />
          </div>
          <p className="mt-1 text-xs text-base-content/50">
            {humanizeRetentionKey(item.ownerKey)} · policy v{item.executionPolicyVersion}
            {item.propertyId ? ` · property ${shortReference(item.propertyId)}` : " · workspace"}
          </p>
          {guidance && (
            <p className="mt-2 max-w-2xl text-sm leading-5 text-base-content/65">
              {guidance}
            </p>
          )}
          {item.outcomeCode && (
            <p className="mt-1.5 font-mono text-xs text-base-content/45">
              Support code: {item.outcomeCode}
            </p>
          )}
          {item.retry && <RetryState receipt={item.retry} />}
        </div>
      </div>

      <div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-xs sm:text-right">
          <ScheduleFact label="Next due" value={formatDateTime(item.nextDueAtUtc)} />
          <ScheduleFact
            label={`Evidence v${item.evidenceVersion}`}
            value={item.lastCompletedAtUtc
              ? formatDateTime(item.lastCompletedAtUtc)
              : item.lastStartedAtUtc
                ? formatDateTime(item.lastStartedAtUtc)
                : "Not recorded"}
          />
          <ScheduleFact
            label="Last run"
            value={item.lastRunId ? shortReference(item.lastRunId) : "Not run"}
            mono={Boolean(item.lastRunId)}
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
          <ScheduleFact
            label="Failures"
            value={formatCount(item.consecutiveFailures)}
          />
        </div>
        {retryAvailable && (
          <div className="mt-4 flex justify-end border-t border-base-300 pt-3">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => onRetry(intent)}
            >
              <RotateCcw size={15} />
              {item.retry?.status === 3 ? "Retry again" : "Retry run"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function RetryState({ receipt }: { receipt: RetentionRunRetryReceipt }) {
  const status = retentionRetryStatusLabel(receipt.status);
  const queued = receipt.status === 1;
  const accepted = receipt.status === 2;
  const failed = receipt.status === 3;
  return (
    <div
      className={`mt-3 flex max-w-2xl items-start gap-2 rounded-lg border px-3 py-2.5 ${
        failed
          ? "border-error/20 bg-error/5"
          : "border-info/20 bg-info/5"
      }`}
      role="status"
    >
      {failed
        ? <AlertTriangle className="mt-0.5 shrink-0 text-error" size={16} />
        : <Clock3 className="mt-0.5 shrink-0 text-info" size={16} />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold">
            {queued ? "Retry queued" : accepted ? "Retry accepted" : "Retry failed"}
          </p>
          <StatusBadge status={status} />
          {receipt.attempt > 1 && (
            <span className="text-xs text-base-content/45">Attempt {receipt.attempt}</span>
          )}
        </div>
        <p className="mt-1 text-xs leading-5 text-base-content/60">
          {queued
            ? "The worker will apply this request without blocking the page."
            : failed
              ? retentionRetryFailureGuidance(receipt.failureCode)
              : "The task service accepted the retry. Retention work is still in progress until schedule evidence advances."}
        </p>
        {receipt.failureCode && (
          <p className="mt-1 font-mono text-xs text-base-content/45">
            Support code: {receipt.failureCode}
          </p>
        )}
      </div>
    </div>
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

function ScheduleFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-base-content/40">{label}</p>
      <p className={`mt-0.5 text-base-content/75 ${mono ? "font-mono" : "font-medium"}`}>
        {value}
      </p>
    </div>
  );
}

function scheduleKey(item: RetentionScheduleHealth): string {
  return [
    item.ownerKey,
    item.dataClassKey,
    item.propertyId ?? "tenant",
    item.executionPolicyVersion,
  ].join(":");
}

function shortReference(value: string): string {
  return value.slice(0, 8).toUpperCase();
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
