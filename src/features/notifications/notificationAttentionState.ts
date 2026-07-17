import {
  notificationItemId,
  type NotificationInboxItem,
} from "./notificationReadState";

export type NotificationInboxKind = "history" | "broadcasts";

export function notificationAttentionKey(
  kind: NotificationInboxKind,
  notificationId: string,
): string {
  return `${kind}:${notificationId}`;
}

export function captureNotificationAttention(
  current: ReadonlySet<string>,
  kind: NotificationInboxKind,
  items: readonly NotificationInboxItem[],
): ReadonlySet<string> {
  let next: Set<string> | undefined;

  for (const item of items) {
    if (item.readAtUtc) continue;

    const key = notificationAttentionKey(kind, notificationItemId(item));
    if (current.has(key)) continue;

    next ??= new Set(current);
    next.add(key);
  }

  return next ?? current;
}

export function dismissNotificationAttention(
  current: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  if (!current.has(key)) return current;

  const next = new Set(current);
  next.delete(key);
  return next;
}
