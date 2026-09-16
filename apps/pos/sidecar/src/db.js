const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_DIR = process.env.POS_DATA_DIR || path.join(os.homedir(), '.mart-system-pos');
const DB_PATH = path.join(DB_DIR, 'database.sqlite');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let db;
let SQL;

function localNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  db.run(sql, params);
  return db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0] ?? null;
}

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function begin() {
  db.run('BEGIN TRANSACTION');
}

function commit() {
  db.run('COMMIT');
}

function rollback() {
  try {
    db.run('ROLLBACK');
  } catch (_) {
    // Nothing to roll back (e.g. the failure happened before BEGIN) — safe to ignore.
  }
}

function generateUuid() {
  return crypto.randomUUID();
}

/**
 * Appends one outbox row. Called from inside the same transaction as the
 * order/void write it records, so a sale is never persisted without its sync
 * event also being queued (or vice versa) — they commit or roll back together.
 */
function enqueueOutboxEvent(eventType, payload) {
  const nextSeq = (query('SELECT COALESCE(MAX(sequence_no), 0) + 1 as n FROM outbox_events')[0]?.n) ?? 1;
  run(
    'INSERT INTO outbox_events (event_id, terminal_id, sequence_no, event_type, payload, status, retry_count, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    [generateUuid(), getSyncSetting('sync_terminal_id'), nextSeq, eventType, JSON.stringify(payload), 'PENDING', localNow()]
  );
}

function getSyncSetting(key) {
  return query('SELECT value FROM store_settings WHERE key = ?', [key])[0]?.value ?? null;
}

function getSyncConfig() {
  const backendUrl = getSyncSetting('sync_backend_url');
  const terminalId = getSyncSetting('sync_terminal_id');
  const deviceSecret = getSyncSetting('sync_device_secret');
  if (!backendUrl || !terminalId || !deviceSecret) return null;
  return { backendUrl, terminalId, deviceSecret };
}

// Schema ported from online-pos/backend-desktop/server.js, plus two tables that
// stay unused until Phase 4's sync engine (outbox_events, sync_state) and a
// client_order_uuid column on orders — added now so the schema doesn't need to
// churn once sync lands.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    barcode TEXT UNIQUE,
    price REAL NOT NULL DEFAULT 0,
    cost_price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    stock INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    total_amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    payment_method TEXT NOT NULL,
    bank_name TEXT,
    amount_paid_usd REAL DEFAULT 0,
    amount_paid_khr REAL DEFAULT 0,
    change_given_khr INTEGER DEFAULT 0,
    status TEXT DEFAULT 'COMPLETED',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    client_order_uuid TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price_at_sale REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS store_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS khqr_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    md5_hash TEXT,
    qr_string TEXT,
    bank_name TEXT,
    transaction_currency TEXT,
    amount REAL,
    status TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS outbox_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    terminal_id TEXT,
    sequence_no INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  INSERT OR IGNORE INTO store_settings (key, value) VALUES
    ('exchange_rate', '4100'),
    ('locale', 'km'),
    ('main_currency', 'USD'),
    ('cloud_backup_folder', '');
