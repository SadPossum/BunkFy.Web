# Local Development

The repository is app-less for the initial foundation milestone.

Current validation commands:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Future frontend work should add the app shell deliberately:

- Vite or another chosen bundler.
- React and TypeScript.
- Router.
- Server-state client.
- Form and validation libraries.
- Generated API client.
- Design-system primitives.

Do not add production workflow screens until the API contracts and first product module boundaries are ready.

