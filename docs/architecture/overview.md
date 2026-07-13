# Frontend Architecture Overview

BunkFy Web is the operational browser client for BunkFy.

Architectural direction:

- Treat the UI as an approachable operations app, not a marketing site or generic admin dashboard.
- Keep product features under `src/features/<feature>`.
- Keep reusable UI primitives under `src/components`.
- Keep generated API contracts in `src/api/contracts.generated.ts` and app-facing normalization in `src/api/types.ts`.
- Keep app composition under `src/app`.
- Generate public API types from the checked-in backend OpenAPI snapshot and fail verification on drift.
- Use React Router for product navigation, TanStack Query for server state, and daisyUI/Tailwind for the component system.
- Keep authenticated requests tenant-aware, keep access tokens in memory, coalesce expired-session recovery in-process, and serialize shared-cookie mutation across tabs with Web Locks where supported.
- Evaluate effective permissions in bounded batches to gate controls, while treating backend authorization as the security boundary.

## Planned Source Layout

```text
src/
  app/
  api/
    contracts.generated.ts
    types.ts
  components/
    ui/
    layout/
    data-table/
    forms/
  features/
    auth/
    dashboard/
    reservations/
    guests/
    staff/
    integrations/
    notifications/
    account/
    inventory/
    properties/
  styles/
```

The operational product slice covers staff auth, Properties, Inventory, Reservations, property-scoped Guest Records, tenant-wide Staff Profiles with property assignments, and operator-facing Ingestion integrations. Reservations include grouped availability selection, canonical Guest Record linking, editable booking details with history, and the complete stay lifecycle. Integrations expose staff controls and audit trails while keeping adapter-ingress machine endpoints outside the UI. Generic framework capabilities and copied Catalog/Ordering examples are intentionally not presented as hostel product features.

