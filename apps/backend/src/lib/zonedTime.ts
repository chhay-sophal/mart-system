// Calendar dates and hours in a store's own time zone (Store.timezone, an
// IANA name like "Asia/Phnom_Penh"), without a date library: Intl does the
// zone arithmetic. Dates are plain "YYYY-MM-DD" strings.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function partsOf(at: Date, timeZone: string) {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(at).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** The local calendar date and hour (0-23) of an instant in a time zone. */
export function zonedDateHour(at: Date, timeZone: string): { date: string; hour: number } {
  const p = partsOf(at, timeZone);
  return { date: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, hour: p.hour };
}

// How far ahead of UTC the zone is at that instant, in minutes.
function offsetMinutes(at: Date, timeZone: string): number {
  const p = partsOf(at, timeZone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at.getTime()) / 60000);
}

/** The instant a local calendar date begins (local midnight) in a time zone. */
export function zonedMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!);
  const offset = offsetMinutes(new Date(guess), timeZone);
  let result = guess - offset * 60000;
  // Around a DST change the offset at midnight can differ from the guess's.
  const actual = offsetMinutes(new Date(result), timeZone);
  if (actual !== offset) result = guess - actual * 60000;
  return new Date(result);
}

/** A calendar date `n` days after (or before, if negative) another. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** Every calendar date from `from` to `to`, both included. */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/** Day of the week of a calendar date, Monday = 0 ... Sunday = 6. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
}
