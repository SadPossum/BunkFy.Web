import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSmokeStatus } from "../src/app/smoke";

const repositoryRoot = process.cwd();

describe("frontend repository foundation", () => {
  it("keeps the minimal app shell documented", () => {
    const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");
    const overview = readFileSync(join(repositoryRoot, "docs", "architecture", "overview.md"), "utf8");

    expect(readme).toContain("minimal Vite smoke shell");
    expect(overview).toContain("minimal runtime shell");
  });

  it("keeps future source folders in stable locations", () => {
    const expectedPaths = [
      "src/app",
      "src/api/generated",
      "src/components/ui",
      "src/features/reservations",
    ];

    for (const expectedPath of expectedPaths) {
      expect(existsSync(join(repositoryRoot, expectedPath))).toBe(true);
    }
  });

  it("loads smoke status from the configured API base URL", async () => {
    const result = await loadSmokeStatus("http://api.test/", async (url) => {
      expect(url).toBe("http://api.test/api/smoke");

      return new Response(JSON.stringify({
        application: "BunkFy",
        service: "BunkFy.Host.Api",
        status: "ok",
        gmaModulesEnabled: false,
        timestampUtc: "2026-07-08T00:00:00Z",
      }));
    });

    expect(result).toMatchObject({
      ok: true,
      apiBaseUrl: "http://api.test",
    });
  });
});
