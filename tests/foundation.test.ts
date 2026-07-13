import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../src/api/client";
import { guestStatusLabel, guestStatusValue, guestStayStatusLabel, inventorySalesModeValue, reservationSourceValue, reservationStatusLabel } from "../src/api/labels";

const repositoryRoot = process.cwd();

afterEach(() => vi.unstubAllGlobals());

describe("frontend repository foundation", () => {
  it("documents the operational app surface", () => {
    const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");
    const overview = readFileSync(join(repositoryRoot, "docs", "architecture", "overview.md"), "utf8");

    expect(readme).toContain("operational frontend");
    expect(readme).toContain("Reservation creation");
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
    expect(client).toContain("X-Tenant-Id");
    expect(client).toContain('credentials: "include"');
  });

  it("does not allow callers to suppress browser session cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest<void>("/api/smoke", { credentials: "omit" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it("maps API enum values to the backend JSON contract", () => {
    expect(inventorySalesModeValue("roomLevel")).toBe(2);
    expect(inventorySalesModeValue("bedLevel")).toBe(3);
    expect(reservationSourceValue("direct")).toBe(1);
    expect(reservationSourceValue("external")).toBe(2);
    expect(reservationStatusLabel(2)).toBe("confirmed");
    expect(guestStatusValue("archived")).toBe(2);
    expect(guestStatusLabel(1)).toBe("active");
    expect(guestStayStatusLabel(10)).toBe("checked out");
  });
});
