# Setup

## Prerequisites

- Node.js 22.
- pnpm 11.
- Git.

## First Run

```powershell
pnpm install
pnpm verify
pnpm contracts:check
```

When this repository is mounted inside the root BunkFy superproject, prefer the root scripts:

```powershell
.\eng\bootstrap.ps1
.\eng\verify.ps1
```

## Current Scope

This repository contains the staff operations router and the Properties, Inventory, and Reservations workflows. Public API types are generated from the checked-in backend OpenAPI snapshot. Run `pnpm contracts:generate` after an intentional API contract change and commit the snapshot and generated TypeScript together.

