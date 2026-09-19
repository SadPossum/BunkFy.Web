import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { NotificationBroadcastItem, NotificationBroadcastListResponse, NotificationHistoryItem, NotificationHistoryListResponse } from "../../api/types";
import { operationalNotificationQueryKeys } from "../../app/liveUpdates";
import { useSession } from "../../app/session";
import { sessionIdentityKey } from "../../app/singleFlightRefresh";
import {
  notificationInboxQueryKey,
  notificationScopeKey,
  notificationSummaryQueryKey,
} from "./notificationSourceAuthority";
import {
  notificationStreamSupervisor,
  restartNotificationStreamsOnPersistedPageShow,
  stopNotificationStreamOnPageHide,
} from "./notificationStreamLifecycle";

export { shouldRetryNotificationStream } from "./notificationStreamLifecycle";

type NotificationsContextValue = { unreadCount: number; isLoading: boolean; refresh: () => Promise<void> };
const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { request, stream, session } = useSession();
  const queryClient = useQueryClient();
  const historySequence = useRef(0);
  const broadcastSequence = useRef(0);
  const [pageLifecycleRevision, setPageLifecycleRevision] = useState(0);
  const scopeKey = notificationScopeKey(session);
  const streamBoundaryKey = sessionIdentityKey(session);
  const history = useQuery({
    queryKey: notificationSummaryQueryKey(scopeKey, "history"),
    queryFn: ({ signal }) => request<NotificationHistoryListResponse>(
      "/api/notifications?page=1&pageSize=1",
      { signal },
    ),
    enabled: Boolean(scopeKey),
    refetchInterval: 60_000,
  });
  const broadcasts = useQuery({
    queryKey: notificationSummaryQueryKey(scopeKey, "broadcasts"),
    queryFn: ({ signal }) => request<NotificationBroadcastListResponse>(
      "/api/notifications/broadcasts?page=1&pageSize=1",
      { signal },
    ),
    enabled: Boolean(scopeKey),
    refetchInterval: 60_000,
  });
  const historySeeded = history.data !== undefined;
  const broadcastsSeeded = broadcasts.data !== undefined;

  useEffect(() => {
    historySequence.current = 0;
    broadcastSequence.current = 0;
  }, [streamBoundaryKey]);

  useEffect(() => restartNotificationStreamsOnPersistedPageShow(
    window,
    () => setPageLifecycleRevision((revision) => revision + 1),
  ), []);

  useEffect(() => {
    const sequence = history.data?.items[0]?.streamSequence;
    if (sequence != null) historySequence.current = Math.max(historySequence.current, sequence);
  }, [history.data]);
  useEffect(() => {
    const sequence = broadcasts.data?.items[0]?.streamSequence;
    if (sequence != null) broadcastSequence.current = Math.max(broadcastSequence.current, sequence);
  }, [broadcasts.data]);

  const invalidateHistory = useCallback((item: NotificationHistoryItem) => {
    const invalidations = [
      queryClient.invalidateQueries({
        queryKey: notificationInboxQueryKey(scopeKey, "history"),
      }),
    ];
    for (const queryKey of operationalNotificationQueryKeys(item)) {
      invalidations.push(queryClient.invalidateQueries({ queryKey }));
    }
    void Promise.all(invalidations);
  }, [queryClient, scopeKey]);
  const invalidateBroadcasts = useCallback((_item: NotificationBroadcastItem) => {
    void queryClient.invalidateQueries({
      queryKey: notificationInboxQueryKey(scopeKey, "broadcasts"),
    });
  }, [queryClient, scopeKey]);

  useEffect(() => {
    if (!scopeKey || !historySeeded) return;
    const lease = notificationStreamSupervisor.start({
      channel: "history",
      boundaryKey: streamBoundaryKey,
      path: "/api/notifications/history/stream",
      sequence: historySequence,
      open: stream,
      onItem: invalidateHistory,
    });
    const detachPageHide = stopNotificationStreamOnPageHide(window, lease.stop);
    return () => {
      detachPageHide();
      lease.stop();
    };
  }, [historySeeded, invalidateHistory, pageLifecycleRevision, scopeKey, stream, streamBoundaryKey]);

  useEffect(() => {
    if (!scopeKey || !broadcastsSeeded) return;
    const lease = notificationStreamSupervisor.start({
      channel: "broadcasts",
      boundaryKey: streamBoundaryKey,
      path: "/api/notifications/broadcasts/stream",
      sequence: broadcastSequence,
      open: stream,
      onItem: invalidateBroadcasts,
    });
    const detachPageHide = stopNotificationStreamOnPageHide(window, lease.stop);
    return () => {
      detachPageHide();
      lease.stop();
    };
  }, [broadcastsSeeded, invalidateBroadcasts, pageLifecycleRevision, scopeKey, stream, streamBoundaryKey]);

  const value = useMemo<NotificationsContextValue>(() => ({
    unreadCount: (history.data?.unreadCount ?? 0) + (broadcasts.data?.unreadCount ?? 0),
    isLoading: history.isLoading || broadcasts.isLoading,
    refresh: async () => { await Promise.all([history.refetch(), broadcasts.refetch()]); },
  }), [broadcasts, history]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("useNotifications must be used inside NotificationsProvider.");
  return value;
}
