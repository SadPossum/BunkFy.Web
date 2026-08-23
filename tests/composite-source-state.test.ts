import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compositeSourceCurrent,
  compositeSourceNeedsRetry,
  compositeSourceState,
  compositeSourceUsable,
} from "../src/app/compositeSourceState";

describe("composite source state", () => {
  it("keeps loaded data usable after a refresh failure", () => {
    const state = compositeSourceState(true, false, true);

    expect(state).toBe("stale");
    expect(compositeSourceUsable(state)).toBe(true);
    expect(compositeSourceNeedsRetry(state)).toBe(true);
  });

  it("distinguishes unavailable data from an authoritative empty result", () => {
    const unavailable = compositeSourceState(false, false, true);
    const emptyButLoaded = compositeSourceState(true, false, false);

    expect(unavailable).toBe("unavailable");
    expect(compositeSourceUsable(unavailable)).toBe(false);
    expect(emptyButLoaded).toBe("ready");
    expect(compositeSourceUsable(emptyButLoaded)).toBe(true);
  });

  it("keeps an active read pending and treats a settled empty state as unavailable", () => {
    expect(compositeSourceState(false, true, false)).toBe("loading");
    expect(compositeSourceState(false, false, false)).toBe("unavailable");
  });

  it("requires a settled successful source before treating evidence as current", () => {
    expect(compositeSourceCurrent({ state: "ready", isFetching: false })).toBe(true);
    expect(compositeSourceCurrent({ state: "ready", isFetching: true })).toBe(false);
    expect(compositeSourceCurrent({ state: "stale", isFetching: false })).toBe(false);
  });

  it("keeps independent dashboard sources out of one global error return", () => {
    const dashboard = readFileSync(
      join(process.cwd(), "src", "features", "dashboard", "DashboardPage.tsx"),
      "utf8",
    );

    expect(dashboard).toContain("<CompositeSourceNotice");
    expect(dashboard).toContain("compositeSourceUsable");
    expect(dashboard).not.toContain("const firstError");
    expect(dashboard).not.toContain("if (firstError) return");
  });

  it("keeps inventory reads independently recoverable", () => {
    const inventory = readFileSync(
      join(process.cwd(), "src", "features", "inventory", "InventoryPage.tsx"),
      "utf8",
    );

    expect(inventory).toContain("<CompositeSourceNotice");
    expect(inventory).toContain("<CompositeSourceFallback");
    expect(inventory).not.toContain("if (inventory.error || blocks.error)");
    expect(inventory).not.toContain("if (inventory.isLoading || blocks.isLoading)");
  });
});
