# mart-system

Mini-mart chain management system: **one organization per deployment**, with any number of `Store` branches sharing one catalog, one staff list, and one backend. (Not a multi-tenant/SaaS system — a separate business gets its own separate deployment.) Split into three apps sharing a pnpm/Turborepo monorepo:

- `apps/pos` — offline-first Tauri desktop cashier terminal (React + a local Express/sql.js sidecar). Never blocks a sale on network availability; syncs to the backend via an outbox/pull queue when connected.
- `apps/ims` — always-online back-office web app (React) for catalog, staff, terminals, inter-store transfers, reporting, and reconciliation.
- `apps/backend` — central API (Express + Prisma + Postgres) that every store branch and every IMS session talks to; also generates KHQR payment QR codes via Bakong.

Shared code lives under `packages/`:

- `packages/shared-types` — wire contracts (DTOs) shared across apps. Not a shared data-access layer — `pos` runs sql.js/SQLite locally, `backend` runs Prisma/Postgres, and those stay independent.
- `packages/api-client` — typed fetch wrapper used by `pos` and `ims` to talk to their respective backends.
- `packages/ui` — shared UI building blocks between `pos` and `ims`.

## Getting started

```sh
pnpm install
pnpm build
pnpm dev
```

Each app also needs its own local setup (databases, `.env`, seed data) before `pnpm dev` will actually work end-to-end — see `apps/backend/README.md`, `apps/pos/README.md`, and `apps/ims/README.md`.

## Other useful commands

```sh
pnpm lint        # apps/pos and apps/ims (apps/backend has no lint script)
pnpm typecheck   # apps/backend, packages/api-client, packages/shared-types
pnpm test        # apps/backend, against a real Postgres test database
```

CI (`.github/workflows/ci.yml`) runs `typecheck` + `test` against a Postgres service container on every push/PR to `main`. `apps/backend` and `apps/ims` each have a `Dockerfile` for containerized builds.

## Project status

The phased implementation plan in `docs/plan.md` (Phase 0 monorepo scaffold → Phase 6 hardening/ops) is fully implemented: auth, multi-branch catalog/stock/transfers/reporting, the POS↔backend outbox sync engine, KHQR payments, backup/restore, structured logging, CI, and Docker images. `docs/plan.md` is kept as a historical record of that build-out, not a live task list — there's no fixed roadmap of future phases; new work gets picked up as it's decided.
