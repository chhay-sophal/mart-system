# @mart-system/backend

Central API (Express + Prisma + Turso/libSQL) for a single organization's whole chain of store branches — auth (JWT login/refresh, cashier PIN login gated by a terminal device credential), staff/roles, terminal pairing, store-scoped product CRUD + bulk import + per-store price overrides, inter-store stock transfers, cross-store reporting/reconciliation, per-store settings, Bakong KHQR payment generation, and the outbox/pull sync endpoints each POS terminal talks to. See [docs/plan.md](../../docs/plan.md) for the phased plan this was originally built against (now fully implemented — kept as a historical record, not a live task list).

Runs on [Turso](https://turso.tech) (a hosted libSQL/SQLite-family database) rather than Postgres — chosen for its usage-based free tier, which fits this system's frequent small polling (the POS sync loop) far better than a compute-hours-awake billing model would. Money fields are stored as integers in each currency's smallest unit (cents for USD, whole Riel for KHR) rather than `Decimal`, since SQLite has no native fixed-point decimal type — see `src/lib/money.ts`.

## Setup

1. Copy `.env.example` to `.env` (generate your own `JWT_SECRET`).
2. Run migrations and seed data — no service to start first, this creates a local `prisma/dev.db` file directly:
   ```sh
   pnpm db:migrate
   pnpm db:seed
   ```
   The seed script prints a dev-only terminal device secret and the seeded admin's email/password/PIN once — save it, it isn't recoverable afterward.
3. Start the API:
   ```sh
   pnpm dev
   ```

### Creating a real admin (not a seed)

`pnpm db:seed` is dev-only — it hardcodes a known admin password and a terminal secret literally named `dev-terminal-secret-do-not-use-in-prod`, plus 21 fake products. Never run it against a real database. For a real deployment's first store/admin, use `pnpm create-admin` instead — this is a separate, ordinary script (not part of the Prisma seed mechanism, so it can't be triggered accidentally by `prisma db seed`/`migrate reset`, and it's obvious at a glance that it's not a "seed"). It prompts interactively for the store name/code and admin email/name — no env vars to set up front:

```sh
pnpm create-admin
```
```
Store name: My Store
Store code: MAIN
Admin email: owner@example.com
Admin name: Owner Name
```

It creates exactly one store and one admin — no demo data, no demo terminal (pair real terminals through IMS's own pairing flow afterward) — with a randomly generated password and PIN printed once. Safe to re-run: if the admin email already exists, it leaves their credentials untouched instead of regenerating/reprinting them; run it again with a different admin email to add another admin, or a different store code to add another store.

For a real deployment, point `DATABASE_URL` at a real Turso database (`libsql://<db>.turso.io`) and set `TURSO_AUTH_TOKEN` — see `src/env.ts`. `prisma migrate dev`/`deploy` can't be used against it at all (they refuse to even validate a non-`file:` URL) — generate the migration locally as usual (`pnpm db:migrate`, against a local file), then apply it to the real database with:

```sh
pnpm db:migrate:turso
```

This runs `scripts/apply-turso-migrations.mjs`, which applies any `prisma/migrations/*/migration.sql` not yet recorded in its own `_manual_migrations` tracking table directly via `@libsql/client` — safe to re-run, it skips whatever's already applied.

## Testing

Tests run against a local sqlite file (`.env.test` → `DATABASE_URL=file:./test.db`) through the same Prisma+libSQL adapter used in production, not mocked Prisma:

```sh
pnpm test
```

## Auth model

- **Back-office (IMS)**: `POST /api/auth/login` (email/password) → short-lived access token + rotating refresh token.
- **Cashier terminal**: requests to `/api/auth/pin-login` must carry `X-Terminal-Id`/`X-Terminal-Secret` headers (issued once at terminal pairing) *and* a valid PIN in the body — the device credential is checked first, so PIN attempts from anything that isn't a paired terminal are rejected before the PIN is even looked at.
