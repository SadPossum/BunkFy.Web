# BunkFy Web

Frontend app shell for BunkFy, an open-source hostel property management system.

## Stack

- React
- Vite
- TypeScript
- pnpm
- Vitest and Testing Library

## Local Development

```powershell
pnpm install
pnpm dev
```

When this repository is mounted inside the root BunkFy superproject, prefer:

```powershell
.\eng\bootstrap.ps1
.\eng\run-aspire.ps1
```

## Validation

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

