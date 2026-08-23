import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NotificationHistoryItem } from "../src/api/types";
import {
  notificationDetailQueryKey,
  notificationInboxQueryKey,
  notificationItemMatches,
  notificationListQueryKey,
  notificationListQueryPrefix,
  notificationReadAllowed,
  notificationScopeKey,
  notificationStreamRetryDelay,
  notificationSummaryQueryKey,
} from "../src/features/notifications/notificationSourceAuthority";

const repositoryRoot = process.cwd();

function source(path: string): string {
  return readFileSync(join(repositoryRoot, "src", ...path.split("/")), "utf8")
    .replaceAll("\r\n", "\n");
}

describe("notification source authority recovery", () => {
  it("binds every query family to the normalized user and workspace identity", () => {
    const scope = notificationScopeKey({
      tenantId: "tenant-a",
      username: " Maya@Example.Test ",
    });

    expect(scope).toBe('["tenant-a","maya@example.test"]');
    expect(notificationScopeKey(null)).toBe("");
    expect(notificationScopeKey({ tenantId: "tenant-a", username: " " })).toBe("");
    expect(notificationScopeKey({ tenantId: "tenant-b", username: "maya@example.test" })).not.toBe(scope);
    expect(notificationScopeKey({ tenantId: "tenant-a", username: "other@example.test" })).not.toBe(scope);

    expect(notificationInboxQueryKey(scope, "history")).toEqual([
      "notifications",
      "history",
      scope,
    ]);
    expect(notificationListQueryKey(scope, "history", 2, true)).toEqual([
      "notifications",
      "history",
      scope,
      "list",
      2,
      true,
    ]);
    expect(notificationListQueryPrefix(scope, "history")).toEqual([
      "notifications",
      "history",
      scope,
      "list",
    ]);
    expect(notificationDetailQueryKey(scope, "history", "notification-a")).toEqual([
      "notifications",
      "history",
      scope,
      "detail",
      "notification-a",
    ]);
    expect(notificationSummaryQueryKey(scope, "history")).toEqual([
      "notifications",
      "history",
      scope,
      "unread-summary",
    ]);
  });

  it("denies read side effects from stale or different-scope evidence", () => {
    expect(notificationReadAllowed("scope-a", "scope-a", true)).toBe(true);
    expect(notificationReadAllowed("scope-a", "scope-a", false)).toBe(false);
    expect(notificationReadAllowed("scope-a", "scope-b", true)).toBe(false);
    expect(notificationReadAllowed("", "", true)).toBe(false);
  });

  it("requires the exact current notification version and stream position", () => {
    const candidate = notification();

    expect(notificationItemMatches([candidate], candidate)).toBe(true);
    expect(notificationItemMatches([{ ...candidate, version: 2 }], candidate)).toBe(false);
    expect(notificationItemMatches([{ ...candidate, streamSequence: 8 }], candidate)).toBe(false);
    expect(notificationItemMatches([{ ...candidate, readAtUtc: "2026-08-23T10:01:00Z" }], candidate)).toBe(false);
    expect(notificationItemMatches([{ ...candidate, id: "notification-b" }], candidate)).toBe(false);
  });

  it("uses bounded exponential jitter for recoverable stream reconnects", () => {
    expect(notificationStreamRetryDelay(0, 0)).toBe(750);
    expect(notificationStreamRetryDelay(0, 1)).toBe(1_250);
    expect(notificationStreamRetryDelay(1, 0.5)).toBe(2_000);
    expect(notificationStreamRetryDelay(5, 0)).toBe(18_000);
    expect(notificationStreamRetryDelay(5, 1)).toBe(30_000);
    expect(notificationStreamRetryDelay(99, 1)).toBe(30_000);
  });

  it("preserves independent inbox sources and fences every read path", () => {
    const page = source("features/notifications/NotificationsPage.tsx");
    const provider = source("features/notifications/notifications.tsx");

    expect(page).toContain("const scopeKey = notificationScopeKey(session);");
    expect(page).toContain("queryKey: notificationListQueryKey(scopeKey, kind, page, unreadOnly)");
    expect(page).toContain("const listSource = createCompositeSource({");
    expect(page).toContain("const detailSource = createCompositeSource({");
    expect(page).toContain("notificationReadAllowed(scopeKey, targetScopeKey, listCurrent)");
    expect(page).toContain("sourceCurrent: listCurrent && notificationItemMatches(items, item)");
    expect(page).toContain("notificationSummaryQueryKey(candidate.scopeKey, candidate.kind)");
    expect(page).toContain("if (scopeKey) previousScopeKeyRef.current = scopeKey;");
    expect(page).toContain("const markAllPending = markAll.isPending && markAllTargetsCurrentInbox;");
    expect(page).toContain("disabled={markAllPending || !listCurrent}");
    expect(page).toContain("disabled={!listCurrent}");
    expect(page).toContain("<CompositeSourceNotice");
    expect(page).toContain("<CompositeSourceFallback");
    expect(page).not.toContain('["notifications", kind, "list"');
    expect(page).not.toContain('["notifications", kind, "unread-summary"]');
    expect(page).not.toContain("query.error ?");
    expect(page).not.toContain("item.error ?");

    expect(provider).toContain("const historySeeded = history.data !== undefined;");
    expect(provider).toContain("const broadcastsSeeded = broadcasts.data !== undefined;");
    expect(provider).toContain("if (!scopeKey || !historySeeded) return;");
    expect(provider).toContain("if (!scopeKey || !broadcastsSeeded) return;");
    expect(provider).toContain("notificationStreamRetryDelay(retryAttempt)");
    expect(provider).not.toContain("!history.isSuccess || !broadcasts.isSuccess");
  });
});

function notification(): NotificationHistoryItem {
  return {
    id: "notification-a",
    module: "reservations",
    name: "reservation-updated",
    version: 1,
    title: "Reservation updated",
    body: "The stay changed.",
    severity: "warning",
    streamSequence: 7,
    occurredAtUtc: "2026-08-23T10:00:00Z",
    createdAtUtc: "2026-08-23T10:00:00Z",
    readAtUtc: null,
    payload: {},
  };
}
