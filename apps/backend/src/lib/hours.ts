import type { DayHours, OpeningHours, Weekday } from "@mart-system/shared-types";

/**
 * Opening-hours maths in a store's own IANA timezone (the backend twin of
 * apps/web/src/lib/hours.js). Hours are shared-types' OpeningHours: per
 * weekday { open, close } as "HH:MM", close may be "24:00" or earlier than
 * open (runs past midnight), null = closed.
 */

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SHORT_WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const MINUTE = 60_000;

export const SLOT_MINUTES = 30;
/** A scheduled pickup must be at least this far away when chosen. */
export const SLOT_LEAD_MINUTES = 30;
/** Slack when re-checking a slot at order time, so one picked a few minutes earlier still counts. */
const SLOT_GRACE_MINUTES = 15;

interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Monday
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timezone: string) {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, f);
  }
  return f;
}

export function wallTime(timezone: string, instant: Date): WallTime {
  const parts = formatterFor(timezone).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: SHORT_WEEKDAY[get("weekday")]!,
  };
}

/** The instant at which the store's clock reads the given wall time (DST-safe via a two-pass offset). */
export function zonedInstant(timezone: string, y: number, mo: number, d: number, h: number, mi: number): Date {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms: number) => {
    const w = wallTime(timezone, new Date(ms));
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(ms / MINUTE) * MINUTE;
  };
  const first = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(first));
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

/** A day's hours as a [start, end) minute range on that day, plus how far it spills past midnight. */
function ranges(day: DayHours | null) {
  if (!day) return { today: null as [number, number] | null, spill: 0 };
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  if (close > open) return { today: [open, close] as [number, number], spill: 0 };
  return { today: [open, 1440] as [number, number], spill: close };
}

export function isOpenAt(hours: OpeningHours, timezone: string, instant: Date): boolean {
  const w = wallTime(timezone, instant);
  const minutes = w.hour * 60 + w.minute;
  const yesterday = ranges(hours[WEEKDAYS[(w.weekday + 6) % 7]!]);
  if (minutes < yesterday.spill) return true;
  const today = ranges(hours[WEEKDAYS[w.weekday]!]).today;
  return today !== null && minutes >= today[0] && minutes < today[1];
}

/** The next time the store opens after `from` (or `from` itself if open). Null if it never opens. */
export function nextOpening(hours: OpeningHours, timezone: string, from: Date): Date | null {
  if (isOpenAt(hours, timezone, from)) return from;
  const w = wallTime(timezone, from);
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = hours[WEEKDAYS[(w.weekday + offset) % 7]!];
    if (!day) continue;
    // Step the calendar date via UTC noon so month/year rollovers are handled for us.
    const date = new Date(Date.UTC(w.year, w.month - 1, w.day + offset, 12));
    const [h, m] = day.open.split(":").map(Number);
    const candidate = zonedInstant(timezone, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), h!, m!);
    if (candidate > from) return candidate;
  }
  return null;
}

/** Whether the whole 30-minute slot starting at `start` is inside opening hours. */
function slotFits(hours: OpeningHours, timezone: string, start: Date) {
  return (
    isOpenAt(hours, timezone, start) &&
    isOpenAt(hours, timezone, new Date(start.getTime() + (SLOT_MINUTES - 1) * MINUTE))
  );
}

const isSlotAligned = (timezone: string, instant: Date) =>
  instant.getUTCSeconds() === 0 && instant.getUTCMilliseconds() === 0 && wallTime(timezone, instant).minute % SLOT_MINUTES === 0;

/** Start of the day after tomorrow on the store's clock — the end of the bookable window. */
function bookingWindowEnd(timezone: string, now: Date) {
  const w = wallTime(timezone, now);
  const date = new Date(Date.UTC(w.year, w.month - 1, w.day + 2, 12));
  return zonedInstant(timezone, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 0, 0);
}

/** 30-minute pickup slots (on :00/:30 of the store's clock) from `now + lead` to the end of tomorrow. */
export function pickupSlots(hours: OpeningHours | null, timezone: string, now: Date): Date[] {
  if (!hours) return [];
  const earliest = new Date(now.getTime() + SLOT_LEAD_MINUTES * MINUTE);
  earliest.setUTCSeconds(0, 0);
  if (earliest.getTime() < now.getTime() + SLOT_LEAD_MINUTES * MINUTE) earliest.setTime(earliest.getTime() + MINUTE);
  const bump = (SLOT_MINUTES - (wallTime(timezone, earliest).minute % SLOT_MINUTES)) % SLOT_MINUTES;
  const end = bookingWindowEnd(timezone, now);

  const slots: Date[] = [];
  for (let t = earliest.getTime() + bump * MINUTE; t < end.getTime(); t += SLOT_MINUTES * MINUTE) {
    const start = new Date(t);
    if (slotFits(hours, timezone, start)) slots.push(start);
  }
  return slots;
}

/** Re-checks a slot chosen earlier: aligned, inside hours, not (much) in the past, and within the window. */
export function isValidPickupSlot(hours: OpeningHours | null, timezone: string, pickupAt: Date, now: Date): boolean {
  if (!hours || Number.isNaN(pickupAt.getTime())) return false;
  if (!isSlotAligned(timezone, pickupAt)) return false;
  if (pickupAt.getTime() < now.getTime() + (SLOT_LEAD_MINUTES - SLOT_GRACE_MINUTES) * MINUTE) return false;
  if (pickupAt >= bookingWindowEnd(timezone, now)) return false;
  return slotFits(hours, timezone, pickupAt);
}
