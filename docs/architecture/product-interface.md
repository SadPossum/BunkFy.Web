# Product Interface

BunkFy is an operations product, not a generic administration dashboard. The interface should help staff answer three questions quickly: what is happening now, what needs a decision, and where the owning record lives.

## Navigation

- **Operate** contains the daily surfaces: Today, Calendar, Reservations, Guest records, and Inventory.
- **Manage** contains structural and governed configuration: Properties, Staff, Integrations, and Privacy requests.
- **Workspace** contains workspace-level identity and access settings.
- Desktop keeps workspace and property context visible in the navigation rail. Mobile keeps Today, Calendar, Reservations, and Inventory in the bottom bar and exposes the complete hierarchy through More.

Today has exactly two local views. **Operations** answers what is happening now and what needs a decision. **Visual** presents live room and unit state spatially. Calendar is not a Today view or preview; it is a standalone primary route so reservations and future event or cleaning sources can contribute their own schedule data without Today becoming a planning surface.

Navigation remains permission-shaped. Hiding a link is usability behavior; API authorization remains the security boundary.

## Visual System

- Use a warm light canvas, crisp work surfaces, deep green for commands and selection, blue for informational state, amber for attention, and red for destructive or failed state. The warmth should feel hospitable without reducing contrast or turning the interface monochrome.
- Keep work surfaces at an 8px radius with restrained borders and shadows. Avoid nested cards; use dividers, rows, and full-width bands inside a single owning surface.
- Prefer compact tables and lists for scanning. Open a focused detail panel or modal only when the user chooses a record or command.
- Keep headings proportional to their surface. Page titles establish location; cards and panels use compact section headings.
- Status must always have text. Color and icons reinforce meaning but never carry it alone.

## Product Boundaries

The Coherent Redesign prototype is an interaction reference, not production source. The web app adopts its strongest patterns, including operations-first hierarchy, contextual quick looks, semantic cues, truthful partial states, and responsive navigation. Today Operations and Today Visual share one bounded day schedule projection. Calendar opens in Week view and composes bounded Reservations stay overlap, assigned Inventory unit identities, current room and bed topology, and bounded Inventory block overlap into a resource timeline; Month and Agenda remain alternative planning views. Reservations and Inventory continue to own their data and contracts. Future cleaning or event domains remain separate data owners and may later contribute schedule entries through their own contracts. Shared-station PIN switching, Housekeeping, and Accounting are not implied by this interface work.

Existing permission, stale-data, unknown-outcome, authentication, and recovery behavior remains authoritative throughout visual migration.

## Interaction Contract

- Lists, filters, selected records, and settings sections keep allowlisted URL state so an operator can reload or share the exact context. A missing or inaccessible exact record fails in place and never substitutes the first available item.
- Today, Calendar, notifications, and other projections route to the owning domain for changes. Commands require current permission, scope, and owner-source evidence at execution time; the API remains the final authorization and concurrency boundary.
- Workspace, property, and signed-in actor changes clear incompatible selection and cached authority. Revocation removes now-inaccessible data immediately; a newly granted scope refreshes only the projections that can have become available.
- Dialogs own a fixed header and action footer while only their content region scrolls. Focus enters the dialog, remains contained, closes with Escape, and returns to the invoking control.
- Loading, last-confirmed, unavailable, permission-denied, and empty are distinct states. Independent sources can fail independently, and unknown data is never rendered as a trusted zero or available result.
- Offline writes are not queued. The interface keeps already loaded reads visibly qualified and disables commands until connectivity returns.

## Responsive And Accessible Use

- Desktop uses the persistent navigation rail. Mobile keeps the four highest-frequency destinations in the bottom bar and provides the complete permission-shaped hierarchy in a modal navigation drawer.
- Compact layouts preserve meaning through a purpose-built hierarchy rather than shrinking desktop grids. The supported 320 px layout has no document-level horizontal overflow; dense tools own their own named scroll region where necessary.
- The skip link, segmented tabs, room expand/collapse controls, drawers, dialogs, pickers, and property switcher are keyboard operable with visible focus and stable focus return.
- Property-local dates and time zones come from current property authority. Locale-dependent rendering may change label length or date order without changing domain meaning or breaking the layout.

Detailed source mapping and operator-review evidence are retained in the private review register. This source checkpoint is work in progress, not a whole-product UX or production-readiness approval.