`;

function runMigrations() {
  db.run(SCHEMA);
  const cols = (table) => query(`PRAGMA table_info(${table})`).map((c) => c.name);

  const productCols = cols('products');
  if (!productCols.includes('cost_price')) db.run('ALTER TABLE products ADD COLUMN cost_price REAL NOT NULL DEFAULT 0');
  if (!productCols.includes('is_deleted')) db.run('ALTER TABLE products ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');
  if (!productCols.includes('updated_at')) db.run('ALTER TABLE products ADD COLUMN updated_at TEXT');
  if (!productCols.includes('deleted_at')) db.run('ALTER TABLE products ADD COLUMN deleted_at TEXT');
  // Links a local product to the backend's Product id once it's been matched
  // via a catalog pull — required before a sale of this product can be synced.
  if (!productCols.includes('backend_product_id')) db.run('ALTER TABLE products ADD COLUMN backend_product_id TEXT');

  const orderCols = cols('orders');
  if (!orderCols.includes('is_deleted')) db.run('ALTER TABLE orders ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');
  if (!orderCols.includes('updated_at')) db.run('ALTER TABLE orders ADD COLUMN updated_at TEXT');
  if (!orderCols.includes('deleted_at')) db.run('ALTER TABLE orders ADD COLUMN deleted_at TEXT');
  if (!orderCols.includes('client_order_uuid')) db.run('ALTER TABLE orders ADD COLUMN client_order_uuid TEXT');

  const itemCols = cols('order_items');
  if (!itemCols.includes('created_at')) db.run('ALTER TABLE order_items ADD COLUMN created_at TEXT');
  if (!itemCols.includes('updated_at')) db.run('ALTER TABLE order_items ADD COLUMN updated_at TEXT');

  const khqrCols = cols('khqr_transactions');
  if (!khqrCols.includes('updated_at')) db.run('ALTER TABLE khqr_transactions ADD COLUMN updated_at TEXT');
  if (!khqrCols.includes('deleted_at')) db.run('ALTER TABLE khqr_transactions ADD COLUMN deleted_at TEXT');
}

// --- BACKUP --- (ported from online-pos/backend-desktop/server.js:427-467,596-616)

const BACKUP_DIR = path.join(DB_DIR, 'backups');
const MAX_BACKUPS = 7;
const BACKUP_FILENAME_RE = /^database-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sqlite$/;

/**
 * Snapshots whatever is currently on disk at DB_PATH. Called once at startup
 * (before `db` is assigned, so the very first call of a session never mirrors
 * to the cloud folder — same as the old app) and from the backup/restore routes.
 */
function createBackup() {
  if (!fs.existsSync(DB_PATH)) return;
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const filename = `database-${stamp}.sqlite`;
  const backupPath = path.join(BACKUP_DIR, filename);
  fs.copyFileSync(DB_PATH, backupPath);
  console.log(`Backup saved: ${backupPath}`);

  const backups = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('database-') && f.endsWith('.sqlite'))
    .sort();
  if (backups.length > MAX_BACKUPS) {
    backups.slice(0, backups.length - MAX_BACKUPS).forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  }

  if (db) {
    try {
      const cloudFolder = getSyncSetting('cloud_backup_folder');
      if (cloudFolder && fs.existsSync(cloudFolder)) {
        fs.copyFileSync(DB_PATH, path.join(cloudFolder, filename));
        console.log(`Cloud backup saved: ${path.join(cloudFolder, filename)}`);
      }
    } catch (err) {
      console.error('Cloud backup failed:', err.message);
    }
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('database-') && f.endsWith('.sqlite'))
    .sort()
    .reverse()
    .map((name) => {
      const stats = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: stats.size };
    });
}

/** Swaps the live in-memory db instance directly — no process restart, same as the old app. */
function restoreBackup(filename) {
  if (!filename || !BACKUP_FILENAME_RE.test(filename)) throw new Error('Invalid filename');
  const backupPath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(backupPath)) throw new Error('Backup not found');

  saveDb();
  createBackup();
  const fileBuffer = fs.readFileSync(backupPath);
  db = new SQL.Database(fileBuffer);
  runMigrations();
  saveDb();
}

function exportBackup(filename, destPath) {
  if (!filename || !BACKUP_FILENAME_RE.test(filename)) throw new Error('Invalid filename');
  if (!destPath || typeof destPath !== 'string') throw new Error('Invalid destination path');
  const srcPath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(srcPath)) throw new Error('Backup not found');
  fs.copyFileSync(srcPath, destPath);
}

async function init() {
  const initSqlJs = require('sql.js');

  // Under pkg, WASM lives in the virtual snapshot filesystem, but
  // WebAssembly.instantiate needs a real OS path — extract it once.
  // (Validated in the Phase 0 spike: this is required regardless of package
  // manager/node_modules layout — see docs/plan.md's risk write-up.)
  let wasmDir;
  if (process.pkg) {
    const wasmSrc = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    const wasmDest = path.join(os.tmpdir(), 'sql-wasm.wasm');
    fs.writeFileSync(wasmDest, fs.readFileSync(wasmSrc));
    wasmDir = os.tmpdir();
  } else {
    wasmDir = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');
  }

  SQL = await initSqlJs({ locateFile: (file) => path.join(wasmDir, file) });

  createBackup();

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log(`Loaded database from ${DB_PATH}`);
  } else {
    db = new SQL.Database();
    console.log(`Created new database at ${DB_PATH}`);
  }

  runMigrations();
  saveDb();
}

module.exports = {
  DB_PATH,
  localNow,
  query,
  run,
  saveDb,
  begin,
  commit,
  rollback,
  generateUuid,
  enqueueOutboxEvent,
  getSyncSetting,
  getSyncConfig,
  init,
  createBackup,
  listBackups,
  restoreBackup,
  exportBackup,
};
