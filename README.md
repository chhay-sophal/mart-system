# mart-system

Mini-mart chain management system, split into three apps sharing a pnpm/Turborepo monorepo:

- `apps/pos` — offline-first Tauri desktop cashier terminal.
- `apps/ims` — always-online inventory/back-office web app.
- `apps/backend` — central multi-store API (Express + Prisma + Postgres).

Shared code lives under `packages/`:

- `packages/shared-types` — wire contracts (DTOs) shared across apps. Not a shared data-access layer — `pos` runs sql.js/SQLite locally, `backend` runs Prisma/Postgres, and those stay independent.
- `packages/api-client` — typed fetch wrapper used by `pos` and `ims` to talk to their respective backends.

## Getting started

```sh
pnpm install
pnpm build
pnpm dev
```

See `docs/plan.md` for the phased implementation plan.
