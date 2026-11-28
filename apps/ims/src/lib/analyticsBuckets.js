// Groups the Analytics endpoint's daily totals into the chart's buckets: one
// per day, per week (starting Monday) or per month. Dates are "YYYY-MM-DD",
// already in the store's local time, so plain date arithmetic is enough.

const ZERO = { orderCount: 0, revenue: 0, revenueKhr: 0, profit: 0, profitKhr: 0 };

// The bucket a date falls in, and the date the bucket starts on.
function bucketStart(date, unit) {
  if (unit === 'day') return date;
  if (unit === 'month') return `${date.slice(0, 7)}-01`;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return d.toISOString().slice(0, 10);
}

/** Buckets in order: { key, date (local, for labels), orderCount, revenue, revenueKhr, profit, profitKhr }. */
export function groupDays(days, unit) {
  const buckets = new Map();
  for (const day of days) {
    const start = bucketStart(day.date, unit);
    const bucket = buckets.get(start) ?? { key: start, date: new Date(`${start}T00:00:00`), ...ZERO };
    for (const field of Object.keys(ZERO)) bucket[field] += day[field];
    buckets.set(start, bucket);
  }
  return [...buckets.values()];
}

/** Totals over a list of days. */
export function totalOf(days) {
  return days.reduce((sum, d) => {
    for (const field of Object.keys(ZERO)) sum[field] += d[field];
    return sum;
  }, { ...ZERO });
}
