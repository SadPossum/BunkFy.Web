import type { ApiSession } from "../../api/client";
import {
  notificationItemId,
  type NotificationInboxItem,
} from "./notificationReadState";

export type NotificationInboxKind = "history" | "broadcasts";

export function notificationScopeKey(
  session: Pick<ApiSession, "tenantId" | "username"> | null | undefined,
): string {
  if (!session?.tenantId || !session.username.trim()) return "";
  return JSON.stringify([
    session.tenantId,
    session.username.trim().toLowerCase(),
  ]);
}

export function notificationInboxQueryKey(
  scopeKey: string,
  kind: NotificationInboxKind,
) {
  return ["notifications", kind, scopeKey] as const;
}

export function notificationListQueryKey(
  scopeKey: string,
  kind: NotificationInboxKind,
  page: number,
  unreadOnly: boolean,
) {
  return [...notificationInboxQueryKey(scopeKey, kind), "list", page, unreadOnly] as const;
}

export function notificationListQueryPrefix(
  scopeKey: string,
  kind: NotificationInboxKind,
) {
  return [...notificationInboxQueryKey(scopeKey, kind), "list"] as const;
}

export function notificationDetailQueryKey(
  scopeKey: string,
  kind: NotificationInboxKind,
  notificationId: string | null,
) {
  return [...notificationInboxQueryKey(scopeKey, kind), "detail", notificationId] as const;
}

export function notificationSummaryQueryKey(
  scopeKey: string,
  kind: NotificationInboxKind,
) {
  return [...notificationInboxQueryKey(scopeKey, kind), "unread-summary"] as const;
}

export function notificationInboxPath(kind: NotificationInboxKind): string {
  return kind === "history" ? "/api/notifications" : "/api/notifications/broadcasts";
}

export function notificationReadAllowed(
  activeScopeKey: string,
  candidateScopeKey: string,
  sourceCurrent: boolean,
): boolean {
  return Boolean(
    activeScopeKey &&
      activeScopeKey === candidateScopeKey &&
      sourceCurrent,
  );
}

export function notificationItemMatches(
  current: readonly NotificationInboxItem[],
  candidate: NotificationInboxItem,
): boolean {
  const candidateId = notificationItemId(candidate);
  return current.some((item) =>
    notificationItemId(item) === candidateId &&
    item.version === candidate.version &&
    item.streamSequence === candidate.streamSequence &&
    item.readAtUtc === candidate.readAtUtc);
}

export function notificationStreamRetryDelay(
  retryAttempt: number,
  random: number = Math.random(),
): number {
  const attempt = Math.min(5, Math.max(0, Math.floor(retryAttempt)));
  const jitter = 0.75 + Math.min(1, Math.max(0, random)) * 0.5;
  return Math.round(Math.min(24_000, 1_000 * 2 ** attempt) * jitter);
}
