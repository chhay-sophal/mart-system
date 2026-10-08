// Shared date-range parsing for Order History and Daily Summary. Both screens
// now read this register's locally synced copy of the store's orders (kept
// fresh in the background by sync.js's pull, same as the product catalog)
// instead of calling the backend directly on every open.

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

function parseRange(reqQuery) {
  return { from: toInstant(reqQuery.date_from), to: toInstant(reqQuery.date_to) };
}

module.exports = { parseRange };
