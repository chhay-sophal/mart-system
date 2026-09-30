// Formatting pickup times on the store's clock, not the shopper's.

export function formatPickupTime(iso, timezone) {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

function dayKey(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** "Today", "Tomorrow", or e.g. "Friday 9 October". */
export function formatPickupDay(iso, timezone, now = new Date()) {
  const key = dayKey(new Date(iso), timezone);
  if (key === dayKey(now, timezone)) return 'Today';
  if (key === dayKey(new Date(now.getTime() + 86_400_000), timezone)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
}

export const formatPickupWhen = (iso, timezone, now) => `${formatPickupDay(iso, timezone, now)}, ${formatPickupTime(iso, timezone)}`;

/** Slots grouped by day label, in order: [["Today", [iso…]], ["Tomorrow", […]]]. */
export function groupSlotsByDay(slots, timezone, now = new Date()) {
  const groups = new Map();
  for (const slot of slots) {
    const day = formatPickupDay(slot, timezone, now);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(slot);
  }
  return [...groups.entries()];
}
