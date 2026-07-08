# Local Development

The repository contains a minimal Vite smoke shell for Aspire and browser-runtime validation.

Current validation commands:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Run the smoke shell directly:

```powershell
pnpm dev
```

Future frontend work should add product app structure deliberately:

- React and TypeScript.
- Router.
- Server-state client.
- Form and validation libraries.
- Generated API client.
- Design-system primitives.

Do not add production workflow screens until the API contracts and first product module boundaries are ready.

