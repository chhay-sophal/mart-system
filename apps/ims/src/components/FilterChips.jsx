import { X } from 'lucide-react';
import { FILTER_TYPES } from '../hooks/useDataTable';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt } from '../i18n/translate';

/**
 * The table's applied filters as removable chips ("Status: Archived ×").
 * Removing a chip resets just that filter. Renders nothing when no filter is
 * active, so it can sit permanently above a table.
 *
 *   <FilterChips table={table} />
 */
export default function FilterChips({ table }) {
  const { t } = useLocale();
  const active = table.columns.filter((c) => c.filter && table.isFilterActive(c.key));
  if (active.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {active.map((col) => {
        const text = FILTER_TYPES[col.filter.type].describe(col.filter, table.filters[col.key]);
        return (
          <span
            key={col.key}
            className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full text-xs bg-indigo-50 dark:bg-indigo-950/40 text-[var(--accent)] border border-indigo-200 dark:border-indigo-900"
          >
            <span className="font-medium">{col.label}</span>
            {text && <span className="text-slate-600 dark:text-slate-300">: {text}</span>}
            <button
              type="button"
              onClick={() => table.setFilter(col.key, table.emptyFilters[col.key])}
              aria-label={fmt(t.common.removeFilter, { label: col.label })}
              className="ml-0.5 p-0.5 rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/60 cursor-pointer"
            >
              <X size={12} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
