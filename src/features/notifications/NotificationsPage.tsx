import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Info,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { useNetworkStatus } from "../../app/networkStatus";
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
  ModalActions,
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
import {
  clearNotificationViewSearchParams,
  notificationInboxSearchParams,
  notificationPageSearchParams,
  notificationSelectionSearchParams,
  notificationUnreadSearchParams,
  notificationViewState,
  type NotificationInboxView,
} from "./notificationViewState";

const PAGE_SIZE = 25;

type NotificationReadCandidate = {
  scopeKey: string;
  kind: NotificationInboxKind;
  item: NotificationInboxItem;
  sourceCurrent: boolean;
};

type NotificationReadSubmission = NotificationReadCandidate & {
  focusTarget: "row" | "detail";
  notificationId: string;
  pendingToken: string;
  readAtUtc: string;
};

type MarkAllSubmission = {
  scopeKey: string;
  kind: NotificationInboxKind;
};

export function NotificationsPage() {
  const { request, session } = useSession();
  const { isOffline } = useNetworkStatus();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [attentionIds, setAttentionIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingReadIds = useRef(new Set<string>());
  const markAllPendingRef = useRef(false);
  const inboxRef = useRef<HTMLElement>(null);
  const notificationOpenButtons = useRef(new Map<string, HTMLButtonElement>());
  const scopeKey = notificationScopeKey(session);
  const previousScopeKeyRef = useRef(scopeKey);
  const viewState = notificationViewState(searchParams);
  const { inbox, unreadOnly, page, selectedPersonalId, selectedBroadcastId } = viewState;
  const tab = inbox === "personal" ? "personal" : "broadcasts";
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
      const authorityCurrent = !isOffline && targetKind === kind &&
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
    onSettled: () => {
      markAllPendingRef.current = false;
    },
    retry: false,
  });

  const markRead = useMutation<void, Error, NotificationReadSubmission>({
    mutationFn: (submission) => {
      const authorityCurrent = !isOffline && submission.kind === kind &&
        !submission.item.readAtUtc &&
        notificationReadAllowed(scopeKey, submission.scopeKey, submission.sourceCurrent);
      if (!authorityCurrent) {
        throw new Error("Current notification evidence could not be confirmed. Refresh and try again.");
      }
      return request<void>(
        `${notificationInboxPath(submission.kind)}/${submission.notificationId}/read`,
        { method: "POST" },
      );
    },
    onSuccess: async (_response, submission) => {
      const updateResponse = (current: NotificationInboxResponse | undefined) =>
        markNotificationReadLocally(current, submission.notificationId, submission.readAtUtc);
      queryClient.setQueriesData<NotificationInboxResponse>(
        { queryKey: notificationListQueryPrefix(submission.scopeKey, submission.kind) },
        updateResponse,
      );
      queryClient.setQueryData<NotificationInboxItem>(
        notificationDetailQueryKey(
          submission.scopeKey,
          submission.kind,
          submission.notificationId,
        ),
        (current) => current && !current.readAtUtc
          ? { ...current, readAtUtc: submission.readAtUtc }
          : current,
      );
      queryClient.setQueryData<NotificationInboxResponse>(
        notificationSummaryQueryKey(submission.scopeKey, submission.kind),
        (current) => decrementNotificationUnreadCountLocally(
          current,
          submission.notificationId,
          submission.readAtUtc,
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: notificationInboxQueryKey(submission.scopeKey, submission.kind),
      });
      if (submission.focusTarget === "row") {
        window.requestAnimationFrame(() => {
          const exactButton = notificationOpenButtons.current.get(submission.notificationId);
          const nextButton = notificationOpenButtons.current.values().next().value;
          (exactButton ?? nextButton ?? inboxRef.current)?.focus({ preventScroll: true });
        });
      }
    },
    onError: async (_error, submission) => {
      await queryClient.invalidateQueries({
        queryKey: notificationInboxQueryKey(submission.scopeKey, submission.kind),
      });
    },
    onSettled: (_response, _error, submission) => {
      pendingReadIds.current.delete(submission.pendingToken);
    },
    retry: false,
  });

  useEffect(() => setAttentionIds(new Set()), [scopeKey]);

  useEffect(() => {
    const previousScopeKey = previousScopeKeyRef.current;
    if (scopeKey) previousScopeKeyRef.current = scopeKey;
    if (!previousScopeKey || !scopeKey || previousScopeKey === scopeKey) return;

    setAttentionIds(new Set());
    setSearchParams((current) => clearNotificationViewSearchParams(current), { replace: true });
  }, [scopeKey, setSearchParams]);

  useEffect(() => {
    if (listCurrent && query.data && page > 1 && query.data.items.length === 0) {
      setSearchParams((current) => notificationPageSearchParams(current, page - 1), { replace: true });
    }
  }, [listCurrent, page, query.data, setSearchParams]);

  function select(item: NotificationInboxItem | null) {
    const next = notificationSelectionSearchParams(
      searchParams,
      inbox,
      item ? notificationItemId(item) : null,
    );
    setSearchParams(next, { replace: true });
  }

  function changeInbox(nextInbox: NotificationInboxView) {
    setSearchParams(notificationInboxSearchParams(searchParams, nextInbox), { replace: true });
  }

  function changeUnreadOnly(nextUnreadOnly: boolean) {
    setSearchParams(notificationUnreadSearchParams(searchParams, nextUnreadOnly), { replace: true });
  }

  function changePage(nextPage: number) {
    setSearchParams(notificationPageSearchParams(searchParams, nextPage), { replace: true });
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

  function markAllRead() {
    if (isOffline || !listCurrent || markRead.isPending || markAll.isPending || markAllPendingRef.current) {
      return;
    }
    markAllPendingRef.current = true;
    markAll.reset();
    markAll.mutate({ scopeKey, kind });
  }

  function markOneRead(candidate: NotificationReadCandidate, focusTarget: "row" | "detail") {
    const notificationId = notificationItemId(candidate.item);
    const pendingToken = `${candidate.scopeKey}:${candidate.kind}:${notificationId}`;
    const authorityCurrent = candidate.kind === kind &&
      !candidate.item.readAtUtc &&
      notificationReadAllowed(scopeKey, candidate.scopeKey, candidate.sourceCurrent);
    if (isOffline || !authorityCurrent || markAll.isPending || markRead.isPending || pendingReadIds.current.size > 0) {
      return;
    }

    pendingReadIds.current.add(pendingToken);
    markRead.reset();
    markRead.mutate({
      ...candidate,
      focusTarget,
      notificationId,
      pendingToken,
      readAtUtc: new Date().toISOString(),
    });
  }

  const markAllTargetsCurrentInbox = markAll.variables?.scopeKey === scopeKey &&
    markAll.variables.kind === kind;
  const markAllPending = markAll.isPending && markAllTargetsCurrentInbox;
  const markAllError = markAllTargetsCurrentInbox
    ? markAll.error
    : null;
  const markReadTargetsCurrentInbox = markRead.variables?.scopeKey === scopeKey &&
    markRead.variables.kind === kind;
  const markReadError = markReadTargetsCurrentInbox ? markRead.error : null;
  const selectedNotificationId = selectedPersonalId ?? selectedBroadcastId;
  const attentionCount = items.reduce((count, item) => (
    attentionIds.has(notificationAttentionKey(kind, notificationItemId(item))) ? count + 1 : count
  ), 0);

  return <>
    <PageHeader
      eyebrow="Live workspace"
      title="Notifications"
      description="Operational changes and workspace announcements, kept in one quiet inbox."
    />
    <CompositeSourceNotice
      sources={[listSource]}
      title="Notification inbox is delayed"
    />
    <section
      ref={inboxRef}
      className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm"
      aria-label="Notification inbox"
      tabIndex={-1}
    >
      <div className="flex flex-col gap-3 border-b border-base-300 bg-base-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <SegmentedTabs
          value={inbox}
          ariaLabel="Notification inbox"
          onValueChange={changeInbox}
          options={[
            { value: "personal", label: "For you", icon: <Bell size={15} /> },
            { value: "announcements", label: "Announcements", icon: <Megaphone size={15} /> },
          ]}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:justify-end">
          {listUsable && (
            <span className="text-xs font-semibold text-base-content/50" aria-live="polite">
              {attentionCount > 0
                ? `${attentionCount} new this visit`
                : `${query.data?.unreadCount ?? 0} unread`}
            </span>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              className="toggle toggle-primary toggle-sm"
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => changeUnreadOnly(event.target.checked)}
            />
            Unread only
          </label>
          {listUsable && (query.data?.unreadCount ?? 0) > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm h-8 min-h-8 px-2.5"
              onClick={markAllRead}
              disabled={markAllPending || markRead.isPending || !listCurrent || isOffline}
              title={isOffline ? "Reconnect before marking notifications as read." : undefined}
            >
              <CheckCheck size={16} />
              Mark all read
            </button>
          )}
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
              onMarkRead={() => markOneRead({
                scopeKey,
                kind,
                item,
                sourceCurrent: listCurrent && notificationItemMatches(items, item),
              }, "row")}
              openButtonRef={(button) => {
                const id = notificationItemId(item);
                if (button) notificationOpenButtons.current.set(id, button);
                else notificationOpenButtons.current.delete(id);
              }}
              markReadPending={markRead.isPending &&
                markRead.variables?.notificationId === notificationItemId(item)}
              markReadDisabled={!listCurrent || markRead.isPending || markAllPending || isOffline}
              markReadTitle={isOffline
                ? "Reconnect before marking this notification as read."
                : "Mark as read"}
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
          onPageChange={changePage}
        />
      </>}
      {markAllError && (
        <div className="border-t border-base-300 p-4"><ErrorState error={markAllError} /></div>
      )}
      {markReadError && !selectedNotificationId && (
        <div className="border-t border-base-300 p-4"><ErrorState error={markReadError} /></div>
      )}
    </section>
    <NotificationDetail
      kind="personal"
      scopeKey={scopeKey}
      id={selectedPersonalId}
      onClose={() => select(null)}
      onMarkRead={(candidate) => markOneRead(candidate, "detail")}
      markReadPending={markRead.isPending &&
        markRead.variables?.kind === "history" &&
        markRead.variables.notificationId === selectedPersonalId}
      markReadDisabled={markRead.isPending || markAllPending || isOffline}
      markReadTitle={isOffline
        ? "Reconnect before marking this notification as read."
        : "Mark as read"}
      markReadError={markRead.variables?.kind === "history" &&
        markRead.variables.notificationId === selectedPersonalId
        ? markReadError
        : null}
    />
    <NotificationDetail
      kind="broadcast"
      scopeKey={scopeKey}
      id={selectedBroadcastId}
      onClose={() => select(null)}
      onMarkRead={(candidate) => markOneRead(candidate, "detail")}
      markReadPending={markRead.isPending &&
        markRead.variables?.kind === "broadcasts" &&
        markRead.variables.notificationId === selectedBroadcastId}
      markReadDisabled={markRead.isPending || markAllPending || isOffline}
      markReadTitle={isOffline
        ? "Reconnect before marking this announcement as read."
        : "Mark as read"}
      markReadError={markRead.variables?.kind === "broadcasts" &&
        markRead.variables.notificationId === selectedBroadcastId
        ? markReadError
        : null}
    />
  </>;
}

