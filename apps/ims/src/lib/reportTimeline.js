// Turns the daily-summary report's hourly timeline into chart buckets.

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const ZERO = { orderCount: 0, revenue: 0, revenueKhr: 0, profit: 0, profitKhr: 0 };

/**
 * Regroups the report's hourly timeline (UTC hour starts, possibly from
 * several stores) into local buckets for the chosen range: hours for a single
 * day, days up to two months, months beyond. Every slot in the range is
 * present, zero-filled, so gaps in sales read as gaps.
 */
export function bucketTimeline(timeline, dateFrom, dateTo) {
  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateTo}T00:00:00`);
  const days = Math.round((to - from) / 86_400_000) + 1;
  const unit = days <= 1 ? 'hour' : days <= 62 ? 'day' : 'month';
  const keyOf = (d) => (unit === 'hour' ? d.getHours() : unit === 'day' ? dayKey(d) : monthKey(d));

  const sums = new Map();
  for (const h of timeline) {
    const key = keyOf(new Date(h.hour));
    const s = sums.get(key) ?? { ...ZERO };
    for (const field of Object.keys(ZERO)) s[field] += h[field];
    sums.set(key, s);
  }

  const slots = [];
  if (unit === 'hour') {
    // Usual trading hours, widened to cover any sale outside them.
    const hours = [...sums.keys()];
    const start = Math.min(7, ...hours);
    const end = Math.max(21, ...hours);
    for (let h = start; h <= end; h++) slots.push({ key: h, date: new Date(from.getFullYear(), from.getMonth(), from.getDate(), h) });
  } else if (unit === 'day') {
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) slots.push({ key: dayKey(d), date: new Date(d) });
  } else {
    for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d.setMonth(d.getMonth() + 1)) {
      slots.push({ key: monthKey(d), date: new Date(d) });
    }
  }
  return { unit, buckets: slots.map((s) => ({ ...s, ...(sums.get(s.key) ?? ZERO) })) };
}
