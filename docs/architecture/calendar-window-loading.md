# Calendar date-window loading (UR019)

The Calendar remains a native table with fixed-width date columns, pinned room/bed labels and the existing half-open interval layout. The narrow view remains a seven-day chooser plus its exact selected day. A selected day outside loaded coverage is not silently replaced.

## Read and cache bounds

Non-overlapping 21-day display segments are aligned to Monday 1970-01-05. At most three segments (63 date columns) and six Calendar-owned query entries are retained: three reservation queries and three manual-block queries, plus the existing shared topology query. Six entries is not six HTTP requests: each loader drains sequential 100-item pages. Reservation requests cover 22 days including the one leading context day; blocks cover exactly 21. Both stay below the public 42-day overlap limits.

Queries retain the existing property-scoped invalidation prefixes and add a Calendar-only namespace, actual tenant/actor/session generation and selected/requested property identity, and exact source range. Eviction cancels/removes only those owned queries. A cancelled loader checks its signal after each response and cannot recreate its compatibility snapshot. Permission/property/session loss makes data ineligible immediately; URL metadata grants no access.

Scroll proximity extends one adjacent segment. Appending/prepending changes the boundary away from the stationary edge; failed segments are not retried by repeated edge observation. Ordinary query retry remains bounded by existing policy. Only retained windows with pending reservation lifecycle statuses receive the existing foreground live refresh. A failed/conflicting segment exposes explicit Retry.

## Truth and reconciliation

Free means a current Calendar schedule projection, not an allocation promise. Its exact display segment must have complete compatible reservations and blocks, matching current topology, current property and permission authority. Missing, failed, paused, refreshing or mismatched sources do not enable booking or advertise free gaps. The existing booking flow still checks the complete requested stay against the inventory availability endpoint before preselection/submission.

Identical reservation/block IDs are deduplicated before the unchanged interval layout. Distinct blocks in the same group remain distinct. Reservation list records have no version: differing stable projections, or contradictory presence in complete overlapping owners, are withheld and their affected coverage is Unconfirmed. No arrival-order winner or invented merged record is shown. One reconciliation is permitted per stationary authority/window generation; persistent disagreement requires explicit Retry. Automatic lifecycle polling pauses for conflicting segments. The conflict ledger contains only the current bounded window and is cleared with its owner.

## Navigation and action ownership

Existing date/day same-week business origins remain valid. An explicit action beyond that week emits date=day. Schema-v1 viewport metadata is a strict paired ISO date and integer offset 0–999 (thousandths of a day column), carried in Calendar, active preview, return preview and surface-return namespaces. No local/session storage subsystem, payload, permission result, token, draft or receipt is persisted. Metadata controls presentation only; reload must re-establish current source truth.

Prepend/eviction preserves the logical left-edge date and fractional offset. Region-only Arrow/Home/End keys do not intercept child controls or vertical scrolling. Booking/preview ownership freezes automatic viewport URL updates and eviction; one pending viewport update may apply on release. Business context keys exclude viewport metadata. Existing booking and preview focus keys are unchanged.

## Verification and production boundaries

Record actual page/request counts separately from query-entry and DOM-segment high-water marks, stationary-edge retries, conflicting snapshots, obsolete cancellations, and prepend/eviction anchor delta. Exercise both directions, long intervals, delayed/failed independent sources, >100 records, changed authority, exact booking/Spaces/preview returns and narrow keyboard/focus behavior. Static/render tests do not prove native scrolling or mounted focus behavior.

This is web-only scheduling/presentation work, not hosted capacity proof. Hosted request rates, concurrent staff, slow pages, monitoring and browser/AT/human validation remain separate. Rollback is the preserved Spaces R2 build: source d78970761bc39e4fa9c99750df842f10ab70ba7871eae66c2c37c2f7682f8e74, archive e7cf156dff2e33e6509f92baabc9adf0ba859c8156ffbe4c41975d4b9a75dc05, image adf015344717cefc8a7c8257ce939296029eae4e91ab417743b64c0e1f0bab86. No API/schema change, rollout, CI publication or production admission is implied.
