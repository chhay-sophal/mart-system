import { Fragment } from 'react';
import FilterableHeader, { filterInput } from './FilterableHeader.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';

/**
 * Sortable, per-column-filterable table built from column definitions. Pair
 * with hooks/useDataTable.js, which owns the filter/sort state and documents
 * the column shape:
 *
 *   const table = useDataTable({ rows, columns, initialSort: { col: 'name', dir: 'asc' } });
 *   <DataTable table={table} rowKey={(r) => r.id} loading={...} emptyText={...} noMatchText={...} />
 *
 * `rows` defaults to table.visible; pass a slice of it to paginate. A
 * column's className (e.g. "text-right") applies to its header and cells;
 * cellClassName applies to its cells only. For expandable rows, pass
 * isExpanded(row) + renderExpanded(row) (rendered in a full-width row below),
 * usually with onRowClick to toggle it.
 */
export default function DataTable({
  table,
  rows = table.visible,
  rowKey,
  loading,
  emptyText,
  noMatchText,
  rowClassName,
  onRowClick,
  isExpanded,
  renderExpanded,
}) {
  const { t } = useLocale();
  const { columns } = table;

  const message = loading ? t.common.loading : rows.length === 0 ? (table.total === 0 ? emptyText : noMatchText) : null;

  return (
    <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
          <tr>
            {columns.map((col) =>
              col.header !== undefined ? (
                <th key={col.key} className={`px-4 py-2 ${col.className ?? ''}`}>{col.header}</th>
              ) : (
                <FilterableHeader
                  key={col.key}
                  col={col.key}
                  label={col.label}
                  className={col.className}
                  sort={table.sort}
                  onSort={col.sortValue || col.compare ? table.toggleSort : undefined}
                  isOpen={table.openFilterCol === col.key}
                  onToggleFilter={table.toggleFilterCol}
                  panelRef={table.filterPanelRef}
                  hasActiveFilter={table.isFilterActive(col.key)}
                >
                  {col.filter && <ColumnFilter filter={col.filter} value={table.filters[col.key]} onChange={(v) => table.setFilter(col.key, v)} />}
                </FilterableHeader>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {message ? (
            <tr>
              <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={columns.length}>
                {message}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <Fragment key={rowKey(row)}>
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-t border-[var(--border)] ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(row) ?? ''}`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-2 ${col.className ?? ''} ${col.cellClassName ?? ''}`}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
                {isExpanded?.(row) && (
                  <tr className="bg-slate-50/60 dark:bg-slate-900/60">
                    <td colSpan={columns.length} className="px-4 py-3">
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** One column's filter controls; also used by FilterButton's dropdown. */
export function ColumnFilter({ filter, value, onChange, autoFocus = true }) {
  const { t } = useLocale();

  switch (filter.type) {
    case 'select':
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={filterInput}>
          {filter.defaultValue === undefined && <option value="all">{t.common.all}</option>}
          {filter.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case 'numberRange':
      return (
        <div className="flex gap-1">
          <input type="number" value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value })} placeholder={filter.minPlaceholder} className={`${filterInput} w-20`} autoFocus={autoFocus} />
          <input type="number" value={value.max} onChange={(e) => onChange({ ...value, max: e.target.value })} placeholder={filter.maxPlaceholder} className={`${filterInput} w-20`} />
        </div>
      );
    case 'dateRange':
      return (
        <div className="flex flex-col gap-1.5">
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
      return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={filter.placeholder} className={filterInput} autoFocus={autoFocus} />;
  }
}
