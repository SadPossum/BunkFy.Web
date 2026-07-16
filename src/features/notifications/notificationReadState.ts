import type {
  NotificationBroadcastItem,
  NotificationBroadcastListResponse,
  NotificationHistoryItem,
  NotificationHistoryListResponse,
} from "../../api/types";

export type NotificationInboxItem = NotificationHistoryItem | NotificationBroadcastItem;
export type NotificationInboxResponse = NotificationHistoryListResponse | NotificationBroadcastListResponse;

export function notificationItemId(item: NotificationInboxItem): string {
  return "broadcastId" in item ? item.broadcastId : item.id;
}

export function markNotificationReadLocally(
  response: NotificationInboxResponse | undefined,
  notificationId: string,
  readAtUtc: string,
): NotificationInboxResponse | undefined {
  if (!response) return response;

  let changed = false;
  const items = response.items.map((item) => {
    if (notificationItemId(item) !== notificationId || item.readAtUtc) return item;
    changed = true;
    return { ...item, readAtUtc };
  }) as typeof response.items;

  if (!changed) return response;
  return {
    ...response,
    items,
    unreadCount: Math.max(0, response.unreadCount - 1),
  } as NotificationInboxResponse;
}

export function decrementNotificationUnreadCountLocally(
  response: NotificationInboxResponse | undefined,
  notificationId: string,
  readAtUtc: string,
): NotificationInboxResponse | undefined {
  if (!response || response.unreadCount === 0) return response;

  const updated = markNotificationReadLocally(response, notificationId, readAtUtc);
  if (updated !== response) return updated;
  return { ...response, unreadCount: response.unreadCount - 1 } as NotificationInboxResponse;
}
