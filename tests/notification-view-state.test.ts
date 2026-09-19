import { describe, expect, it } from "vitest";
import {
  clearNotificationViewSearchParams,
  notificationInboxSearchParams,
  notificationPageSearchParams,
  notificationSelectionSearchParams,
  notificationUnreadSearchParams,
  notificationViewState,
} from "../src/features/notifications/notificationViewState";

describe("notification view state", () => {
  it("uses a stable personal-inbox default and rejects malformed pages", () => {
    expect(notificationViewState(new URLSearchParams())).toEqual({
      inbox: "personal",
      unreadOnly: false,
      page: 1,
      selectedPersonalId: null,
      selectedBroadcastId: null,
    });
    expect(notificationViewState(new URLSearchParams("inbox=unknown&page=-2&unread=yes"))).toMatchObject({
      inbox: "personal",
      unreadOnly: false,
      page: 1,
    });
  });

  it("restores an announcement inbox, unread filter, page, and exact item", () => {
    expect(notificationViewState(new URLSearchParams(
      "inbox=announcements&unread=true&page=3&broadcast=broadcast-a",
    ))).toEqual({
      inbox: "announcements",
      unreadOnly: true,
      page: 3,
      selectedPersonalId: null,
      selectedBroadcastId: "broadcast-a",
    });
  });

  it("lets exact deep links choose their owning inbox", () => {
    expect(notificationViewState(new URLSearchParams(
      "inbox=announcements&notification=notification-a",
    )).inbox).toBe("personal");
    expect(notificationViewState(new URLSearchParams("broadcast=broadcast-a")).inbox).toBe("announcements");
  });

  it("clears incompatible selection and paging when changing inbox or filter", () => {
    const current = new URLSearchParams("inbox=announcements&unread=true&page=4&broadcast=broadcast-a");

    expect(notificationInboxSearchParams(current, "personal").toString()).toBe("unread=true");
    expect(notificationUnreadSearchParams(current, false).toString()).toBe("inbox=announcements");
  });

  it("keeps list context while opening and closing exact notification detail", () => {
    const current = new URLSearchParams("unread=true&page=2");
    const open = notificationSelectionSearchParams(current, "personal", "notification-a");

    expect(open.toString()).toBe("unread=true&page=2&notification=notification-a");
    expect(notificationSelectionSearchParams(open, "personal", null).toString()).toBe("unread=true&page=2");
    expect(notificationPageSearchParams(open, 1).toString()).toBe("unread=true");
  });

  it("clears every identity-bound view parameter on an actor or workspace switch", () => {
    const current = new URLSearchParams("inbox=announcements&unread=true&page=2&broadcast=broadcast-a&verify=1");

    expect(clearNotificationViewSearchParams(current).toString()).toBe("verify=1");
  });
});
