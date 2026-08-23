import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  CheckCheck,
  CircleAlert,
  Info,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { notificationAudienceLabel, notificationSeverityLabel } from "../../api/labels";
import type {
  MarkAllNotificationsReadResponse,
  NotificationBroadcastItem,
  NotificationBroadcastListResponse,
  NotificationHistoryItem,
  NotificationHistoryListResponse,
  NotificationSeverity,
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
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
} from "../../components/ui/primitives";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { notificationDestination } from "./notificationDestination";
import {
  captureNotificationAttention,
  dismissNotificationAttention,
  notificationAttentionKey,
} from "./notificationAttentionState";
import {
  decrementNotificationUnreadCountLocally,
  markNotificationReadLocally,
  notificationItemId,
  type NotificationInboxItem,
  type NotificationInboxResponse,
} from "./notificationReadState";
import {
  notificationDetailQueryKey,
  notificationInboxPath,
  notificationInboxQueryKey,
  notificationItemMatches,
  notificationListQueryKey,
  notificationListQueryPrefix,
  notificationReadAllowed,
  notificationScopeKey,
  notificationSummaryQueryKey,
  type NotificationInboxKind,
} from "./notificationSourceAuthority";

const PAGE_SIZE = 25;
type InboxTab = "personal" | "broadcasts";

type NotificationReadCandidate = {
  scopeKey: string;
  kind: NotificationInboxKind;
  item: NotificationInboxItem;
  sourceCurrent: boolean;
};

type MarkAllSubmission = {
  scopeKey: string;
  kind: NotificationInboxKind;
};

