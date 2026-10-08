const db = require('./db');

const SYNC_INTERVAL_MS = 20_000;
const PUSH_BATCH_SIZE = 50;
// A backend-rejected event (bad payload, a business-rule error) will fail the
// exact same way every retry — retrying forever just wastes a batch slot on
// every future tick. After this many explicit rejections, stop retrying it
// and mark it DEAD so it's excluded from the push query below; this is
// distinct from a network-level failure, which never increments retry_count
// at all (see the catch blocks below) since that's not the event's fault.
const MAX_RETRIES_BEFORE_DEAD = 5;

function authHeaders(config) {
  return { 'X-Terminal-Id': config.terminalId, 'X-Terminal-Secret': config.deviceSecret };
}

async function pushPending(config) {
  const rows = db.query(
    "SELECT * FROM outbox_events WHERE status IN ('PENDING', 'FAILED') ORDER BY sequence_no ASC LIMIT ?",
    [PUSH_BATCH_SIZE]
  );
  if (rows.length === 0) return;

  const events = rows.map((row) => ({
    eventId: row.event_id,
    terminalId: config.terminalId,
    sequenceNo: row.sequence_no,
    eventType: row.event_type,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
  }));

  let response;
  try {
    response = await fetch(`${config.backendUrl}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify({ events }),
    });
  } catch (err) {
    console.error('[sync] push request failed:', err.message);
    return;
  }

  if (!response.ok) {
    console.error('[sync] push rejected with status', response.status);
    return;
  }

  const { results } = await response.json();
  const byEventId = new Map(results.map((r) => [r.eventId, r]));

  for (const row of rows) {
    const result = byEventId.get(row.event_id);
    if (!result) continue;

    if (result.status === 'applied' || result.status === 'duplicate') {
      db.run("UPDATE outbox_events SET status = 'ACKED' WHERE id = ?", [row.id]);
    } else {
      const nextRetryCount = row.retry_count + 1;
      const nextStatus = nextRetryCount >= MAX_RETRIES_BEFORE_DEAD ? 'DEAD' : 'FAILED';
      db.run(
        'UPDATE outbox_events SET status = ?, retry_count = ?, last_error = ? WHERE id = ?',
        [nextStatus, nextRetryCount, result.error || 'Unknown error', row.id]
      );
      if (nextStatus === 'DEAD') {
        console.error(`[sync] event ${row.event_id} rejected ${nextRetryCount} times, giving up:`, result.error);
      }
    }
  }
  db.saveDb();
}

/**
 * Match by backend_product_id first (already linked from an earlier pull),
 * then by barcode -- even if the row is linked to another backend id. That
 * covers a product that pre-dates pairing and a register re-paired to a
 * different backend/store, whose rows still carry the old ids; inserting a
 * second row there fails on the unique barcode. Barcodes are unique on the
 * backend too, so a barcode match is the same product.
 */
function upsertProduct(item) {
  const existing =
    db.query('SELECT id FROM products WHERE backend_product_id = ?', [item.productId])[0] ??
    (item.barcode ? db.query('SELECT id FROM products WHERE barcode = ?', [item.barcode])[0] : undefined);

  const price = item.priceOverride ?? item.defaultPrice;
  // The price is in the product's own currency (a riel catalog sends
  // 22000 = 22,000 ៛). Without it a new row would default to USD and sell
  // at $22,000. Older backends don't send it; keep what the row has then.
  const currency = item.currency === 'KHR' || item.currency === 'USD' ? item.currency : null;
  const now = db.localNow();

  if (existing) {
    db.run(
      'UPDATE products SET name = ?, barcode = ?, price = ?, currency = COALESCE(?, currency), stock = ?, is_deleted = ?, backend_product_id = ?, updated_at = ? WHERE id = ?',
      [item.name, item.barcode, price, currency, item.stock, item.isDeleted ? 1 : 0, item.productId, now, existing.id]
    );
  } else {
    db.run(
      'INSERT INTO products (name, barcode, price, currency, stock, is_deleted, backend_product_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [item.name, item.barcode, price, currency ?? 'USD', item.stock, item.isDeleted ? 1 : 0, item.productId, now, now]
    );
  }
}

/**
 * Pulled orders mirror the whole store, not just this register's own sales --
 * matched by client_order_uuid, the same idempotency key push already uses,
 * so a sale this register rang up itself (already inserted at checkout) is
 * updated in place (picking up e.g. a void from another register or IMS)
 * instead of being duplicated.
 */
function upsertOrder(config, item) {
  const existing = db.query('SELECT id FROM orders WHERE client_order_uuid = ?', [item.clientOrderUuid])[0];
  // The backend's `status`/`isDeleted` both mean "hide this from the list" --
  // mapped onto the one flag the existing local queries already filter on.
  const isDeleted = item.isDeleted || item.status === 'VOIDED' ? 1 : 0;
  const isOwn = item.terminalId === config.terminalId;
  const createdAt = db.toLocalSql(new Date(item.createdAt));
  const updatedAt = db.toLocalSql(new Date(item.updatedAt));

  if (existing) {
    db.run(
      'UPDATE orders SET status = ?, is_deleted = ?, cashier_user_id = ?, terminal_id = ?, terminal_name = ?, updated_at = ? WHERE id = ?',
      [item.status, isDeleted, item.cashierUserId, item.terminalId, isOwn ? null : item.terminalName, updatedAt, existing.id]
    );
    return;
  }

  const orderId = db.run(
    `INSERT INTO orders
      (cashier_user_id, total_amount, currency, payment_method, bank_name, amount_paid_usd, amount_paid_khr, change_given_khr, status, is_deleted, client_order_uuid, terminal_id, terminal_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.cashierUserId,
      item.total,
      item.currency,
      item.paymentMethod,
      item.bankName,
      item.amountPaidUsd,
      item.amountPaidKhr,
      item.changeGivenKhr,
      item.status,
      isDeleted,
      item.clientOrderUuid,
      item.terminalId,
      isOwn ? null : item.terminalName,
      createdAt,
      updatedAt,
    ]
  );

  for (const line of item.items) {
    // Pulled items reference the backend's product id -- resolve to this
    // register's local row the same way a sale's own items do at checkout.
    const product = db.query('SELECT id FROM products WHERE backend_product_id = ?', [line.productId])[0];
    db.run(
      'INSERT INTO order_items (order_id, product_id, quantity, price_at_sale, discount, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [orderId, product?.id ?? null, line.quantity, line.priceAtSale, line.discount, line.currency, createdAt, updatedAt]
    );
  }
}

// Products synced before the backend sent each price's currency were stored
// with the local default, USD -- so a 3,000 ៛ product sold as $3,000. Sync
// only re-sends changed products, so those rows never got corrected. Once,
// pull the whole catalog again; it only counts as done when the backend
// actually sent currencies (an older backend gets retried next app start,
// not on every 20s tick).
const CURRENCY_RESYNC_MARKER = 'catalog_resync_currency_v1';
let currencyResyncTriedThisRun = false;

/**
 * Pulls catalog changes since the last pull. `full: true` ignores the cursor
 * and pulls everything (Settings > Backend Sync > Resync everything).
 * Returns how many products came down.
 */
async function pullCatalogImpl(config, { full = false } = {}) {
  const cursor = db.query("SELECT value FROM sync_state WHERE key = 'pull_cursor'")[0]?.value;
  const currencyResync =
    !currencyResyncTriedThisRun && !db.query('SELECT 1 FROM sync_state WHERE key = ?', [CURRENCY_RESYNC_MARKER]).length;
  if (currencyResync) currencyResyncTriedThisRun = true;
  const fullPull = full || currencyResync;
  // Join like push does: new URL('/api/...', base) would drop any base subpath.
  const url = new URL(`${config.backendUrl}/api/sync/pull`);
  if (cursor && !fullPull) url.searchParams.set('since', cursor);

  let response;
  try {
    response = await fetch(url, { headers: authHeaders(config) });
  } catch (err) {
    // Thrown (not logged-and-returned, unlike pushPending above) so a direct,
    // awaited caller -- the first-run pairing screen's /api/sync/now -- can
    // surface *why* pairing failed instead of the operator just seeing a
    // PIN screen that can never work. The scheduled tick() below still only
    // logs this, via its own catch in start().
    throw new Error(`Could not reach ${config.backendUrl}: ${err.message}`, { cause: err });
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid terminal ID or device secret.');
    }
    throw new Error(`Backend rejected the request (status ${response.status}).`);
  }

  const { cursor: newCursor, productUpserts, staffRoster, storeSettings, orderUpserts } = await response.json();

  // One product failing (it used to abort the whole pull) mustn't block the
  // rest, staff, or store settings. Failures keep the cursor where it is so
  // they're retried next pull; everything else is saved now.
  const productErrors = [];
  for (const item of productUpserts) {
    try {
      upsertProduct(item);
    } catch (err) {
      productErrors.push(`${item.barcode || item.name}: ${err.message}`);
    }
  }

  // Same "don't let one bad row block the cursor" treatment as products.
  const orderErrors = [];
  for (const item of orderUpserts ?? []) {
    try {
      upsertOrder(config, item);
    } catch (err) {
      orderErrors.push(`${item.clientOrderUuid}: ${err.message}`);
    }
  }

  // Cached so PIN unlock (auth.routes.js) can verify a cashier fully offline —
  // upserted by userId, same shape as the products loop above. isActive isn't
  // filtered out by the backend, so a deactivation/PIN-reset arrives as a row
  // update here rather than silently never showing up.
  for (const staff of staffRoster ?? []) {
    db.run(
      `INSERT INTO staff_pins (user_id, name, role, pin_hash, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, role = excluded.role,
         pin_hash = excluded.pin_hash, is_active = excluded.is_active, updated_at = excluded.updated_at`,
      [staff.userId, staff.name, staff.role, staff.pinHash, staff.isActive ? 1 : 0, db.localNow()]
    );
  }

  // Only these come from IMS. Shop name, address, phone, image and Bakong
  // details are per register, set in POS Settings (issue #5) -- ignored here
  // even if an older backend still sends them. null = not set in IMS.
  const IMS_MANAGED_SETTINGS = {
    main_currency: storeSettings?.mainCurrency,
    locale: storeSettings?.locale,
    exchange_rate: storeSettings?.exchangeRate,
  };
  for (const [key, value] of Object.entries(IMS_MANAGED_SETTINGS)) {
    if (value == null) continue;
    db.run(
      'INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    );
  }

  if (productErrors.length === 0 && orderErrors.length === 0) {
    db.run(
      "INSERT INTO sync_state (key, value) VALUES ('pull_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [newCursor]
    );
  }
  db.saveDb();

  if (productErrors.length > 0 || orderErrors.length > 0) {
    const parts = [];
    if (productErrors.length > 0) parts.push(`${productErrors.length} product(s): ${productErrors[0]}`);
    if (orderErrors.length > 0) parts.push(`${orderErrors.length} order(s): ${orderErrors[0]}`);
    throw new Error(`Couldn't save everything, will retry: ${parts.join('; ')}`);
  }

  if (fullPull && productUpserts.every((item) => item.currency === 'KHR' || item.currency === 'USD')) {
    db.run("INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
      CURRENCY_RESYNC_MARKER,
      db.localNow(),
    ]);
    db.saveDb();
  }
  return productUpserts.length;
}

