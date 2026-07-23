# Local Development

The repository contains the BunkFy staff operations SPA and its Aspire/browser-runtime integration.

Current validation commands:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm contracts:check
```

Run the app directly:

```powershell
pnpm dev
```

The generated API contract lives at `src/api/contracts.generated.ts` and the source OpenAPI snapshot at `openapi/bunkfy-api.json`. Refresh both with `pnpm contracts:generate` after an intentional backend API change; never hand-edit the generated file.

Use the browser auth endpoints for staff sessions. Refresh credentials stay in path-scoped HttpOnly cookies, access tokens stay in memory, refresh is single-flight, and Web Locks serialize shared-cookie mutation across tabs where supported. Permission evaluation improves the UI by hiding unavailable actions, but every backend command remains independently authorized.

The backend Development environment loads the digest-pinned
`development-hostel-example` country pack. It is synthetic, carries an
`Engineering` launch status, and is rejected by Production mode. New and
existing properties still begin unconfigured; explicitly enable the pack from
the selected property's Data processing panel before exercising guest,
reservation, or ingestion writes.