export function NotificationsPage() {
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<InboxTab>("personal");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [attentionIds, setAttentionIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingReadIds = useRef(new Set<string>());
  const scopeKey = notificationScopeKey(session);
  const previousScopeKeyRef = useRef(scopeKey);
  const selectedPersonalId = searchParams.get("notification");
  const selectedBroadcastId = selectedPersonalId
    ? null
    : searchParams.get("broadcast");
  const kind: NotificationInboxKind = tab === "personal" ? "history" : "broadcasts";
  const path = notificationInboxPath(kind);
  const query = useQuery({
    queryKey: notificationListQueryKey(scopeKey, kind, page, unreadOnly),
    queryFn: () => request<NotificationHistoryListResponse | NotificationBroadcastListResponse>(
      `${path}?page=${page}&pageSize=${PAGE_SIZE}&unreadOnly=${unreadOnly}`,
    ),
    enabled: Boolean(scopeKey),
  });
  const listSource = createCompositeSource({
    label: tab === "personal" ? "Personal notifications" : "Announcements",
    hasData: query.data !== undefined,
    isLoading: query.isLoading,
    error: query.error,
    isFetching: query.isFetching,
    refetch: () => query.refetch(),
  });
  const listCurrent = compositeSourceCurrent(listSource);
  const listUsable = compositeSourceUsable(listSource.state);
  const items = listUsable ? query.data?.items ?? [] : [];

  const markAll = useMutation<MarkAllNotificationsReadResponse, Error, MarkAllSubmission>({
    mutationFn: ({ scopeKey: targetScopeKey, kind: targetKind }) => {
      const authorityCurrent = targetKind === kind &&
        notificationReadAllowed(scopeKey, targetScopeKey, listCurrent);
      if (!authorityCurrent) {
        throw new Error("Current notification inbox evidence could not be confirmed. Refresh and try again.");
      }
      return request<MarkAllNotificationsReadResponse>(
        `${notificationInboxPath(targetKind)}/read-all`,
        { method: "POST" },
      );
    },
    onSuccess: async (_response, submission) => {
      await queryClient.invalidateQueries({
        queryKey: notificationInboxQueryKey(submission.scopeKey, submission.kind),
      });
    },
    onError: async (_error, submission) => {
      await queryClient.invalidateQueries({
        queryKey: notificationInboxQueryKey(submission.scopeKey, submission.kind),
      });
    },
  });

  const acknowledgeVisible = useCallback((candidate: NotificationReadCandidate) => {
    if (candidate.item.readAtUtc || !notificationReadAllowed(
      scopeKey,
      candidate.scopeKey,
      candidate.sourceCurrent,
    )) return;

    const id = notificationItemId(candidate.item);
    const token = `${candidate.scopeKey}:${candidate.kind}:${id}`;
    const readAtUtc = new Date().toISOString();
    const updateResponse = (current: NotificationInboxResponse | undefined) =>
      markNotificationReadLocally(current, id, readAtUtc);

    queryClient.setQueriesData<NotificationInboxResponse>(
      { queryKey: notificationListQueryPrefix(candidate.scopeKey, candidate.kind) },
      updateResponse,
    );
    queryClient.setQueryData<NotificationInboxItem>(
      notificationDetailQueryKey(candidate.scopeKey, candidate.kind, id),
      (current) => current && !current.readAtUtc ? { ...current, readAtUtc } : current,
    );

    if (pendingReadIds.current.has(token)) return;
    pendingReadIds.current.add(token);
    queryClient.setQueryData<NotificationInboxResponse>(
      notificationSummaryQueryKey(candidate.scopeKey, candidate.kind),
      (current) => decrementNotificationUnreadCountLocally(current, id, readAtUtc),
    );
    void request<void>(`${notificationInboxPath(candidate.kind)}/${id}/read`, { method: "POST" })
      .then(() => pendingReadIds.current.delete(token))
      .catch(() => {
        pendingReadIds.current.delete(token);
        void queryClient.invalidateQueries({
          queryKey: notificationInboxQueryKey(candidate.scopeKey, candidate.kind),
        });
      });
  }, [queryClient, request, scopeKey]);

  const acknowledgeVisibleInList = useCallback((item: NotificationInboxItem) => {
    acknowledgeVisible({
      scopeKey,
      kind,
      item,
      sourceCurrent: listCurrent && notificationItemMatches(items, item),
    });
  }, [acknowledgeVisible, items, kind, listCurrent, scopeKey]);

  useEffect(() => setPage(1), [tab, unreadOnly]);
  useEffect(() => setAttentionIds(new Set()), [scopeKey]);

  useEffect(() => {
    if (selectedPersonalId) setTab("personal");
    else if (selectedBroadcastId) setTab("broadcasts");
  }, [selectedBroadcastId, selectedPersonalId]);

  useEffect(() => {
    const previousScopeKey = previousScopeKeyRef.current;
    if (scopeKey) previousScopeKeyRef.current = scopeKey;
    if (!previousScopeKey || !scopeKey || previousScopeKey === scopeKey) return;

    setTab("personal");
    setUnreadOnly(false);
    setPage(1);
    setAttentionIds(new Set());
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("notification");
      next.delete("broadcast");
      return next;
    }, { replace: true });
  }, [scopeKey, setSearchParams]);

  useEffect(() => {
    if (listCurrent && query.data && page > 1 && query.data.items.length === 0) {
      setPage((current) => Math.max(1, current - 1));
    }
  }, [listCurrent, page, query.data]);

  function select(item: NotificationInboxItem | null) {
    const next = new URLSearchParams(searchParams);
    next.delete("notification");
    next.delete("broadcast");
    if (item) next.set(tab === "personal" ? "notification" : "broadcast", notificationItemId(item));
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    if (!listCurrent) return;
    setAttentionIds((current) => captureNotificationAttention(current, kind, items));
  }, [items, kind, listCurrent]);

  useEffect(() => {
    const key = selectedPersonalId
      ? notificationAttentionKey("history", selectedPersonalId)
      : selectedBroadcastId
        ? notificationAttentionKey("broadcasts", selectedBroadcastId)
        : null;
    if (key) setAttentionIds((current) => dismissNotificationAttention(current, key));
  }, [selectedBroadcastId, selectedPersonalId]);

  function open(item: NotificationInboxItem) {
    const key = notificationAttentionKey(kind, notificationItemId(item));
    setAttentionIds((current) => dismissNotificationAttention(current, key));
    select(item);
  }

  const markAllTargetsCurrentInbox = markAll.variables?.scopeKey === scopeKey &&
    markAll.variables.kind === kind;
  const markAllPending = markAll.isPending && markAllTargetsCurrentInbox;
  const markAllError = markAllTargetsCurrentInbox
    ? markAll.error
    : null;

  return <>
    <PageHeader
      eyebrow="Live workspace"
      title="Notifications"
      description="Stay on top of operational events and workspace announcements."
      action={listUsable && (query.data?.unreadCount ?? 0) > 0 ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => markAll.mutate({ scopeKey, kind })}
          disabled={markAllPending || !listCurrent}
        >
          <CheckCheck size={17} />
          Mark all read
        </button>
      ) : undefined}
    />
    <CompositeSourceNotice
      sources={[listSource]}
      title="Notification inbox is delayed"
    />
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-base-300 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <SegmentedTabs
          value={tab}
          ariaLabel="Notification inbox"
          onValueChange={setTab}
          options={[
            { value: "personal", label: "For you", icon: <Bell size={15} /> },
            { value: "broadcasts", label: "Announcements", icon: <Megaphone size={15} /> },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          {listUsable && (
            <span className="text-xs font-medium text-base-content/45">
              {query.data?.unreadCount ?? 0} unread
            </span>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              className="toggle toggle-primary toggle-sm"
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
            />
            Unread only
          </label>
        </div>
      </div>
      {listSource.state === "loading" ? (
        <LoadingState label="Loading notifications" />
      ) : !listUsable ? (
        <CompositeSourceFallback state={listSource.state} label="notification inbox" />
      ) : !items.length ? (
        <div className="p-6">
          <EmptyState
            icon={tab === "personal" ? <Bell /> : <Megaphone />}
            title={unreadOnly ? "You're all caught up" : tab === "personal" ? "No notifications yet" : "No announcements yet"}
            description={unreadOnly ? "There are no unread items in this inbox." : "New operational messages will appear here automatically."}
          />
        </div>
      ) : <>
        <div className="divide-y divide-base-300">
          {items.map((item) => (
            <NotificationRow
              key={notificationItemId(item)}
              item={item}
              attention={attentionIds.has(notificationAttentionKey(kind, notificationItemId(item)))}
              onOpen={() => open(item)}
              onVisible={acknowledgeVisibleInList}
            />
          ))}
        </div>
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          itemCount={items.length}
          itemLabel={tab === "personal" ? "notification" : "announcement"}
          totalCount={query.data?.totalCount}
          disabled={!listCurrent}
          onPageChange={setPage}
        />
      </>}
      {markAllError && (
        <div className="border-t border-base-300 p-4"><ErrorState error={markAllError} /></div>
      )}
    </section>
    <NotificationDetail
      kind="personal"
      scopeKey={scopeKey}
      id={selectedPersonalId}
      onClose={() => select(null)}
      onVisible={acknowledgeVisible}
    />
    <NotificationDetail
      kind="broadcast"
      scopeKey={scopeKey}
      id={selectedBroadcastId}
      onClose={() => select(null)}
      onVisible={acknowledgeVisible}
    />
  </>;
}

function NotificationRow({ item, attention, onOpen, onVisible }: {
  item: NotificationInboxItem;
  attention: boolean;
  onOpen: () => void;
  onVisible: (item: NotificationInboxItem) => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const unread = !item.readAtUtc;
  const destination = notificationDestination(item);

  useEffect(() => {
    const row = rowRef.current;
    if (!unread || !row) return;
    if (typeof IntersectionObserver === "undefined") {
      onVisible(item);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.6)) return;
      observer.disconnect();
      onVisible(item);
    }, { threshold: 0.6 });
    observer.observe(row);
    return () => observer.disconnect();
  }, [item, onVisible, unread]);

  return (
    <button
      ref={rowRef}
      type="button"
      className={`grid w-full gap-3 border-l-4 p-5 text-left transition sm:grid-cols-[auto_1fr_auto] sm:items-center sm:px-6 ${attention ? "notification-attention" : unread ? "border-transparent bg-primary/[0.035] hover:bg-base-200/70" : "border-transparent hover:bg-base-200/70"}`}
      onClick={onOpen}
    >
      <SeverityIcon severity={item.severity} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className={`truncate ${unread || attention ? "font-bold" : "font-semibold"}`}>{item.title}</p>
          {attention ? (
            <span className="badge badge-primary h-5 shrink-0 px-2 text-[0.68rem] font-bold">New</span>
          ) : unread ? (
            <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-base-content/55">{item.body || humanize(item.name)}</p>
        <p className="mt-1 text-xs text-base-content/40">
          {destination ? `${destination.resourceLabel} · ` : ""}{humanize(item.module)} · {formatRelative(item.occurredAtUtc)}
        </p>
      </div>
      <NotificationSeverityBadge severity={item.severity} />
    </button>
  );
}

function NotificationDetail({ kind, scopeKey, id, onClose, onVisible }: {
  kind: "personal" | "broadcast";
  scopeKey: string;
  id: string | null;
  onClose: () => void;
  onVisible: (candidate: NotificationReadCandidate) => void;
}) {
  const { request } = useSession();
  const navigate = useNavigate();
  const inboxKind: NotificationInboxKind = kind === "personal" ? "history" : "broadcasts";
  const base = notificationInboxPath(inboxKind);
  const item = useQuery({
    queryKey: notificationDetailQueryKey(scopeKey, inboxKind, id),
    queryFn: () => request<NotificationHistoryItem | NotificationBroadcastItem>(`${base}/${id}`),
    enabled: Boolean(scopeKey && id),
  });
  const detailSource = createCompositeSource({
    label: kind === "personal" ? "Notification detail" : "Announcement detail",
    hasData: item.data !== undefined,
    isLoading: item.isLoading,
    error: item.error,
    isFetching: item.isFetching,
    refetch: () => item.refetch(),
  });
  const detailCurrent = compositeSourceCurrent(detailSource);
  const detailUsable = compositeSourceUsable(detailSource.state);
  const data = detailUsable ? item.data : undefined;
  const destination = kind === "personal" && data ? notificationDestination(data) : null;

  useEffect(() => {
    if (data && !data.readAtUtc && detailCurrent) {
      onVisible({ scopeKey, kind: inboxKind, item: data, sourceCurrent: true });
    }
  }, [data, detailCurrent, inboxKind, onVisible, scopeKey]);

  function openAffectedItem() {
    if (!destination) return;
    onClose();
    navigate(destination.path);
  }

  return (
    <Modal
      open={Boolean(scopeKey && id)}
      title={data?.title || (kind === "personal" ? "Notification" : "Announcement")}
      description={data ? `${humanize(data.module)} · ${formatDateTime(data.occurredAtUtc)}` : "Loading message"}
      onClose={onClose}
    >
      <CompositeSourceNotice
        sources={[detailSource]}
        title="Notification detail is delayed"
      />
      {detailSource.state === "loading" ? (
        <LoadingState label="Loading message" />
      ) : !detailUsable ? (
        <CompositeSourceFallback state={detailSource.state} label="notification detail" />
      ) : data ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-2xl bg-base-200 p-4">
            <div className="flex items-center gap-3">
              <SeverityIcon severity={data.severity} />
              <div>
                <p className="font-semibold capitalize">{notificationSeverityLabel(data.severity)}</p>
                <p className="mt-1 text-xs text-base-content/50">
                  {data.readAtUtc
                    ? `Read ${formatDateTime(data.readAtUtc)}`
                    : detailCurrent
                      ? "Opening message"
                      : "Unread in the last loaded snapshot"}
                </p>
              </div>
            </div>
            <StatusBadge status={data.readAtUtc ? "read" : "unread"} />
          </div>
          {data.body && <p className="whitespace-pre-wrap text-sm leading-7 text-base-content/70">{data.body}</p>}
          {destination && (
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 text-left transition hover:border-primary/40 hover:bg-primary/10"
              onClick={openAffectedItem}
            >
              <span>
                <span className="block text-sm font-semibold">{destination.actionLabel}</span>
                <span className="mt-1 block text-xs text-base-content/50">{destination.contextLabel}</span>
              </span>
              <ArrowUpRight className="shrink-0 text-primary" size={19} />
            </button>
          )}
          {"audience" in data && (
            <div className="rounded-xl border border-base-300 p-4">
              <p className="text-xs text-base-content/40">Audience</p>
              <p className="mt-1 text-sm font-semibold capitalize">{notificationAudienceLabel(data.audience)}</p>
            </div>
          )}
          {hasPayload(data.payload) && (
            <details className="rounded-xl border border-base-300 p-4">
              <summary className="cursor-pointer text-sm font-semibold">Technical details</summary>
              <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral p-3 font-mono text-xs text-neutral-content">
                {JSON.stringify(data.payload, null, 2)}
              </pre>
            </details>
          )}
          <div className="flex justify-end border-t border-base-300 pt-5">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function SeverityIcon({ severity }: { severity: NotificationSeverity }) {
  const label = notificationSeverityLabel(severity);
  const config: Record<string, { icon: ReactNode; tone: string }> = {
    success: { icon: <ShieldCheck size={18} />, tone: "bg-success/15 text-primary" },
    warning: { icon: <CircleAlert size={18} />, tone: "bg-warning/20 text-warning-content" },
    error: { icon: <AlertCircle size={18} />, tone: "bg-error/10 text-error" },
    info: { icon: <Info size={18} />, tone: "bg-info/15 text-info-content" },
  };
  const selected = config[label] || config.info;
  return <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${selected.tone}`}>{selected.icon}</span>;
}

function NotificationSeverityBadge({ severity }: { severity: NotificationSeverity }) {
  const label = notificationSeverityLabel(severity);
  const tone = ({
    info: "border-info/30 bg-info/15 text-info-content",
    success: "border-success/30 bg-success/15 text-primary",
    warning: "border-warning/40 bg-warning/20 text-warning-content",
    error: "border-error/25 bg-error/10 text-error",
  } as Record<string, string>)[label] || "border-info/30 bg-info/15 text-info-content";
  return <span className={`badge badge-sm font-semibold capitalize ${tone}`}>{label}</span>;
}

function hasPayload(payload: unknown) {
  return payload != null && (typeof payload !== "object" || Object.keys(payload as object).length > 0);
}

function humanize(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatRelative(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
