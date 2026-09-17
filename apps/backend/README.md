# @mart-system/backend

Central API (Express + Prisma + Postgres) for a single organization's whole chain of store branches — auth (JWT login/refresh, cashier PIN login gated by a terminal device credential), staff/roles, terminal pairing, store-scoped product CRUD + bulk import + per-store price overrides, inter-store stock transfers, cross-store reporting/reconciliation, per-store settings, Bakong KHQR payment generation, and the outbox/pull sync endpoints each POS terminal talks to. See [docs/plan.md](../../docs/plan.md) for the phased plan this was originally built against (now fully implemented — kept as a historical record, not a live task list).

## Setup

1. Copy `.env.example` to `.env` (already done for local dev — see committed `.env` if this is a fresh clone of someone else's machine, otherwise generate your own `JWT_SECRET`).
2. Start Postgres + Adminer:
   ```sh
   docker compose up -d
   ```
3. Create the test database (one-time, same container):
   ```sh
   docker compose exec postgres createdb -U mart mart_system_test
   ```
4. Run migrations and seed data:
   ```sh
   pnpm db:migrate
   pnpm db:seed
   ```
   The seed script prints a dev-only terminal device secret and the seeded admin's email/password/PIN once — save it, it isn't recoverable afterward.
5. Start the API:
   ```sh
   pnpm dev
   ```

Adminer (DB GUI) is at http://localhost:8080 (system: PostgreSQL, server: `postgres`, user/password: `mart`/`mart`).

## Testing

Tests run against the real `mart_system_test` database (`.env.test`), not mocked Prisma:

```sh
pnpm test
```

## Auth model

- **Back-office (IMS)**: `POST /api/auth/login` (email/password) → short-lived access token + rotating refresh token.
- **Cashier terminal**: requests to `/api/auth/pin-login` must carry `X-Terminal-Id`/`X-Terminal-Secret` headers (issued once at terminal pairing) *and* a valid PIN in the body — the device credential is checked first, so PIN attempts from anything that isn't a paired terminal are rejected before the PIN is even looked at.
