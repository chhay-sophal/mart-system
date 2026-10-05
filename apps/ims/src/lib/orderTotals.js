// Order totals from GET /api/orders. `total` + `currency` are the total as
// charged (the store's main currency at the time); `total_amount` is the same
// in USD. Riel is rounded to the smallest note, 100, like the POS does.

export const usdToKhr = (usd, rate) => Math.round(((Number(usd) || 0) * (rate || 4100)) / 100) * 100;

/** The order's total in riel: exact when it was charged in riel, else converted. */
export function orderTotalKhr(order) {
  if (order.currency === 'KHR' && order.total != null) return Math.round(Number(order.total));
  return usdToKhr(order.total_amount, order.exchange_rate);
}
