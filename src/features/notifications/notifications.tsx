import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import type { NotificationBroadcastItem, NotificationBroadcastListResponse, NotificationHistoryItem, NotificationHistoryListResponse } from "../../api/types";
import { operationalNotificationQueryKeys } from "../../app/liveUpdates";
import { useSession } from "../../app/session";

type NotificationsContextValue = { unreadCount: number; isLoading: boolean; refresh: () => Promise<void> };
const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { request, stream, session } = useSession();
  const queryClient = useQueryClient();
  const historySequence = useRef(0);
  const broadcastSequence = useRef(0);
  const history = useQuery({
    queryKey: ["notifications", "history", "unread-summary", session?.tenantId],
    queryFn: () => request<NotificationHistoryListResponse>("/api/notifications?page=1&pageSize=1"),
    refetchInterval: 60_000,
  });
  const broadcasts = useQuery({
    queryKey: ["notifications", "broadcasts", "unread-summary", session?.tenantId],
    queryFn: () => request<NotificationBroadcastListResponse>("/api/notifications/broadcasts?page=1&pageSize=1"),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    historySequence.current = 0;
    broadcastSequence.current = 0;
  }, [session?.tenantId]);

  useEffect(() => {
    const sequence = history.data?.items[0]?.streamSequence;
    if (sequence != null) historySequence.current = Math.max(historySequence.current, sequence);
  }, [history.data]);
  useEffect(() => {
    const sequence = broadcasts.data?.items[0]?.streamSequence;
    if (sequence != null) broadcastSequence.current = Math.max(broadcastSequence.current, sequence);
  }, [broadcasts.data]);

  useEffect(() => {
    if (!session || !history.isSuccess || !broadcasts.isSuccess) return;
    const controller = new AbortController();
    const invalidateHistory = (item: NotificationHistoryItem) => {
      const invalidations = [queryClient.invalidateQueries({ queryKey: ["notifications", "history"] })];
      for (const queryKey of operationalNotificationQueryKeys(item)) {
        invalidations.push(queryClient.invalidateQueries({ queryKey }));
      }
      void Promise.all(invalidations);
    };
    const invalidateBroadcasts = (_item: NotificationBroadcastItem) => {
      void queryClient.invalidateQueries({ queryKey: ["notifications", "broadcasts"] });
    };
    void keepStreaming("/api/notifications/history/stream", historySequence, stream, controller.signal, invalidateHistory);
    void keepStreaming("/api/notifications/broadcasts/stream", broadcastSequence, stream, controller.signal, invalidateBroadcasts);
    return () => controller.abort();
  }, [broadcasts.isSuccess, history.isSuccess, queryClient, session, stream]);

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

async function keepStreaming<T extends { streamSequence?: number }>(path: string, sequence: React.RefObject<number>, open: (path: string, signal: AbortSignal) => Promise<Response>, signal: AbortSignal, onItem: (item: T) => void) {
  while (!signal.aborted) {
    try {
      const response = await open(`${path}?afterSequence=${sequence.current}`, signal);
      await consumeSse(response, sequence, signal, onItem);
    } catch (error) {
      if (signal.aborted || !shouldRetryNotificationStream(error)) return;
    }
    await waitForRetry(signal);
  }
}

export function shouldRetryNotificationStream(error: unknown) {
  return !(error instanceof ApiError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 429);
}

async function consumeSse<T extends { streamSequence?: number }>(response: Response, sequence: React.RefObject<number>, signal: AbortSignal, onItem: (item: T) => void) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data) {
        try {
          const item = JSON.parse(data) as T;
          if (typeof item.streamSequence === "number") sequence.current = Math.max(sequence.current, item.streamSequence);
          onItem(item);
        } catch {
          // Ignore malformed events and continue the durable stream.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function waitForRetry(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = window.setTimeout(resolve, 3_000);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
  });
}
