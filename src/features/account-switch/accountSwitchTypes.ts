import type { components } from "../../api/contracts.generated";

// Auth-owned wire types are generated from the current OpenAPI document. The
// API adapter below normalizes the named wire enums to the internal state
// values used by the account-switch recovery state machine.
type RememberedBrowserWire = components["schemas"]["RememberedBrowserCurrentResponse"];
type RememberedOperationResultWire = components["schemas"]["RememberedBrowserOperationResponse"];
export type RememberedState = 0 | 1 | 2 | 3 | 4 | 5;
export type RememberedOutcome = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// The API uses named string enums on the wire. The account-switch state
// machine keeps its compact numeric values internally so existing operation
// and recovery logic cannot accidentally mix wire names with local states.
export type RememberedBrowser = Omit<RememberedBrowserWire, "state"> & { state: RememberedState };
export type RememberedAccount = NonNullable<RememberedBrowserWire["accounts"]>[number];
export type RememberedOperationResult = Omit<RememberedOperationResultWire, "outcome" | "current"> & {
  outcome: RememberedOutcome;
  current: RememberedBrowser;
  retryAfterMs?: number;
};
export const rememberedState = { missing: 0, locked: 1, active: 2, signingIn: 3, revoked: 4, unavailable: 5 } as const satisfies Record<string, RememberedState>;
export const rememberedOutcome = { applied: 0, stateChanged: 1, authenticationRequired: 2, pinRejected: 3, rateLimited: 4,
  sessionLimitReached: 5, unavailable: 6, notFound: 7 } as const satisfies Record<string, RememberedOutcome>;

export function hasRememberedAccount(browser: RememberedBrowser): boolean {
  return Boolean(browser.active) || (browser.accounts?.length ?? 0) > 0;
}

/** A first-run browser must enter the ordinary sign-in/onboarding flow. */
export function isEmptyRememberedBrowser(browser: RememberedBrowser): boolean {
  return !hasRememberedAccount(browser) &&
    (browser.state === rememberedState.missing ||
      browser.state === rememberedState.revoked ||
      browser.state === rememberedState.active);
}
