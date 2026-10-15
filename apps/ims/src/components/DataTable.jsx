import { Fragment } from 'react';
import SortableHeader from './SortableHeader.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';

/**
 * Sortable table built from column definitions. Pair with hooks/useDataTable.js,
 * which owns the filter/sort state and documents the column shape; filters
 * are edited through components/FilterButton.jsx:
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
                <SortableHeader
                  key={col.key}
                  col={col.key}
                  label={col.label}
                  className={col.className}
                  sort={table.sort}
                  onSort={col.sortValue || col.compare ? table.toggleSort : undefined}
                />
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
