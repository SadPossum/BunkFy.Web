import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Info,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { notificationAudienceLabel, notificationSeverityLabel } from "../../api/labels";
import type {
  MarkAllNotificationsReadResponse,
  NotificationBroadcastItem,
  NotificationBroadcastListResponse,
  NotificationHistoryItem,
  NotificationHistoryListResponse,
  NotificationSeverity,
} from "../../api/types";
import { useSession } from "../../app/session";
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
  type NotificationInboxKind,
} from "./notificationAttentionState";
import {
  decrementNotificationUnreadCountLocally,
  markNotificationReadLocally,
  notificationItemId,
  type NotificationInboxItem,
  type NotificationInboxResponse,
} from "./notificationReadState";

const PAGE_SIZE = 25;
type InboxTab = "personal" | "broadcasts";

export function NotificationsPage() {
  const { request, session } = useSession();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<InboxTab>("personal");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [attentionIds, setAttentionIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingReadIds = useRef(new Set<string>());
  const attentionScope = `${session?.username ?? "anonymous"}:${session?.tenantId ?? "global"}`;

  useEffect(() => setPage(1), [tab, unreadOnly]);
  useEffect(() => setAttentionIds(new Set()), [attentionScope]);

  const kind: NotificationInboxKind = tab === "personal" ? "history" : "broadcasts";
  const path = tab === "personal" ? "/api/notifications" : "/api/notifications/broadcasts";
  const query = useQuery({
    queryKey: ["notifications", kind, "list", page, unreadOnly],
    queryFn: () => request<NotificationHistoryListResponse | NotificationBroadcastListResponse>(
      `${path}?page=${page}&pageSize=${PAGE_SIZE}&unreadOnly=${unreadOnly}`,
    ),
  });
  const markAll = useMutation({
    mutationFn: () => request<MarkAllNotificationsReadResponse>(`${path}/read-all`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications", kind] });
    },
  });

  const acknowledgeVisible = useCallback((item: NotificationInboxItem) => {
    if (item.readAtUtc) return;

    const id = notificationItemId(item);
    const token = `${kind}:${id}`;
    const readAtUtc = new Date().toISOString();
    const updateResponse = (current: NotificationInboxResponse | undefined) =>
      markNotificationReadLocally(current, id, readAtUtc);

    queryClient.setQueryData<NotificationInboxResponse>(
      ["notifications", kind, "list", page, unreadOnly],
      updateResponse,
    );
    queryClient.setQueryData<NotificationInboxItem>(
      ["notifications", kind, "detail", id],
      (current) => current && !current.readAtUtc ? { ...current, readAtUtc } : current,
    );

    if (pendingReadIds.current.has(token)) return;
    pendingReadIds.current.add(token);
    queryClient.setQueriesData<NotificationInboxResponse>(
      { queryKey: ["notifications", kind, "unread-summary"] },
      (current) => decrementNotificationUnreadCountLocally(current, id, readAtUtc),
    );
    void request<void>(`${path}/${id}/read`, { method: "POST" })
      .then(() => pendingReadIds.current.delete(token))
      .catch(() => {
        pendingReadIds.current.delete(token);
        void queryClient.invalidateQueries({ queryKey: ["notifications", kind] });
      });
  }, [kind, page, path, queryClient, request, unreadOnly]);

  function select(item: NotificationInboxItem | null) {
    const next = new URLSearchParams(searchParams);
    next.delete("notification");
    next.delete("broadcast");
    if (item) next.set(tab === "personal" ? "notification" : "broadcast", notificationItemId(item));
    setSearchParams(next, { replace: true });
  }

  const items = query.data?.items ?? [];
  useEffect(() => {
    setAttentionIds((current) => captureNotificationAttention(current, kind, items));
  }, [items, kind]);

  const selectedPersonalId = searchParams.get("notification");
  const selectedBroadcastId = searchParams.get("broadcast");
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

  return <>
    <PageHeader
      eyebrow="Live workspace"
      title="Notifications"
      description="Stay on top of operational events and workspace announcements."
      action={(query.data?.unreadCount ?? 0) > 0 ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending}
        >
          <CheckCheck size={17} />
          Mark all read
        </button>
      ) : undefined}
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
      {query.isLoading ? (
        <LoadingState label="Loading notifications" />
      ) : query.error ? (
        <div className="p-6"><ErrorState error={query.error} retry={() => void query.refetch()} /></div>
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
              onVisible={acknowledgeVisible}
            />
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-base-300 px-4 py-3 sm:px-6">
          <p className="text-xs text-base-content/45">
            {query.data?.totalCount ?? items.length} total · {query.data?.unreadCount ?? 0} unread
          </p>
          <div className="join">
            <button
              className="btn btn-sm join-item"
              disabled={page === 1}
              onClick={() => setPage((current) => current - 1)}
              aria-label="Previous notifications"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="btn btn-sm join-item"
              disabled={page * PAGE_SIZE >= (query.data?.totalCount ?? 0)}
              onClick={() => setPage((current) => current + 1)}
              aria-label="Next notifications"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </>}
      {markAll.error && (
        <div className="border-t border-base-300 p-4"><ErrorState error={markAll.error} /></div>
      )}
    </section>
    <NotificationDetail
      kind="personal"
      id={searchParams.get("notification")}
      onClose={() => select(null)}
      onVisible={acknowledgeVisible}
    />
    <NotificationDetail
      kind="broadcast"
      id={searchParams.get("broadcast")}
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

function NotificationDetail({ kind, id, onClose, onVisible }: {
  kind: "personal" | "broadcast";
  id: string | null;
  onClose: () => void;
  onVisible: (item: NotificationInboxItem) => void;
}) {
  const { request } = useSession();
  const navigate = useNavigate();
  const inboxKind: NotificationInboxKind = kind === "personal" ? "history" : "broadcasts";
  const base = kind === "personal" ? "/api/notifications" : "/api/notifications/broadcasts";
  const item = useQuery({
    queryKey: ["notifications", inboxKind, "detail", id],
    queryFn: () => request<NotificationHistoryItem | NotificationBroadcastItem>(`${base}/${id}`),
    enabled: Boolean(id),
  });
  const data = item.data;
  const destination = kind === "personal" && data ? notificationDestination(data) : null;

  useEffect(() => {
    if (data && !data.readAtUtc) onVisible(data);
  }, [data, onVisible]);

  function openAffectedItem() {
    if (!destination) return;
    onClose();
    navigate(destination.path);
  }

  return (
    <Modal
      open={Boolean(id)}
      title={data?.title || (kind === "personal" ? "Notification" : "Announcement")}
      description={data ? `${humanize(data.module)} · ${formatDateTime(data.occurredAtUtc)}` : "Loading message"}
      onClose={onClose}
    >
      {item.isLoading ? (
        <LoadingState label="Loading message" />
      ) : item.error ? (
        <ErrorState error={item.error} retry={() => void item.refetch()} />
      ) : data ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-2xl bg-base-200 p-4">
            <div className="flex items-center gap-3">
              <SeverityIcon severity={data.severity} />
              <div>
                <p className="font-semibold capitalize">{notificationSeverityLabel(data.severity)}</p>
                <p className="mt-1 text-xs text-base-content/50">
                  {data.readAtUtc ? `Read ${formatDateTime(data.readAtUtc)}` : "Opening message"}
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
