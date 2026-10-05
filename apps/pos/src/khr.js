// The smallest riel note in circulation is 100, so every riel amount the POS
// shows or charges is rounded to the nearest 100. This also hides noise from
// round-tripping a riel total through USD cents (a 44,000 ៛ sale stored as
// $10.73 converts back to 43,993 ៛).
export const KHR_STEP = 100;

export function roundKhr(khr) {
  return Math.round((Number(khr) || 0) / KHR_STEP) * KHR_STEP;
}

export function usdToKhr(usd, rate) {
  return roundKhr((Number(usd) || 0) * (rate || 4100));
}

/**
 * An order's total in riel. Sales charged in riel keep their total in riel
 * (`total` + `currency`), so that's shown exactly; others are converted from
 * `total_amount`, which is always USD.
 */
export function orderTotalKhr(order, rate) {
  if (order.currency === 'KHR' && order.total != null) return Math.round(Number(order.total));
  return usdToKhr(order.total_amount, rate);
}
