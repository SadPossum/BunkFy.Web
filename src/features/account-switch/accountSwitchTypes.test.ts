import { describe, expect, it } from "vitest";
import { isEmptyRememberedBrowser, rememberedState, type RememberedBrowser } from "./accountSwitchTypes";

function browser(state: number, accounts: unknown[] = [], active: unknown = null): RememberedBrowser {
  return { state, accounts, active } as RememberedBrowser;
}

describe("remembered browser first-run state", () => {
  it("admits normal sign-in when no account has been remembered", () => {
    expect(isEmptyRememberedBrowser(browser(rememberedState.active))).toBe(true);
    expect(isEmptyRememberedBrowser(browser(rememberedState.missing))).toBe(true);
    expect(isEmptyRememberedBrowser(browser(rememberedState.revoked))).toBe(true);
  });

  it("keeps the account boundary when an account or an unsafe state exists", () => {
    expect(isEmptyRememberedBrowser(browser(rememberedState.active, [{ proofId: "account" }]))).toBe(false);
    expect(isEmptyRememberedBrowser(browser(rememberedState.active, [], { proofId: "active" }))).toBe(false);
    expect(isEmptyRememberedBrowser(browser(rememberedState.locked))).toBe(false);
    expect(isEmptyRememberedBrowser(browser(rememberedState.unavailable))).toBe(false);
  });
});
