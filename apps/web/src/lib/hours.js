// Opening-hours logic for shared-types' OpeningHours: { mon: { open, close } | null, ... }.
// Everything is evaluated in the *store's* timezone, never the shopper's.

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_LABEL = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
const SHORT_WEEKDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** "07:00" → "7 am", "22:30" → "10:30 pm", "24:00"/"00:00" as a close → "midnight". */
export function formatTime(hhmm, { asClose = false } = {}) {
  const mins = toMinutes(hhmm);
  if (asClose && (mins === 0 || mins === 1440)) return 'midnight';
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h24 < 12 ? 'am' : 'pm'}`;
}

const is24h = (day) => day && day.open === '00:00' && day.close === '24:00';

export function formatDayHours(day) {
  if (!day) return 'Closed';
  if (is24h(day)) return 'Open 24 hours';
  return `${formatTime(day.open)} – ${formatTime(day.close, { asClose: true })}`;
}

/** The store-local weekday index (0 = Monday) and minutes since midnight at `now`. */
function localNow(timezone, now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { day: SHORT_WEEKDAY[get('weekday')], minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * One day's hours as up to two [start, end) minute ranges on that day, plus
 * how far it spills into the next day when it runs past midnight.
 */
function ranges(day) {
  if (!day) return { today: null, spill: 0 };
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  if (close > open) return { today: [open, close], spill: 0 };
  return { today: [open, 1440], spill: close }; // past midnight (close < open, or 00:00)
}

/**
 * Whether the store is open at `now`, and a short label for it:
 * "Open 24 hours", "Open until 10 pm", "Closed · opens 7 am",
 * "Closed · opens tomorrow 7 am", "Closed · opens Monday 7 am".
 * Returns null when hours aren't listed.
 */
export function getOpenStatus(openingHours, timezone, now = new Date()) {
  if (!openingHours) return null;
  const { day, minutes } = localNow(timezone, now);
  const dayAt = (offset) => openingHours[WEEKDAYS[(day + offset + 7) % 7]];

  const today = dayAt(0);
  if (is24h(today)) return { isOpen: true, label: 'Open 24 hours' };

  // Still inside last night's past-midnight hours?
  const yesterday = ranges(dayAt(-1));
  if (minutes < yesterday.spill) {
    return { isOpen: true, label: `Open until ${formatTime(dayAt(-1).close, { asClose: true })}` };
  }

  const t = ranges(today);
  if (t.today && minutes >= t.today[0] && minutes < t.today[1]) {
    return { isOpen: true, label: `Open until ${formatTime(today.close, { asClose: true })}` };
  }

  // Closed: find the next opening, today (later) or in the coming week.
  if (t.today && minutes < t.today[0]) return { isOpen: false, label: `Closed · opens ${formatTime(today.open)}` };
  for (let offset = 1; offset <= 7; offset += 1) {
    const next = dayAt(offset);
    if (!next) continue;
    const when = offset === 1 ? 'tomorrow' : WEEKDAY_LABEL[WEEKDAYS[(day + offset) % 7]];
    return { isOpen: false, label: `Closed · opens ${when} ${formatTime(next.open)}` };
  }
  return { isOpen: false, label: 'Closed' };
}

/** Today's weekday key in the store's timezone, for highlighting its row in a weekly table. */
export function todayKey(timezone, now = new Date()) {
  return WEEKDAYS[localNow(timezone, now).day];
}
