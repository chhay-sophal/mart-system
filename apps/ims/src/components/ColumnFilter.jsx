import { useLocale } from '../i18n/LocaleContext.jsx';

// Shared look for every filter control, including pages' own 'custom' filters.
export const filterInput = 'w-full border border-[var(--border)] rounded-md px-3 h-9 text-sm bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200';

/** One column's filter controls, as shown in FilterButton's dropdown. */
export default function ColumnFilter({ filter, value, onChange }) {
  const { t } = useLocale();

  switch (filter.type) {
    case 'select': {
      const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
      return (
        <div className="flex flex-col gap-1">
          {filter.options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} className="accent-indigo-600 cursor-pointer" />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case 'numberRange':
      return (
        <div className="flex gap-1">
          <input type="number" value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value })} placeholder={filter.minPlaceholder} className={`${filterInput} flex-1 min-w-0`} />
          <input type="number" value={value.max} onChange={(e) => onChange({ ...value, max: e.target.value })} placeholder={filter.maxPlaceholder} className={`${filterInput} flex-1 min-w-0`} />
        </div>
      );
    case 'dateRange':
      return (
        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-xs text-slate-500 dark:text-slate-400">
            {t.common.from}
            <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className={`${filterInput} mt-0.5`} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            {t.common.to}
            <input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className={`${filterInput} mt-0.5`} />
          </label>
        </div>
      );
    case 'custom':
      return filter.render({ value, onChange });
    default:
      return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={filter.placeholder} className={filterInput} />;
  }
}
