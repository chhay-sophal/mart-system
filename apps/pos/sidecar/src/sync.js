const db = require('./db');

const SYNC_INTERVAL_MS = 20_000;
const PUSH_BATCH_SIZE = 50;

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
      db.run(
        "UPDATE outbox_events SET status = 'FAILED', retry_count = retry_count + 1, last_error = ? WHERE id = ?",
        [result.error || 'Unknown error', row.id]
      );
    }
  }
  db.saveDb();
}

async function pullCatalog(config) {
  const cursor = db.query("SELECT value FROM sync_state WHERE key = 'pull_cursor'")[0]?.value;
  const url = new URL('/api/sync/pull', config.backendUrl);
  if (cursor) url.searchParams.set('since', cursor);

  let response;
  try {
    response = await fetch(url, { headers: authHeaders(config) });
  } catch (err) {
    console.error('[sync] pull request failed:', err.message);
    return;
  }

  if (!response.ok) {
    console.error('[sync] pull rejected with status', response.status);
    return;
  }

  const { cursor: newCursor, productUpserts, staffRoster } = await response.json();

  for (const item of productUpserts) {
    // Match by backend_product_id first (already linked from an earlier
    // pull); fall back to barcode for a product that pre-dates pairing.
    const existing =
      db.query('SELECT id FROM products WHERE backend_product_id = ?', [item.productId])[0] ??
      (item.barcode
        ? db.query('SELECT id FROM products WHERE barcode = ? AND backend_product_id IS NULL', [item.barcode])[0]
        : undefined);

    const price = item.priceOverride ?? item.defaultPrice;
    const now = db.localNow();

    if (existing) {
      db.run(
        'UPDATE products SET name = ?, barcode = ?, price = ?, stock = ?, is_deleted = ?, backend_product_id = ?, updated_at = ? WHERE id = ?',
        [item.name, item.barcode, price, item.stock, item.isDeleted ? 1 : 0, item.productId, now, existing.id]
      );
    } else {
      db.run(
        'INSERT INTO products (name, barcode, price, stock, is_deleted, backend_product_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [item.name, item.barcode, price, item.stock, item.isDeleted ? 1 : 0, item.productId, now, now]
      );
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

  db.run(
    "INSERT INTO sync_state (key, value) VALUES ('pull_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [newCursor]
  );
  db.saveDb();
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

module.exports = { start, tick };
