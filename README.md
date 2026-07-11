# BunkFy Web

This is the operational frontend for BunkFy, an open-source hostel property management system.

The app is a Vite-powered React client for staff. It connects directly to the public BunkFy API and keeps product workflows grouped around the property currently being operated.

## Current Scope

- Tenant-aware staff login and registration with refresh-token session handling.
- Property, room, and bed topology management.
- Room/bed sales-mode setup, availability checks, and manual inventory blocks.
- Reservation creation, filtering, detail, and cancellation.
- A property-level operations overview for arrivals, guests, inventory, and upcoming stays.
- React, TanStack Query, React Router, Tailwind CSS, and daisyUI.

## Validation

```powershell
pnpm install
pnpm verify
```

Run the app directly:

```powershell
pnpm dev
```

The default API address is `http://localhost:5194`. Override it with `VITE_BUNKFY_API_BASE_URL`, or run the root Aspire AppHost to inject the API endpoint automatically.

## Documentation

Start with [docs/README.md](docs/README.md).
