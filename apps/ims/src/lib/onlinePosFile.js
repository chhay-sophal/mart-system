// Reads an online-pos (backend-desktop/server.js) database.sqlite in the
// browser. Columns added by later online-pos migrations (cost_price,
// is_deleted, bank_name, ...) may be missing from older files, so every
// optional column falls back to a default.

const PRODUCT_COLUMNS = ['name', 'barcode', 'price', 'cost_price', 'currency', 'stock'];

// online-pos store_settings keys that IMS manages. Shop name, image, address,
// phone and Bakong details are set on each register instead (issue #5).
const SETTING_KEYS = ['main_currency', 'locale', 'exchange_rate'];

export async function openOnlinePosDb(buffer) {
  // Loaded on demand so the wasm only downloads for SQLite imports.
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  return new SQL.Database(new Uint8Array(buffer));
}

function columnsOf(db, table) {
  const info = db.exec(`PRAGMA table_info(${table})`)[0];
  return info ? info.values.map((r) => r[1]) : [];
}

function rowsOf(db, sql) {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((values) => Object.fromEntries(result.columns.map((c, i) => [c, values[i]])));
}

/** Active products, keyed by the same column names the spreadsheet import auto-detects. */
export function readProducts(db) {
  const columns = columnsOf(db, 'products');
  if (!columns.includes('name') || !columns.includes('price')) {
    throw new Error('This SQLite file has no online-pos products table.');
  }
  const selected = PRODUCT_COLUMNS.filter((c) => columns.includes(c));
  const where = columns.includes('is_deleted') ? 'WHERE is_deleted = 0' : '';
  const rows = rowsOf(db, `SELECT ${selected.join(', ')} FROM products ${where} ORDER BY id`).map((row) =>
    Object.fromEntries(selected.map((c) => [c, row[c] ?? '']))
  );
  const total = db.exec('SELECT COUNT(*) FROM products')[0].values[0][0];
  return { headers: selected, rows, deletedSkipped: total - rows.length };
}

/** The settings IMS has a home for; empty values left out. */
export function readSettings(db) {
  if (!columnsOf(db, 'store_settings').includes('key')) return {};
  const settings = {};
  for (const { key, value } of rowsOf(db, 'SELECT key, value FROM store_settings')) {
    if (SETTING_KEYS.includes(key) && value != null && String(value).trim() !== '') settings[key] = String(value);
  }
  return settings;
}

/**
 * Every order with its items, shaped for the backend's legacy-import
 * endpoint. Items carry the product's barcode/name (not its online-pos id),
 * since that's how the backend matches them to the imported catalog.
 */
export function readOrders(db) {
  const orderCols = columnsOf(db, 'orders');
  if (!orderCols.includes('id') || !columnsOf(db, 'order_items').includes('order_id')) return [];
  const col = (name, fallback) => (orderCols.includes(name) ? name : `${fallback} AS ${name}`);

  const orders = rowsOf(
    db,
    `SELECT id, created_at, payment_method, total_amount,
       ${col('currency', "'USD'")}, ${col('bank_name', 'NULL')},
       ${col('amount_paid_usd', '0')}, ${col('amount_paid_khr', '0')}, ${col('change_given_khr', '0')},
       ${col('status', "'COMPLETED'")}, ${col('is_deleted', '0')}
     FROM orders ORDER BY id`
  );
  const itemCurrency = columnsOf(db, 'order_items').includes('currency') ? 'i.currency' : "'USD'";
  const itemsByOrder = new Map();
  for (const item of rowsOf(
    db,
    `SELECT i.order_id, i.product_id, p.barcode, p.name, i.quantity, i.price_at_sale, ${itemCurrency} AS currency
     FROM order_items i LEFT JOIN products p ON p.id = i.product_id ORDER BY i.id`
  )) {
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push({
      barcode: item.barcode ? String(item.barcode) : null,
      name: item.name || `Unknown product #${item.product_id}`,
      quantity: Number(item.quantity),
      priceAtSale: Number(item.price_at_sale),
      currency: item.currency === 'KHR' ? 'KHR' : 'USD',
    });
  }

  return orders.map((o) => ({
    legacyId: Number(o.id),
    createdAt: String(o.created_at ?? ''),
    paymentMethod: String(o.payment_method ?? ''),
    bankName: o.bank_name ? String(o.bank_name) : null,
    totalAmount: Number(o.total_amount),
    currency: o.currency === 'KHR' ? 'KHR' : 'USD',
    amountPaidUsd: Number(o.amount_paid_usd) || 0,
    amountPaidKhr: Number(o.amount_paid_khr) || 0,
    changeGivenKhr: Number(o.change_given_khr) || 0,
    status: String(o.status ?? 'COMPLETED'),
    isDeleted: Boolean(Number(o.is_deleted)),
    items: itemsByOrder.get(o.id) ?? [],
  }));
}

/**
 * Identifies the online-pos install, not the file: derived from its first
 * order, which every later backup of the same database also starts with.
 * The backend builds imported order IDs from it, so re-importing a newer
 * backup skips the orders already brought over.
 */
export async function sourceIdFor(orders) {
  const first = orders[0];
  if (!first) return null;
  const bytes = new TextEncoder().encode(`${first.legacyId}|${first.createdAt}|${first.totalAmount}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
