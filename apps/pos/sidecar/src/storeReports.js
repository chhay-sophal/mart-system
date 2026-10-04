const db = require('./db');
const sync = require('./sync');

// Order History and Daily Summary show the whole store once this register is
// paired: every terminal's sales plus imported online-pos history live on the
// backend, not in this register's local database. Offline (or unpaired) they
// fall back to the local data, tagged so the screen can say so.

const BACKEND_TIMEOUT_MS = 8000;
const PUSH_TIMEOUT_MS = 5000;

/**
 * The screens send either an ISO instant ("2026-10-03T17:00:00.000Z") or a
 * shop-local "YYYY-MM-DD HH:mm:ss" (how local orders are stored). The sidecar
 * runs on the shop's PC, so a local string is read in its own timezone.
 */
function toInstant(value) {
  if (!value) return null;
  const s = String(value);
  const date = s.includes('T') ? new Date(s) : new Date(s.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Same format as db.localNow(), for comparing against local created_at. */
function toLocalSql(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseRange(reqQuery) {
  return { from: toInstant(reqQuery.date_from), to: toInstant(reqQuery.date_to) };
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

/**
 * GETs a store-wide report from the backend, or returns null when there's no
 * backend to ask (unpaired) or it can't be reached -- callers fall back to
 * local data. Pending local sales are pushed first (best effort), so a sale
 * rung up seconds ago is already in what the backend returns.
 */
async function fetchStoreReport(path, params) {
  const config = db.getSyncConfig();
  if (!config) return { config: null, data: null };

  await withTimeout(sync.pushPending(config).catch(() => {}), PUSH_TIMEOUT_MS);

  const url = new URL(`${config.backendUrl}${path}`);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, { headers: sync.authHeaders(config), signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return { config, data: await response.json() };
  } catch (err) {
    console.warn(`[reports] ${path} unavailable, using local data: ${err.message}`);
    return { config, data: null };
  }
}

module.exports = { parseRange, toLocalSql, fetchStoreReport };
