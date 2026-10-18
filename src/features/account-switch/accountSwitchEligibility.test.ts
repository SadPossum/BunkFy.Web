// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { canUseSharedAccountSwitch } from "./accountSwitchEligibility";

const workspaceIdentity = JSON.stringify({ tenantId: "workspace-a", username: "owner@example.test" });

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function desktopViewport(matches = true): void {
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36" });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches } as MediaQueryList));
}

describe("shared account switch eligibility", () => {
  it("requires a persisted workspace session", () => {
    desktopViewport();
    expect(canUseSharedAccountSwitch()).toBe(false);

    localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify({ tenantId: "global", username: "owner@example.test" }));
    expect(canUseSharedAccountSwitch()).toBe(false);

    localStorage.setItem("bunkfy.session.identity.v2", workspaceIdentity);
    expect(canUseSharedAccountSwitch()).toBe(true);
  });

  it("keeps phones on ordinary authentication even with a workspace session", () => {
    localStorage.setItem("bunkfy.session.identity.v2", workspaceIdentity);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 17; Mobile) Gecko/157.0 Firefox/157.0" });
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true } as MediaQueryList));
    expect(canUseSharedAccountSwitch()).toBe(false);
  });

  it("keeps compact desktop layouts on ordinary authentication", () => {
    localStorage.setItem("bunkfy.session.identity.v2", workspaceIdentity);
    desktopViewport(false);
    expect(canUseSharedAccountSwitch()).toBe(false);
  });
});
