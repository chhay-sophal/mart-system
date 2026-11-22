import { presetRange } from '../lib/dateRange';
import { useLocale } from '../i18n/LocaleContext.jsx';

/**
 * Labelled date-range field: quick presets (lib/dateRange.js DATE_PRESETS
 * keys) beside free-form from/to inputs, all editing the same range.
 *
 *   <DateRangeFilter dateFrom={from} dateTo={to} onChange={(f, t) => ...} presets={['today', 'last7Days']} />
 *
 * A preset is highlighted only while the inputs still exactly match it, so
 * editing a date by hand correctly reads as "custom range".
 */
export default function DateRangeFilter({ dateFrom, dateTo, onChange, presets }) {
  const { t } = useLocale();
  const active = presets.find((key) => {
    const r = presetRange(key);
    return r.from === dateFrom && r.to === dateTo;
  });

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.common.dateRange}</label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
          {presets.map((key, i) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                const { from, to } = presetRange(key);
                onChange(from, to);
              }}
              className={`px-3 h-9 text-sm whitespace-nowrap cursor-pointer ${i > 0 ? 'border-l border-[var(--border)]' : ''} ${
                active === key
                  ? 'bg-[var(--accent)] text-white font-medium'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {t.common.datePresets[key]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => onChange(e.target.value, dateTo)}
            aria-label={t.common.from}
            className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
          />
          <span className="text-slate-400 dark:text-slate-500">–</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => onChange(dateFrom, e.target.value)}
            aria-label={t.common.to}
            className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
