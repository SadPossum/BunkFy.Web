import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inventorySalesModeValue, reservationSourceValue, reservationStatusLabel } from "../src/api/labels";

const repositoryRoot = process.cwd();

describe("frontend repository foundation", () => {
  it("documents the operational app surface", () => {
    const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");
    const overview = readFileSync(join(repositoryRoot, "docs", "architecture", "overview.md"), "utf8");

    expect(readme).toContain("operational frontend");
    expect(readme).toContain("Reservation creation");
    expect(overview).toContain("Properties, Inventory, and Reservations");
  });

  it("keeps future source folders in stable locations", () => {
    const expectedPaths = [
      "src/app",
      "src/api",
      "src/components/ui",
      "src/features/reservations",
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

    expect(session).toContain("/api/auth/refresh");
    expect(client).toContain("X-Tenant-Id");
  });

  it("maps API enum values to the backend JSON contract", () => {
    expect(inventorySalesModeValue("roomLevel")).toBe(2);
    expect(inventorySalesModeValue("bedLevel")).toBe(3);
    expect(reservationSourceValue("direct")).toBe(1);
    expect(reservationSourceValue("external")).toBe(2);
    expect(reservationStatusLabel(2)).toBe("confirmed");
  });
});
