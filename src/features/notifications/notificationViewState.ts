export type NotificationInboxView = "personal" | "announcements";

export type NotificationViewState = {
  inbox: NotificationInboxView;
  unreadOnly: boolean;
  page: number;
  selectedPersonalId: string | null;
  selectedBroadcastId: string | null;
};

export function notificationViewState(searchParams: URLSearchParams): NotificationViewState {
  const selectedPersonalId = value(searchParams.get("notification"));
  const selectedBroadcastId = selectedPersonalId
    ? null
    : value(searchParams.get("broadcast"));
  const requestedInbox = searchParams.get("inbox");

  return {
    inbox: selectedPersonalId
      ? "personal"
      : selectedBroadcastId || requestedInbox === "announcements"
        ? "announcements"
        : "personal",
    unreadOnly: searchParams.get("unread") === "true",
    page: positivePage(searchParams.get("page")),
    selectedPersonalId,
    selectedBroadcastId,
  };
}

export function notificationInboxSearchParams(
  current: URLSearchParams,
  inbox: NotificationInboxView,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (inbox === "personal") next.delete("inbox");
  else next.set("inbox", "announcements");
  clearSelection(next);
  next.delete("page");
  return next;
}

export function notificationUnreadSearchParams(
  current: URLSearchParams,
  unreadOnly: boolean,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (unreadOnly) next.set("unread", "true");
  else next.delete("unread");
  next.delete("page");
  clearSelection(next);
  return next;
}

export function notificationPageSearchParams(
  current: URLSearchParams,
  page: number,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (page <= 1) next.delete("page");
  else next.set("page", String(Math.floor(page)));
  clearSelection(next);
  return next;
}

export function notificationSelectionSearchParams(
  current: URLSearchParams,
  inbox: NotificationInboxView,
  notificationId: string | null,
): URLSearchParams {
  const next = new URLSearchParams(current);
  clearSelection(next);
  if (notificationId) {
    next.set(inbox === "personal" ? "notification" : "broadcast", notificationId);
  }
  return next;
}

export function clearNotificationViewSearchParams(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete("inbox");
  next.delete("unread");
  next.delete("page");
  clearSelection(next);
  return next;
}

function clearSelection(searchParams: URLSearchParams) {
  searchParams.delete("notification");
  searchParams.delete("broadcast");
}

function positivePage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function value(candidate: string | null): string | null {
  const normalized = candidate?.trim();
  return normalized ? normalized : null;
}
