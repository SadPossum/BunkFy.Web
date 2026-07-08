# Frontend Architecture Overview

BunkFy Web will become the operational browser client for BunkFy.

Initial architectural direction:

- Treat the UI as a dense operations app, not a marketing site.
- Keep product features under `src/features/<feature>`.
- Keep reusable UI primitives under `src/components`.
- Keep generated API code under `src/api/generated`.
- Keep app composition under `src/app`.
- Use OpenAPI-generated types/clients once backend contracts exist.
- Keep route, API, and design-system choices explicit until a product slice proves them.

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
    reservations/
    inventory/
    guests/
    housekeeping/
  styles/
```

The repository now contains a minimal runtime shell that calls the backend smoke endpoint. It is intentionally not a product UI yet.

