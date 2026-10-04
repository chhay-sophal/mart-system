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

async function pullCatalog(config) {
  const cursor = db.query("SELECT value FROM sync_state WHERE key = 'pull_cursor'")[0]?.value;
  // Join like push does: new URL('/api/...', base) would drop any base subpath.
  const url = new URL(`${config.backendUrl}/api/sync/pull`);
  if (cursor) url.searchParams.set('since', cursor);
  // Which store icon we have, so the backend re-sends it whenever it differs
  // ("" = none yet). Keyed on version, not the cursor, so an icon missed by an
  // older build that didn't apply icons still arrives.
  const iconVersion = db.query("SELECT value FROM sync_state WHERE key = 'store_icon_version'")[0]?.value ?? '';
  url.searchParams.set('icon_version', iconVersion);

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

  const { cursor: newCursor, productUpserts, staffRoster, storeSettings } = await response.json();

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

  // IMS owns these once paired (Settings shows them read-only). null means
  // IMS never set it, so keep the terminal's local value.
  const IMS_MANAGED_SETTINGS = {
    store_name: storeSettings?.storeName,
    store_address: storeSettings?.storeAddress,
    store_phone: storeSettings?.storePhone,
    main_currency: storeSettings?.mainCurrency,
    locale: storeSettings?.locale,
    exchange_rate: storeSettings?.exchangeRate,
    // Only present when it differs from our icon_version; "" means removed in IMS.
    store_icon: storeSettings?.storeIcon,
  };
  for (const [key, value] of Object.entries(IMS_MANAGED_SETTINGS)) {
    if (value == null) continue;
    db.run(
      'INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    );
  }
  // Record the version only alongside the icon it belongs to.
  if (storeSettings?.storeIcon != null && storeSettings.storeIconVersion) {
    db.run(
      "INSERT INTO sync_state (key, value) VALUES ('store_icon_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [storeSettings.storeIconVersion]
    );
  }

  if (productErrors.length === 0) {
    db.run(
      "INSERT INTO sync_state (key, value) VALUES ('pull_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [newCursor]
    );
  }
  db.saveDb();

  if (productErrors.length > 0) {
    throw new Error(`${productErrors.length} product(s) couldn't be saved and will be retried: ${productErrors[0]}`);
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

module.exports = { start, tick, pullCatalog, pushPending, authHeaders };
