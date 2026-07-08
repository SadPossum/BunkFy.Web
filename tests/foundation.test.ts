import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("frontend repository foundation", () => {
  it("keeps the app-less foundation documented", () => {
    const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");
    const overview = readFileSync(join(repositoryRoot, "docs", "architecture", "overview.md"), "utf8");

    expect(readme).toContain("frontend foundation");
    expect(overview).toContain("no runtime app is implemented yet");
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
});
