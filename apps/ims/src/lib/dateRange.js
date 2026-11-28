// Date ranges as the date inputs hold them: plain 'YYYY-MM-DD' strings in
// local time, with '' meaning unbounded on that side ("All time" is just both
// sides empty, not a separate mode). Shared by every page that filters by
// date, so their presets and API bounds can't drift apart.

// Local-getter-based, not `date.toISOString().slice(0, 10)`: that converts to
// UTC first, so anywhere east of UTC it silently returns yesterday's date for
// the first few hours of the day.
export const toLocalDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const todayStr = () => toLocalDateStr(new Date());

function daysAgoStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toLocalDateStr(d);
}

// Labels: t.common.datePresets[key]. "Last N days" includes today.
export const DATE_PRESETS = ['today', 'yesterday', 'last7Days', 'last30Days', 'thisMonth', 'all'];

/** The { from, to } the date inputs land on for a preset. */
export function presetRange(key) {
  const today = todayStr();
  if (key === 'today') return { from: today, to: today };
  if (key === 'yesterday') return { from: daysAgoStr(1), to: daysAgoStr(1) };
  if (key === 'last7Days') return { from: daysAgoStr(6), to: today };
  if (key === 'last30Days') return { from: daysAgoStr(29), to: today };
  if (key === 'thisMonth') {
    const d = new Date();
    return { from: toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1)), to: today };
  }
  return { from: '', to: '' }; // 'all'
}

/**
 * The range as API query params: date_from at local midnight of the first
 * day, date_to at local midnight of the day AFTER the last one (the server
 * treats it as exclusive, createdAt < date_to), so the last day counts whole.
 * An empty side is left out. The T00:00:00 suffix matters: a bare
 * 'YYYY-MM-DD' parses as UTC midnight, which is 7am in Cambodia.
 */
export function toApiRange(dateFrom, dateTo) {
  const query = {};
  if (dateFrom) query.date_from = new Date(`${dateFrom}T00:00:00`).toISOString();
  if (dateTo) {
    const to = new Date(`${dateTo}T00:00:00`);
    to.setDate(to.getDate() + 1);
    query.date_to = to.toISOString();
  }
  return query;
}

/**
 * The period of the same length just before a range (both ends inclusive):
 * a single day compares with the day before, 7 days with the 7 before them.
 */
export function previousRange(dateFrom, dateTo) {
  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateTo}T00:00:00`);
  const days = Math.round((to - from) / 86_400_000) + 1;
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return { from: toLocalDateStr(prevFrom), to: toLocalDateStr(prevTo) };
}
