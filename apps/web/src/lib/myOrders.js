import { readJson, writeJson } from './storage.js';

// Orders placed from this browser, newest first, so a shopper can find their
// pickup code again without an account. Only the order's secret token is kept.
const KEY = 'storefront.myOrders';
const MAX = 20;

export function listMyOrders() {
  return readJson(KEY, []);
}

export function rememberOrder(token, { clearCartOnConfirm }) {
  const rest = listMyOrders().filter((o) => o.token !== token);
  writeJson(KEY, [{ token, placedAt: new Date().toISOString(), clearCartOnConfirm }, ...rest].slice(0, MAX));
}

/** True once per order: the cart should be emptied now that its order is confirmed. */
export function takeCartClear(token) {
  const orders = listMyOrders();
  const entry = orders.find((o) => o.token === token);
  if (!entry?.clearCartOnConfirm) return false;
  writeJson(
    KEY,
    orders.map((o) => (o.token === token ? { ...o, clearCartOnConfirm: false } : o)),
  );
  return true;
}
