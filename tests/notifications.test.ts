import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import type { NotificationHistoryListResponse } from "../src/api/types";
import {
  decrementNotificationUnreadCountLocally,
  markNotificationReadLocally,
} from "../src/features/notifications/notificationReadState";
import { shouldRetryNotificationStream } from "../src/features/notifications/notifications";

describe("notification streams", () => {
  it.each([400, 401, 403, 404])("does not retry terminal HTTP %s responses", (status) => {
    expect(shouldRetryNotificationStream(new ApiError("failed", status))).toBe(false);
  });

  it.each([408, 429, 500, 503])("retries recoverable HTTP %s responses", (status) => {
    expect(shouldRetryNotificationStream(new ApiError("failed", status))).toBe(true);
  });

  it("retries network failures", () => {
    expect(shouldRetryNotificationStream(new TypeError("network error"))).toBe(true);
  });
});

describe("notification read state", () => {
  const unreadNotification = {
    id: "notification-a",
    streamSequence: 1,
    name: "reservation-updated",
    module: "reservations",
    version: 1,
    title: "Reservation updated",
    body: "The stay changed.",
    severity: "warning",
    payload: {},
    occurredAtUtc: "2026-07-15T12:00:00Z",
    createdAtUtc: "2026-07-15T12:00:00Z",
    readAtUtc: null,
  } satisfies NotificationHistoryListResponse["items"][number];

  it("optimistically marks one visible item without changing other inbox items", () => {
    const response: NotificationHistoryListResponse = {
      items: [
        unreadNotification,
        { ...unreadNotification, id: "notification-b" },
      ],
      page: 1,
      pageSize: 25,
      totalCount: 2,
      unreadCount: 2,
    };

    const updated = markNotificationReadLocally(response, "notification-a", "2026-07-15T12:01:00Z");

    expect(updated?.unreadCount).toBe(1);
    expect(updated?.items[0].readAtUtc).toBe("2026-07-15T12:01:00Z");
    expect(updated?.items[1].readAtUtc).toBeNull();
  });

  it("does not decrement the unread count twice", () => {
    const response: NotificationHistoryListResponse = {
      items: [{ ...unreadNotification, readAtUtc: "2026-07-15T12:01:00Z" }],
      page: 1,
      pageSize: 25,
      totalCount: 1,
      unreadCount: 0,
    };

    expect(markNotificationReadLocally(response, "notification-a", "2026-07-15T12:02:00Z")).toBe(response);
  });

  it("decrements a summary count when its single preview item is not the visible notification", () => {
    const response: NotificationHistoryListResponse = {
      items: [{ ...unreadNotification, id: "notification-latest" }],
      page: 1,
      pageSize: 1,
      totalCount: 5,
      unreadCount: 4,
    };

    const updated = decrementNotificationUnreadCountLocally(
      response,
      "notification-older",
      "2026-07-15T12:02:00Z",
    );

    expect(updated?.unreadCount).toBe(3);
    expect(updated?.items[0].readAtUtc).toBeNull();
  });
});
