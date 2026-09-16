# @mart-system/backend

Central multi-store API (Express + Prisma + Postgres). Phase 1 scope: auth (JWT login, refresh rotation, cashier PIN login gated by a terminal device credential), store-scoped product CRUD + bulk import, per-store settings. See [docs/plan.md](../../docs/plan.md) for the full phased plan.

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
