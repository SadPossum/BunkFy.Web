import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiDownload, apiRequest, apiStream } from "../src/api/client";
import { adapterExecutionModeValue, guestStatusLabel, guestStatusValue, guestStayStatusLabel, ingestionRunStatusLabel, inventorySalesModeValue, notificationSeverityLabel, proposalStatusValue, reservationSourceValue, reservationStatusLabel, staffStatusLabel, staffStatusValue } from "../src/api/labels";

const repositoryRoot = process.cwd();

afterEach(() => vi.unstubAllGlobals());

describe("frontend repository foundation", () => {
  it("documents the operational app surface", () => {
    const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");
    const overview = readFileSync(join(repositoryRoot, "docs", "architecture", "overview.md"), "utf8");

    expect(readme).toContain("operational frontend");
    expect(readme).toContain("Full reservation lifecycle");
    expect(readme).toContain("guest profiles");
    expect(overview).toContain("Guest Records");
  });

  it("keeps future source folders in stable locations", () => {
    const expectedPaths = [
      "src/app",
      "src/api",
      "src/components/ui",
      "src/features/reservations",
      "src/features/guests",
      "src/features/staff",
      "src/features/integrations",
      "src/features/notifications",
      "src/features/account",
      "src/features/inventory",
      "src/features/properties",
    ];

    for (const expectedPath of expectedPaths) {
      expect(existsSync(join(repositoryRoot, expectedPath))).toBe(true);
    }
  });

  it("keeps tenant-aware auth and API boundaries explicit", () => {
    const session = readFileSync(join(repositoryRoot, "src", "app", "session.tsx"), "utf8");
    const client = readFileSync(join(repositoryRoot, "src", "api", "client.ts"), "utf8");

    expect(session).toContain("/api/auth/browser/refresh");
    expect(session).not.toContain("refreshToken");
    expect(session).toContain("createSingleFlightRefresh");
    expect(session).toContain("queryClient.removeQueries()");
    expect(session).not.toContain("queryClient.clear()");
    expect(client).toContain("X-Tenant-Id");
    expect(client).toContain('credentials: "include"');
  });

  it("keeps browser external authentication and account security on published API contracts", () => {
    const session = readFileSync(join(repositoryRoot, "src", "app", "session.tsx"), "utf8");
    const environment = readFileSync(join(repositoryRoot, "src", "app", "environment.ts"), "utf8");
    const authPage = readFileSync(join(repositoryRoot, "src", "features", "auth", "AuthPage.tsx"), "utf8");
    const account = readFileSync(join(repositoryRoot, "src", "features", "account", "AccountPage.tsx"), "utf8");

    expect(session).toContain("/sign-in/challenge");
    expect(session).toContain("/link/challenge");
    expect(session).toContain("/api/auth/browser/external/exchange");
    expect(session).not.toContain("accessToken=");
    expect(authPage).toContain('data.get("confirmPassword")');
    expect(authPage).toContain("/api/auth/self-registration");
    expect(authPage).toContain("passwordRegistrationEnabled");
    expect(account).toContain("/api/auth/methods");
    expect(account).toContain("/api/auth/password");
    expect(account).toContain("/api/auth/email-verification");
    expect(environment).toContain("VITE_BUNKFY_EMAIL_VERIFICATION_ENABLED");
    expect(account).toContain("emailVerificationEnabled");
    expect(account).toContain("/external-identities/");
  });

  it("keeps workspace membership usable when optional staff enrichment is unavailable", () => {
    const settings = readFileSync(
      join(repositoryRoot, "src", "features", "workspaces", "WorkspaceSettingsPage.tsx"),
      "utf8",
    );

    expect(settings).toContain('/api/staff/members?page=1&pageSize=100');
    expect(settings).toContain('error={members.error}');
    expect(settings).not.toContain('members.error ?? staff.error');
  });

  it("keeps growing operator directories on bounded server pages", () => {
    const reservations = readFileSync(
      join(repositoryRoot, "src", "features", "reservations", "ReservationsPage.tsx"),
      "utf8",
    );
    const workspace = readFileSync(
      join(repositoryRoot, "src", "features", "workspaces", "WorkspaceSettingsPage.tsx"),
      "utf8",
    );
    const connection = readFileSync(
      join(repositoryRoot, "src", "features", "integrations", "ConnectionDetail.tsx"),
      "utf8",
    );

    expect(reservations).toContain('reservationParams.append("status"');
    expect(reservations).toContain('totalCount={reservations.data?.totalCount}');
    expect(reservations).not.toContain("Load more reservations");
    expect(workspace).toContain("page=${memberPage}&pageSize=${MEMBERS_PAGE_SIZE}");
    expect(connection).toContain("page=${page}&pageSize=${CREDENTIALS_PAGE_SIZE}");
  });

  it("keeps modal backdrops out of the accessibility tree without creating an unnamed button", () => {
    const primitives = readFileSync(join(repositoryRoot, "src", "components", "ui", "primitives.tsx"), "utf8");

    expect(primitives).toContain('<div className="modal-backdrop"');
    expect(primitives).not.toContain('<button className="modal-backdrop"');
  });

  it("shows the mark-all action only for unread items in the selected inbox", () => {
    const notifications = readFileSync(join(repositoryRoot, "src", "features", "notifications", "NotificationsPage.tsx"), "utf8");

    expect(notifications).toContain("(query.data?.unreadCount ?? 0) > 0");
    expect(notifications).not.toContain("const { unreadCount } = useNotifications()");
  });

  it("does not allow callers to suppress browser session cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest<void>("/api/smoke", { credentials: "omit" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it("reads GMA Problem Details titles as stable error codes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: "Reservations.GuestNotLinkable",
      detail: "The guest is not active and visible at this property.",
      status: 409,
    }), { status: 409, headers: { "Content-Type": "application/problem+json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await apiRequest<void>("/api/reservations/link").catch((reason) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "Reservations.GuestNotLinkable",
      message: "The guest is not active and visible at this property.",
    });
  });

  it("keeps authenticated downloads inside the browser session boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("payload", { status: 200, headers: { "Content-Type": "application/octet-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    await apiDownload("/api/ingestion/payload", { credentials: "omit" });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it("opens notification streams with browser credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await apiStream("/api/notifications/history/stream", controller.signal);

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include", signal: controller.signal });
  });

  it("maps API enum values to the backend JSON contract", () => {
    expect(inventorySalesModeValue("roomLevel")).toBe(2);
    expect(inventorySalesModeValue("bedLevel")).toBe(3);
    expect(reservationSourceValue("direct")).toBe(1);
    expect(reservationSourceValue("external")).toBe(2);
    expect(reservationStatusLabel(2)).toBe("confirmed");
    expect(reservationStatusLabel(6)).toBe("checked in");
    expect(reservationStatusLabel(10)).toBe("checked out");
    expect(guestStatusValue("archived")).toBe(2);
    expect(guestStatusLabel(1)).toBe("active");
    expect(guestStayStatusLabel(10)).toBe("checked out");
    expect(staffStatusValue("suspended")).toBe(2);
    expect(staffStatusLabel(3)).toBe("departed");
    expect(adapterExecutionModeValue("remotePolling")).toBe(4);
    expect(proposalStatusValue("stale")).toBe(6);
    expect(ingestionRunStatusLabel(3)).toBe("partially succeeded");
    expect(notificationSeverityLabel(4)).toBe("error");
  });
});
