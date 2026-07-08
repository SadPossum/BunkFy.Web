# Setup

## Prerequisites

- Node.js 22.
- pnpm 11.
- Git.

## First Run

```powershell
pnpm install
pnpm verify
```

When this repository is mounted inside the root BunkFy superproject, prefer the root scripts:

```powershell
.\eng\bootstrap.ps1
.\eng\verify.ps1
```

## Current Scope

This repository currently validates repository structure and frontend tooling only. The real app shell, router, generated API client, and product screens are future work.

