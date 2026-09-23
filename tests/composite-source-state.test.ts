import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompositeSourceNotice } from "../src/components/ui/CompositeSourceNotice";
import {
  compositeSourceCurrent,
  compositeSourceNeedsRetry,
  compositeSourceState,
  compositeSourceUsable,
} from "../src/app/compositeSourceState";

const network = vi.hoisted(() => ({ isOffline: false }));
vi.mock("../src/app/networkStatus", () => ({ useNetworkStatus: () => network }));
beforeEach(() => { network.isOffline = false; });
describe("recovery notice layout contract (native geometry is verified separately)", () => {
  it.each(["stale", "unavailable"] as const)("establishes a mobile column and wide row for %s content", state => {
    const tree = CompositeSourceNotice({ sources: [{ label: "Stay history", state, isFetching: false, refetch: vi.fn() }] })!;
    const classes = tree.props.className.split(/\s+/);
    expect(classes).toContain("flex");
    expect(classes).toContain("flex-col");
    expect(classes).toContain("items-stretch");
    expect(classes).toContain("sm:flex-row");
    expect(classes).toContain("sm:items-center");
    expect(tree.props.role).toBe("status");
    expect(tree.props["aria-live"]).toBe("polite");
  });
});
describe("owner-opted focusable retry (native browser focus is verified separately)", () => {
  function retry(keepRetryFocusable: boolean, isFetching = false) {
    const refetch = vi.fn(async () => undefined);
    const tree = CompositeSourceNotice({ keepRetryFocusable, sources: [{ label: "Availability", state: "stale", isFetching, refetch }] })!;
    const button = (tree.props.children as ReactElement[]).find(node => node.type === "button") as ReactElement<{ className: string; disabled: boolean; "aria-disabled"?: boolean; "aria-busy"?: boolean; onClick: () => void }>;
    return { refetch, button: button.props };
  }
  it.each([false, true])("preserves default native disabled and suppresses all pending/offline activation (opt in=%s)", opted => {
    for (const offline of [false, true]) {
      network.isOffline = offline;
      const { refetch, button } = retry(opted, !offline);
      expect(button.disabled).toBe(!opted);
      expect(button["aria-disabled"]).toBe(opted ? true : undefined);
      expect(button["aria-busy"]).toBe(opted && !offline ? true : undefined);
      expect(button.className.includes("pointer-events-auto")).toBe(opted);
      expect(button.className).not.toContain("opacity-50");
      button.onClick(); button.onClick(); button.onClick();
      expect(refetch).not.toHaveBeenCalled();
    }
  });
  it("allows a settled failure to be retried and makes no automatic request", () => {
    const { refetch, button } = retry(true);
    expect(button.disabled).toBe(false); expect(button["aria-disabled"]).toBe(false);
    expect(refetch).not.toHaveBeenCalled(); button.onClick(); expect(refetch).toHaveBeenCalledOnce();
  });
});

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
