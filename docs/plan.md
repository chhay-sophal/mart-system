# Mart System: Implementation Plan

## Context

The current `online-pos` repo is a single-store, single-user Tauri desktop POS (React/Vite frontend + one 674-line Express file + sql.js/SQLite, no auth, no multi-tenant concept). The goal is to grow this into a mini-mart chain management system with three independently deployable pieces — **pos** (offline-capable cashier terminal), **ims** (back-office inventory/purchasing web app), **backend** (central multi-store API) — because the target shape (multiple stores, shared catalog, staff roles, network-based sync) is architecturally incompatible with today's single-process desktop app. Rather than retrofit sql.js/no-auth/single-file-server into that shape, this plan starts a new pnpm+Turborepo monorepo (`mart-system`) and ports the still-valid pieces of the existing app (KHQR payment integration, backup routines, Excel import/export logic, the Tauri sidecar packaging pattern) while redesigning the parts that don't survive the jump (checkout transaction safety, stock mutation model, auth — which doesn't exist today at all).

Confirmed product decisions driving the design below:
- POS must work fully offline; a network outage must never block a sale.
- Multi-store support is designed in from day one (not retrofitted later).
- Cashier auth is **shared terminal device credential + per-cashier PIN** (fast at the register), not full login per shift.
- Stock conflicts during offline sales are resolved by **never blocking checkout** — stock can go negative and is reconciled after the fact via a report, not prevented at sale time.

## Target repo shape

```
mart-system/
├── apps/
│   ├── pos/            # Tauri desktop cashier terminal (offline-first)
│   │   ├── src/                 # React UI (ported from online-pos/frontend)
│   │   ├── src-tauri/           # Rust shell + sidecar spawn (ported from online-pos/src-tauri)
│   │   └── sidecar/             # Express + sql.js local server (ported from backend-desktop/server.js)
│   ├── ims/             # React/Vite web app, always-online, talks to backend
│   └── backend/         # Express (modularized) + Prisma + Postgres, multi-store source of truth
├── packages/
│   ├── shared-types/    # Wire contracts only (Product, Order, OutboxEvent, sync DTOs) — NOT shared DB/query code
│   ├── api-client/      # Typed fetch wrapper: base URL injection, auth headers, retry-on-failure for sync push
│   └── ui/              # Shared components if pos/ims should look related
├── pnpm-workspace.yaml
└── turbo.json
```

`packages/shared-types` stays contracts-only: `pos`'s sidecar runs sql.js/SQLite, `backend` runs Prisma/Postgres — different engines, different transaction models, don't try to unify the data-access layer even though both handle "orders/products."

## Phase 0 — Monorepo scaffolding (~2-3 days)

- Set up pnpm workspaces + Turborepo with the shape above; CI runs lint/build/typecheck via Turborepo pipelines.
- Build `packages/api-client` now (typed wrapper, centralized error handling) so neither `pos` nor `ims` repeats the current app's pattern of raw `fetch()` + ad-hoc `try/catch`/`alert()` everywhere (`frontend/src/App.jsx`, `StockManager.jsx`).
- **Spike the sidecar build inside the monorepo immediately**: `backend-desktop`'s `@yao-pkg/pkg` packaging + `rename-sidecars.js` step has to keep working against pnpm's hoisted `node_modules` layout. This is cheap to validate now, expensive to discover in Phase 6.

## Phase 1 — Backend core: schema, auth, single-store CRUD (~1-2 weeks)

Goal: a working, testable API for one store — no POS/IMS UI required yet.

- Postgres + Prisma schema (full model list below), migrations, seed script (one Store, one admin user, ~20 demo products).
- Auth: JWT access+refresh tokens for admin/back-office login (IMS); separate **device credential** issued to a `Terminal` at pairing time, plus a `POST /api/auth/pin-login` that checks a cashier PIN against a `UserStoreRole` scoped to that store and returns a short-lived session token for the shift.
- Role middleware: `requireRole(storeId, [...roles])` driven by `UserStoreRole`.
- Product CRUD + bulk import (adapt `server.js:165-204`'s bulk-upsert-by-barcode logic, now store-scoped and wrapped in a Prisma transaction).
- Per-store settings endpoints (replacing the single global `store_settings` table).
- Express modularized: `apps/backend/src/modules/{auth,stores,products,inventory,orders,payments,sync}` instead of one file.

## Phase 2 (parallel with Phase 1) — POS offline core: port to feature parity (~1-2 weeks)

Does not depend on the backend at all — a lift of the existing app into the new shape, offline-only for now.

- Move `src-tauri` + the sidecar-spawn pattern (`src-tauri/src/lib.rs`: spawns the Express+sql.js binary via `shell.sidecar`, reads the port off stdout, kills it on window destroy) into `apps/pos/src-tauri` essentially verbatim.
- Move `backend-desktop/server.js` into `apps/pos/sidecar`, modularized, keeping the existing schema (products/orders/order_items/store_settings/khqr_transactions) plus two new local-only tables: `outbox_events` and `sync_state` (Phase 4).
- **Fix now, while isolated**: wrap checkout (today `server.js:241-277` — sequential `run()` calls, no `BEGIN/COMMIT`, no stock check) in an explicit sql.js transaction, and generate a `client_order_uuid` at insert time so the schema doesn't churn again when sync is added in Phase 4.
- Add PIN-entry screen (checks against a locally cached PIN table, synced down from backend once online — falls back to "any known PIN from last sync" if never-yet-online, an edge case to flag for first-run setup UX).
- Port UI: cart/checkout flow, Invoice, CustomerDisplay, DailySummary, SalesHistory, `locales.js`, wired to `packages/api-client` instead of raw `fetch`.
- Result: a fully offline-capable POS at parity with today's app, demoable, with zero backend dependency yet — de-risks the Tauri/sidecar move before sync is layered on.

## Phase 3 — IMS MVP against backend (~1-2 weeks, starts once Phase 1 has products/auth)

- Login (JWT), store switcher for admins with multi-store access.
- Product/stock CRUD + low-stock view, feature-parity with `StockManager.jsx`.
- **Port near-verbatim**: the Excel/CSV auto column-mapping and `xlsx` read/write/export logic from `StockManager.jsx` — only the submission target changes (backend's bulk endpoint, now with `storeId`).
- Staff management (create users, assign `UserStoreRole`, set/reset cashier PINs).
- Terminal pairing screen (generates the device credential a new POS terminal uses to register itself).
- End of Phase 3: a working single-store demo — IMS manages the catalog/stock centrally, POS sells offline against its own local copy, but the two aren't talking yet.

## Phase 4 — Outbox/sync engine (~2-3 weeks) — the hard integration milestone

**Core principle:** stock moves POS→backend as a *delta*, never an absolute value. Deltas commute, so multiple terminals can apply them out of order without clobbering each other — no CRDT/vector-clock machinery needed.

**POS-local `outbox_events` table:**
```
id            INTEGER PRIMARY KEY AUTOINCREMENT
event_id      TEXT UNIQUE        -- client-generated UUID v4, the idempotency key
terminal_id   TEXT               -- assigned at pairing
sequence_no   INTEGER            -- monotonic per terminal
event_type    TEXT               -- 'SALE_COMPLETED' | 'SALE_VOIDED'
payload       TEXT (JSON)        -- client_order_uuid, line items, payment method/amounts, khqr md5_hash if any
created_at    TEXT               -- local clock, display-ordering hint only
status        TEXT               -- PENDING | SENDING | ACKED | FAILED
retry_count   INTEGER
last_error    TEXT
```
Catalog/price changes only ever flow backend/IMS → POS, never the other way.

**Push** (`POST /api/sync/push { terminal_id, store_id, events: [] }`, batched ~50/request): each event applied in its own transaction; `sync_events.event_id` unique with `ON CONFLICT DO NOTHING` — zero rows inserted means already-applied, respond `duplicate`, POS marks ACKED and stops retrying. This makes retry-after-lost-ack safe.

**Applying `SALE_COMPLETED`:** create `Order`+`OrderItem`s keyed by `client_order_uuid`, then per line item write a `StockMovement(delta=-qty, reason='SALE', sourceEventId=event_id)` and update `StoreProduct.stock` by the same delta, all in one transaction. Never reject for insufficient stock at ingestion — the goods already left the store; let it go negative, it's a reportable state (Phase 5 reconciliation report). Per the confirmed decision, POS may show a low-stock warning from its cached count but never blocks checkout on it.

**Pull** (`GET /api/sync/pull?store_id=&since=<cursor>`): POS pushes pending outbox before pulling, so its own sales reflect first. Response is backend-authoritative and absolute (product upserts/deletes, price/override changes, current `StoreProduct.stock`) since backend is the single writer of catalog truth. POS overwrites its local product/price/stock cache; local order history is untouched.

**Explicit reconciliation semantics** (confirm these read-backs match expectations once built, they're product behavior, not just internals):
- Price changed centrally while POS offline → already-rung sales keep the old cached price (correct, no retroactive change).
- Product deleted centrally while POS offline → POS may still sell from stale cache; flagged afterward via the same negative-stock-style report, not rejected.
- `sequence_no` + `sync_cursors(terminal_id, last_applied_seq)` are for gap detection/monitoring only (e.g., "terminal reset its local DB") — stock correctness never depends on cross-terminal ordering, only on deltas being applied.

## Phase 5 — Multi-store depth (~1-2 weeks)

- Inter-store stock transfers (IMS UI + `StockTransfer`/`StockTransferItem` + `StockMovement` rows written at both ends on completion).
- Per-store pricing overrides, editable in IMS, picked up by POS on next pull.
- Cross-store reporting in IMS (expand the daily-summary logic from `server.js:495-550`).
- Negative-stock reconciliation report (surfaces `StockMovement` rows that drove `StoreProduct.stock` negative, for a manager to resolve).

## Phase 6 — Hardening & ops (~1-2 weeks, can overlap Phase 5)

- Backup: port `createBackup`/list/export/restore (`server.js:427-616`) into `apps/pos/sidecar` largely as-is — still valuable for a desktop terminal's local SQLite. Backend gets its own Postgres backup story (managed service / `pg_dump`), not shared code.
- Structured logging, sync-failure alerting, terminal "last seen" view in IMS.
- Tauri auto-update for `pos` (updater plugin already in use today), deploy pipeline for `ims`/`backend`.
- Perf check on sql.js `saveDb()` (full DB export+rewrite per write) against months of local order history; add pruning/archival of already-synced local orders if needed.

## Multi-store Prisma schema (core models)

- **Store**: id, name, code, address, phone, timezone, isActive.
- **User**: id, email, passwordHash, name, isActive, isSuperAdmin?.
- **UserStoreRole**: (userId, storeId, role: CASHIER|INVENTORY|ADMIN), pinHash — one person can hold different roles at different stores; PIN is scoped per store assignment.
- **Terminal**: id (uuid), storeId, name, deviceCredentialHash, pairedAt, lastSeenAt, isActive.
- **Product** (chain-wide catalog): id, barcode (unique), name, category, defaultPrice, currency, isDeleted, timestamps.
- **StoreProduct**: id, storeId, productId, stock (materialized), priceOverride?, costPrice, currency, lowStockThreshold, unique(storeId, productId).
- **StockMovement**: id, storeId, productId, terminalId?, delta, reason (SALE|VOID|RECEIVE_PURCHASE|TRANSFER_IN|TRANSFER_OUT|ADJUSTMENT|STOCKTAKE), refType/refId, sourceEventId?, createdAt — append-only ledger; `StoreProduct.stock` is a derived cache kept in sync transactionally.
- **Order**: id, storeId, terminalId, clientOrderUuid (unique), customerId?, totalAmount, currency, paymentMethod, bankName?, amountPaidUsd, amountPaidKhr, changeGivenKhr, status, createdAt (client ts), syncedAt (server ts), isDeleted.
- **OrderItem**: id, orderId, productId, quantity, priceAtSale, currency.
- **PaymentTransaction** (KHQR): id, orderId, md5Hash (unique), qrString, bankName, currency, amount, status, timestamps — mirrors `khqr_transactions` field-for-field.
- **SyncEvent**: id, eventId (unique), terminalId, storeId, eventType, sequenceNo, payload (JSON), status, appliedAt, resultOrderId? — idempotency/audit log.
- **SyncCursor**: terminalId (pk), lastAppliedSeq.
- **StoreSetting**: storeId, key, value — replaces the global `store_settings` table (Bakong merchant info, exchange rate, locale, cloud backup folder — per store).
- **StockTransfer** / **StockTransferItem**: fromStoreId, toStoreId, status, requestedBy, items.

## Port vs. redesign

**Port nearly as-is:**
- KHQR generation + status polling incl. 401-triggered token renewal (`server.js:314-425`, uses `bakong-khqr`) → `apps/backend/src/modules/payments`, parametrized by `storeId` instead of global settings, sql.js queries swapped for Prisma calls. Frontend's 3s poll pattern (`App.jsx:293-306`) carries over to `apps/pos`.
- Backup create/list/export/restore (`server.js:427-616`) → `apps/pos/sidecar`, verbatim.
- Excel/CSV auto column-mapping + `xlsx` import/export (`StockManager.jsx`) → `apps/ims`, submission target swapped to backend's bulk endpoint.
- Tauri sidecar-spawn architecture (`src-tauri/src/lib.rs`, `tauri.conf.json`, `@yao-pkg/pkg` build + `rename-sidecars.js`) → reused wholesale for `apps/pos`.
- Cart/checkout UI, Invoice/CustomerDisplay/DailySummary/SalesHistory, `locales.js` → ported, rewired to `packages/api-client`.

**Must be redesigned:**
- Checkout transaction safety: no `BEGIN/COMMIT`, no stock check today → explicit transaction (sql.js side) / `$transaction` (Prisma side); negative stock becomes a visible reportable signal instead of a silent race, per the confirmed no-block decision.
- Stock mutation model: direct `UPDATE products SET stock = stock - x` → append-only `StockMovement` ledger with `StoreProduct.stock` as a derived cache, to make concurrent multi-terminal/multi-store writes safe.
- Auth: 100% new — JWT for back-office, device credential + cashier PIN for terminals, per-store role middleware.
- Data layer: sql.js/raw-SQL schema (backend side only — POS keeps sql.js) → Prisma/Postgres, every table gains `storeId` scoping.
- Settings: single global `store_settings` → per-store `StoreSetting`; ops-level secrets (Bakong registered email) move to backend env/secrets manager rather than a queryable table now that it's a shared multi-tenant server.

## Risks to validate early

1. **Bakong multi-merchant token model** — confirm whether the Bakong Open API cleanly supports independent tokens per store's registered email before finalizing the per-store `PaymentTransaction`/token-cache design (today's code assumes one global token).
2. **Terminal device credential lifetime** — a terminal offline for weeks still needs to authenticate its sync push on reconnect; decide long-lived device API key vs. a refresh scheme that tolerates long dormancy before Phase 4.
3. **pkg + pnpm/Turborepo interaction** — validate in Phase 0, not Phase 6.
4. **sql.js scaling** on the POS terminal as local order history grows — confirm acceptable, plan pruning if not.

## Verification approach

- **Phase 1**: Postman/curl or an integration test suite hitting the backend directly — auth flows (JWT login, PIN login, device credential), product CRUD, role-gating — before any UI exists.
- **Phase 2**: run `apps/pos` standalone (no backend), full offline checkout flow end-to-end in the Tauri dev shell — ring up a sale, confirm stock decrements atomically, confirm KHQR QR still generates against the existing local flow until Phase 4 moves it to backend.
- **Phase 3**: run `apps/ims` against the Phase 1 backend — login, manage products, bulk import an Excel file, confirm it lands correctly in Postgres.
- **Phase 4**: the critical test — run two POS terminals against one backend, take one offline, sell overlapping stock on both, bring it back online, confirm: no crash, no lost sales, stock reflects net deltas (possibly negative), sync_events show no duplicates applied on retry.
- **Phase 5-6**: manual QA of transfers/reporting in IMS; verify Tauri auto-update and backend deploy pipelines end-to-end in a staging environment before rollout.
