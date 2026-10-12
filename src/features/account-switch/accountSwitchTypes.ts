import type { components } from "../../api/contracts.generated";

// Auth-owned wire types; populated by the actual enabled OpenAPI generation.
// No parallel handwritten JWT, principal, session or permission DTOs.
export type RememberedBrowser = components["schemas"]["RememberedBrowserCurrentResponse"];
export type RememberedAccount = NonNullable<RememberedBrowser["accounts"]>[number];
export type RememberedOperationResult = components["schemas"]["RememberedBrowserOperationResponse"] & { retryAfterMs?: number };
export const rememberedState = { missing: 0, locked: 1, active: 2, signingIn: 3, revoked: 4, unavailable: 5 } as const;
export const rememberedOutcome = { applied: 0, stateChanged: 1, authenticationRequired: 2, pinRejected: 3, rateLimited: 4,
  sessionLimitReached: 5, unavailable: 6, notFound: 7 } as const;
