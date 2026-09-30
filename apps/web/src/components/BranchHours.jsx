import { formatDayHours, getOpenStatus, todayKey, WEEKDAY_LABEL, WEEKDAYS } from '../lib/hours.js';
import { useNow } from '../lib/useNow.js';

/** "Open now" / "Closed" pill with its label, or nothing when hours aren't listed. */
export function OpenBadge({ store }) {
  const now = useNow();
  const status = getOpenStatus(store.openingHours, store.timezone, now);
  if (!status) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-bold ${
        status.isOpen ? 'bg-brand-soft text-brand' : 'bg-[#eeeae0] text-muted'
      }`}
    >
      <span className={`size-2 rounded-full ${status.isOpen ? 'bg-ok' : 'bg-faint'}`} aria-hidden="true" />
      {status.label}
    </span>
  );
}

/** The full week in a collapsible list, today's row highlighted. */
export function WeeklyHours({ store }) {
  const now = useNow();
  if (!store.openingHours) return <p className="m-0 text-sm text-muted">Opening hours not listed yet.</p>;
  const today = todayKey(store.timezone, now);
  return (
    <details className="group text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 font-semibold text-brand">
        Opening hours
        <span className="transition-transform group-open:rotate-180" aria-hidden="true">
          ▾
        </span>
      </summary>
      <table className="w-full border-collapse">
        <tbody>
          {WEEKDAYS.map((key) => (
            <tr key={key} className={key === today ? 'font-bold text-ink' : 'text-muted'}>
              <th scope="row" className="py-1 pr-4 text-left font-[inherit]">
                {WEEKDAY_LABEL[key]}
                {key === today && <span className="sr-only"> (today)</span>}
              </th>
              <td className="py-1 text-right">{formatDayHours(store.openingHours[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
