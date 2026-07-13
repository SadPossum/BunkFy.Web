import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { NotificationBroadcastListResponse, NotificationHistoryListResponse } from "../../api/types";
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
    queryFn: () => request<NotificationHistoryListResponse>("/api/notifications?page=1&pageSize=1&unreadOnly=true"),
    refetchInterval: 60_000,
  });
  const broadcasts = useQuery({
    queryKey: ["notifications", "broadcasts", "unread-summary", session?.tenantId],
    queryFn: () => request<NotificationBroadcastListResponse>("/api/notifications/broadcasts?page=1&pageSize=1&unreadOnly=true"),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const sequence = history.data?.items[0]?.streamSequence;
    if (sequence != null) historySequence.current = Math.max(historySequence.current, sequence);
  }, [history.data]);
  useEffect(() => {
    const sequence = broadcasts.data?.items[0]?.streamSequence;
    if (sequence != null) broadcastSequence.current = Math.max(broadcastSequence.current, sequence);
  }, [broadcasts.data]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const invalidateHistory = () => queryClient.invalidateQueries({ queryKey: ["notifications", "history"] });
    const invalidateBroadcasts = () => queryClient.invalidateQueries({ queryKey: ["notifications", "broadcasts"] });
    void keepStreaming("/api/notifications/history/stream", historySequence, stream, controller.signal, invalidateHistory);
    void keepStreaming("/api/notifications/broadcasts/stream", broadcastSequence, stream, controller.signal, invalidateBroadcasts);
    return () => controller.abort();
  }, [queryClient, session, stream]);

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

async function keepStreaming(path: string, sequence: React.RefObject<number>, open: (path: string, signal: AbortSignal) => Promise<Response>, signal: AbortSignal, onItem: () => void) {
  while (!signal.aborted) {
    try {
      const response = await open(`${path}?afterSequence=${sequence.current}`, signal);
      await consumeSse(response, sequence, signal, onItem);
    } catch {
      if (signal.aborted) return;
    }
    await waitForRetry(signal);
  }
}

async function consumeSse(response: Response, sequence: React.RefObject<number>, signal: AbortSignal, onItem: () => void) {
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
          const item = JSON.parse(data) as { streamSequence?: number };
          if (typeof item.streamSequence === "number") sequence.current = Math.max(sequence.current, item.streamSequence);
          onItem();
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
