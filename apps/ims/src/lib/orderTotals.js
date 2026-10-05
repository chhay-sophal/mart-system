// Order totals from GET /api/orders. `total` + `currency` are the total as
// charged (the store's main currency at the time); `total_amount` is the same
// in USD. Riel is rounded to the smallest note, 100, like the POS does.
// Screens lead with the store's main currency (`main_currency`), as the POS
// does, and show the other one underneath.

export const roundKhr = (khr) => Math.round((Number(khr) || 0) / 100) * 100;
export const usdToKhr = (usd, rate) => roundKhr((Number(usd) || 0) * (rate || 4100));

export const fmtUsd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
export const fmtKhr = (n) => `${Math.round(Number(n) || 0).toLocaleString()} ៛`;

/** The order's total in riel: exact when it was charged in riel, else converted. */
export function orderTotalKhr(order) {
  if (order.currency === 'KHR' && order.total != null) return Math.round(Number(order.total));
  return usdToKhr(order.total_amount, order.exchange_rate);
}

/** A USD amount and its riel figure, formatted in `mainCurrency` first. */
export function inMainCurrency(mainCurrency, usd, khr) {
  return mainCurrency === 'KHR'
    ? { primary: fmtKhr(khr), secondary: fmtUsd(usd) }
    : { primary: fmtUsd(usd), secondary: fmtKhr(khr) };
}

/** An order's total, led by its store's main currency. */
export const orderTotal = (order) => inMainCurrency(order.main_currency, order.total_amount, orderTotalKhr(order));

/** Lead with riel only when every order shown is from a riel store. */
export const mainCurrencyOf = (orders) =>
  orders.length > 0 && orders.every((o) => o.main_currency === 'KHR') ? 'KHR' : 'USD';