// Tracks whether the background pull is actually keeping up, for screens
// that now read the local store-wide order mirror (Order History, Daily
// Summary) instead of calling the backend live -- they still need to tell a
// cashier when that mirror might be behind. Wraps pullCatalogImpl (rather
// than living inside tick() below) so it reflects ANY successful pull --
// the scheduled tick, a manual "sync now", or a full resync -- not just the
// scheduled one.
let lastPullAt = null;
let lastPullError = null;

async function pullCatalog(config, opts) {
  try {
    const result = await pullCatalogImpl(config, opts);
    lastPullAt = Date.now();
    lastPullError = null;
    return result;
  } catch (err) {
    lastPullError = err.message;
    throw err;
  }
}

async function tick() {
  const config = db.getSyncConfig();
  if (!config) return; // Not paired yet — nothing to do.

  // Push before pull: a terminal's own just-made sales should be reflected
  // before it refreshes its catalog view.
  await pushPending(config);
  await pullCatalog(config);
}

function start() {
  const run = () => {
    tick().catch((err) => console.error('[sync] tick failed:', err.message));
  };
  run();
  setInterval(run, SYNC_INTERVAL_MS);
}

/**
 * `offline: true` means paired but the background pull isn't keeping up --
 * the local order/product mirror these screens read may be behind. A single
 * missed tick can be a blip; two in a row (double the normal interval) means
 * something's actually wrong, not just one slow request.
 */
function getStatus() {
  const config = db.getSyncConfig();
  if (!config) return { paired: false, offline: false };
  const stale = Boolean(lastPullError) || !lastPullAt || Date.now() - lastPullAt > SYNC_INTERVAL_MS * 2;
  return { paired: true, offline: stale };
}

module.exports = { start, tick, pullCatalog, pushPending, authHeaders, getStatus };