function NotificationRow({
  item,
  attention,
  onOpen,
  onMarkRead,
  openButtonRef,
  markReadPending,
  markReadDisabled,
  markReadTitle,
}: {
  item: NotificationInboxItem;
  attention: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
  openButtonRef: (button: HTMLButtonElement | null) => void;
  markReadPending: boolean;
  markReadDisabled: boolean;
  markReadTitle: string;
}) {
  const unread = !item.readAtUtc;
  const destination = notificationDestination(item);

  return (
    <div
      className={`group grid min-h-24 grid-cols-[minmax(0,1fr)_auto] border-l-4 transition ${attention ? "notification-attention" : unread ? "border-transparent bg-primary/[0.035] hover:bg-base-200/70" : "border-transparent hover:bg-base-200/70"}`}
    >
      <button
        ref={openButtonRef}
        type="button"
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 p-4 text-left focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-5"
        onClick={onOpen}
      >
        <SeverityIcon severity={item.severity} />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className={`min-w-0 truncate ${unread || attention ? "font-bold" : "font-semibold"}`}>{item.title}</p>
            {attention ? (
              <span className="badge badge-primary h-5 shrink-0 px-2 text-[0.68rem] font-bold">New</span>
            ) : unread ? (
              <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-base-content/60">{item.body || humanize(item.name)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-base-content/45">
            <span>{destination?.resourceLabel ?? humanize(item.module)}</span>
            {destination && <><span aria-hidden="true">·</span><span>{humanize(item.module)}</span></>}
            <span aria-hidden="true">·</span>
            <time dateTime={item.occurredAtUtc} title={formatDateTime(item.occurredAtUtc)}>{formatRelative(item.occurredAtUtc)}</time>
          </div>
          <div className="mt-2 sm:hidden"><NotificationSeverityBadge severity={item.severity} /></div>
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          <NotificationSeverityBadge severity={item.severity} />
          <ChevronRight className="text-base-content/30 transition group-hover:translate-x-0.5 group-hover:text-primary" size={18} aria-hidden="true" />
        </div>
      </button>
      {unread && (
        <div className="flex items-center border-l border-base-300/70 px-1.5 sm:px-2.5">
          <button
            type="button"
            className="btn btn-ghost h-auto min-h-11 w-14 flex-col gap-0.5 px-1 text-[0.68rem] sm:w-auto sm:flex-row sm:gap-1.5 sm:px-2.5 sm:text-xs"
            onClick={onMarkRead}
            disabled={markReadDisabled}
            aria-label={`Mark ${item.title} as read`}
            title={markReadTitle}
          >
            {markReadPending
              ? <span className="loading loading-spinner loading-xs" aria-hidden="true" />
              : <CheckCheck size={16} aria-hidden="true" />}
            <span className="sm:hidden">{markReadPending ? "Saving" : "Read"}</span>
            <span className="hidden sm:inline">{markReadPending ? "Marking…" : "Mark read"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function NotificationDetail({
  kind,
  scopeKey,
  id,
  onClose,
  onMarkRead,
  markReadPending,
  markReadDisabled,
  markReadTitle,
  markReadError,
}: {
  kind: "personal" | "broadcast";
  scopeKey: string;
  id: string | null;
  onClose: () => void;
  onMarkRead: (candidate: NotificationReadCandidate) => void;
  markReadPending: boolean;
  markReadDisabled: boolean;
  markReadTitle: string;
  markReadError: Error | null;
}) {
  const { request } = useSession();
  const navigate = useNavigate();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const markReadWasPending = useRef(false);
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
    if (markReadWasPending.current && data?.readAtUtc) {
      closeButtonRef.current?.focus({ preventScroll: true });
    }
    markReadWasPending.current = markReadPending;
  }, [data?.readAtUtc, markReadPending]);

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
      {detailUsable && <CompositeSourceNotice
        sources={[detailSource]}
        title="Notification detail is delayed"
      />}
      {detailSource.state === "loading" ? (
        <LoadingState label="Loading message" />
      ) : !detailUsable ? (
        <CompositeSourceFallback error={item.error} retry={() => void item.refetch()} state={detailSource.state} label="notification detail" title="Notification could not be opened" />
      ) : data ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-200/80 p-4">
            <div className="flex items-center gap-3">
              <SeverityIcon severity={data.severity} />
              <div>
                <p className="font-semibold capitalize">{notificationSeverityLabel(data.severity)}</p>
                <p className="mt-1 text-xs text-base-content/50">
                  {data.readAtUtc
                    ? `Read ${formatDateTime(data.readAtUtc)}`
                    : detailCurrent
                      ? "Unread"
                      : "Unread in the last loaded snapshot"}
                </p>
              </div>
            </div>
            <StatusBadge status={data.readAtUtc ? "read" : "unread"} />
          </div>
          {data.body && <p className="whitespace-pre-wrap text-sm leading-7 text-base-content/75">{data.body}</p>}
          {destination && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-semibold uppercase text-primary">Affected record</p>
              <p className="mt-1.5 text-sm font-semibold">{destination.resourceLabel}</p>
              <p className="mt-1 text-xs leading-5 text-base-content/55">{destination.contextLabel}</p>
            </div>
          )}
          {"audience" in data && (
            <div className="rounded-lg border border-base-300 p-4">
              <p className="text-xs text-base-content/40">Audience</p>
              <p className="mt-1 text-sm font-semibold capitalize">{notificationAudienceLabel(data.audience)}</p>
            </div>
          )}
          {hasPayload(data.payload) && (
            <details className="rounded-lg border border-base-300 p-4">
              <summary className="cursor-pointer text-sm font-semibold">Technical details</summary>
              <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral p-3 font-mono text-xs text-neutral-content">
                {JSON.stringify(data.payload, null, 2)}
              </pre>
            </details>
          )}
          {markReadError && <ErrorState error={markReadError} />}
          <ModalActions>
            <button ref={closeButtonRef} type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
            {!data.readAtUtc && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => onMarkRead({
                  scopeKey,
                  kind: inboxKind,
                  item: data,
                  sourceCurrent: detailCurrent,
                })}
                disabled={markReadDisabled || !detailCurrent}
                title={markReadTitle}
              >
                {markReadPending
                  ? <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                  : <CheckCheck size={18} aria-hidden="true" />}
                {markReadPending ? "Marking…" : "Mark read"}
              </button>
            )}
            {destination && (
              <button type="button" className="btn btn-primary" onClick={openAffectedItem}>
                {destination.actionLabel}
                <ArrowUpRight size={18} />
              </button>
            )}
          </ModalActions>
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
  return <span role="img" className={`grid size-10 shrink-0 place-items-center rounded-lg ${selected.tone}`} aria-label={`${label} notification`}>{selected.icon}</span>;
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
