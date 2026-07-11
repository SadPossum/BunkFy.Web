# Frontend Architecture Overview

BunkFy Web is the operational browser client for BunkFy.

Initial architectural direction:

- Treat the UI as an approachable operations app, not a marketing site or generic admin dashboard.
- Keep product features under `src/features/<feature>`.
- Keep reusable UI primitives under `src/components`.
- Keep generated API code under `src/api/generated`.
- Keep app composition under `src/app`.
- Use OpenAPI-generated types/clients once backend contracts exist.
- Use React Router for product navigation, TanStack Query for server state, and daisyUI/Tailwind for the component system.
- Keep authenticated requests tenant-aware and refresh expired access tokens once before signing the user out.

## Planned Source Layout

```text
src/
  app/
  api/
    generated/
  components/
    ui/
    layout/
    data-table/
    forms/
  features/
    auth/
    dashboard/
    reservations/
    inventory/
    properties/
  styles/
```

The first product slice covers the backend's current PMS spine: staff auth, Properties, Inventory, and Reservations. Generic framework capabilities and copied Catalog/Ordering examples are intentionally not presented as hostel product features.

