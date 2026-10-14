import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useColumnFilter } from '../hooks/useColumnFilter';
import Modal from '../components/Modal.jsx';
import FilterableHeader, { filterInput } from '../components/FilterableHeader.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt, plural } from '../i18n/translate';

const activitySummary = (row) =>
  row.recentMovements.length === 0 ? '' : row.recentMovements.map((m) => `${m.delta > 0 ? '+' : ''}${m.delta} (${m.reason})`).join(', ');

const EMPTY_FILTERS = {
  store: '',
  product: '',
  stockMin: '',
  stockMax: '',
  activity: '',
};

const norm = (value) => String(value ?? '').trim().toLowerCase();

function filterRows(rows, f) {
  const store = norm(f.store);
  const product = norm(f.product);
  const activity = norm(f.activity);
  const min = f.stockMin === '' ? null : Number(f.stockMin);
  const max = f.stockMax === '' ? null : Number(f.stockMax);
  return rows.filter((row) => {
    if (store && !norm(row.storeName).includes(store)) return false;
    if (product && !norm(row.productName).includes(product) && !norm(row.barcode).includes(product)) return false;
    if (min !== null && !(row.stock >= min)) return false;
    if (max !== null && !(row.stock <= max)) return false;
    if (activity && !norm(activitySummary(row)).includes(activity)) return false;
    return true;
  });
}

const COMPARE = {
  store: (a, b) => a.storeName.localeCompare(b.storeName),
  product: (a, b) => a.productName.localeCompare(b.productName),
  stock: (a, b) => a.stock - b.stock,
  activity: (a, b) => b.recentMovements.length - a.recentMovements.length,
};

function sortRows(rows, { col, dir }) {
  const compare = COMPARE[col];
  if (!compare) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  // Ties fall back to store then product, so the order is stable and predictable.
  return [...rows].sort((a, b) => sign * compare(a, b) || COMPARE.store(a, b) || COMPARE.product(a, b));
}

const activeFilterCount = (f) => Object.entries(EMPTY_FILTERS).filter(([key, empty]) => f[key] !== empty).length;

export default function ReconciliationPage() {
  const { t } = useLocale();
  const [error, setError] = useState('');
  const [adjustTarget, setAdjustTarget] = useState(null); // row being corrected
  const [correctedStock, setCorrectedStock] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ col: 'stock', dir: 'asc' });
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const { openFilterCol, toggleFilterCol, filterPanelRef } = useColumnFilter();
  const toggleSort = (col) =>
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  const filterCount = activeFilterCount(filters);
  // The current stock is shown in bold, so split the sentence around it.
  const [stockBefore, stockAfter] = adjustTarget
    ? fmt(t.reconciliation.currentlyShows, { store: adjustTarget.storeName }).split('{stock}')
    : [];

  // Not scoped to the AppShell's single current store — this spans every
  // store the signed-in user can access, same list GET /api/stores returns.
  // Cached (lib/queryClient.js); refreshed in the background when stale.
  const queryClient = useQueryClient();
  const rowsQuery = useQuery({ queryKey: queryKeys.negativeStock(), queryFn: () => apiClient.get('/api/reports/negative-stock') });
  const rows = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data]);
  const loading = rowsQuery.isPending;
  const visible = useMemo(() => sortRows(filterRows(rows, filters), sort), [rows, filters, sort]);
  // After a correction: this report and that store's product lists change.
  const load = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.negativeStock() }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
    ]);

  async function handleAdjust(e) {
    e.preventDefault();
    try {
      await apiClient.post(
        `/api/stores/${adjustTarget.storeId}/products/${adjustTarget.productId}/adjust-stock`,
        { correctedStock: Number(correctedStock) }
      );
      setAdjustTarget(null);
      setCorrectedStock('');
      await load();
    } catch (err) {
      setError(err?.body?.error ?? t.reconciliation.adjustFailed);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-h)]">{t.reconciliation.title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.reconciliation.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {visible.length === rows.length
              ? fmt(t.reconciliation.count, { count: rows.length, rows: plural(rows.length, t.reconciliation.row, t.reconciliation.rowsWord) })
              : fmt(t.reconciliation.countFiltered, { visible: visible.length, total: rows.length, rows: plural(rows.length, t.reconciliation.row, t.reconciliation.rowsWord) })}
          </span>
          {filterCount > 0 && (
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-sm text-[var(--accent)] font-medium cursor-pointer">
              {fmt(t.reconciliation.clearFilters, { count: filterCount })}
            </button>
          )}
        </div>
      </div>

      {(error || rowsQuery.isError) && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.reconciliation.loadFailed}</p>
      )}

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
            <tr>
              <FilterableHeader
                col="store" label={t.common.store} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'store'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.store !== EMPTY_FILTERS.store}
              >
                <input
                  value={filters.store}
                  onChange={(e) => setFilter('store', e.target.value)}
                  placeholder={t.reconciliation.filterStore}
                  className={filterInput}
                  autoFocus
                />
              </FilterableHeader>
              <FilterableHeader
                col="product" label={t.reconciliation.product} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'product'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.product !== EMPTY_FILTERS.product}
              >
                <input
                  value={filters.product}
                  onChange={(e) => setFilter('product', e.target.value)}
                  placeholder={t.reconciliation.nameOrBarcode}
                  className={filterInput}
                />
              </FilterableHeader>
              <FilterableHeader
                col="stock" label={t.reconciliation.stock} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'stock'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.stockMin !== EMPTY_FILTERS.stockMin || filters.stockMax !== EMPTY_FILTERS.stockMax}
              >
                <div className="flex gap-1">
                  <input type="number" value={filters.stockMin} onChange={(e) => setFilter('stockMin', e.target.value)} placeholder={t.reconciliation.min} className={`${filterInput} w-20`} />
                  <input type="number" value={filters.stockMax} onChange={(e) => setFilter('stockMax', e.target.value)} placeholder={t.reconciliation.max} className={`${filterInput} w-20`} />
                </div>
              </FilterableHeader>
              <FilterableHeader
                col="activity" label={t.reconciliation.recentActivity} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'activity'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.activity !== EMPTY_FILTERS.activity}
              >
                <input
                  value={filters.activity}
                  onChange={(e) => setFilter('activity', e.target.value)}
                  placeholder={t.reconciliation.contains}
                  className={filterInput}
                />
              </FilterableHeader>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={5}>
                  {t.common.loading}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={5}>
                  {rows.length === 0 ? t.reconciliation.nothingToReconcile : t.reconciliation.noMatches}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={`${row.storeId}-${row.productId}`} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{row.storeName}</td>
                  <td className="px-4 py-2">
                    {row.productName}
                    {row.barcode && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">#{row.barcode}</span>}
                  </td>
                  <td className="px-4 py-2 font-medium text-red-600 dark:text-red-400">{row.stock}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400 text-xs">
                    {activitySummary(row) || '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => {
                        setAdjustTarget(row);
                        setCorrectedStock('');
                      }}
                      className="text-[var(--accent)] font-medium cursor-pointer"
                    >
                      {t.reconciliation.setCorrectedCount}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {adjustTarget && (
        <Modal title={fmt(t.reconciliation.modalTitle, { product: adjustTarget.productName })} onClose={() => setAdjustTarget(null)}>
          <form onSubmit={handleAdjust} className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {stockBefore}
              <span className="font-medium">{adjustTarget.stock}</span>
              {stockAfter} {t.reconciliation.adjustHint}
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.reconciliation.correctedCount}</label>
              <input
                required
                type="number"
                step="1"
                value={correctedStock}
                onChange={(e) => setCorrectedStock(e.target.value)}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setAdjustTarget(null)} className="text-sm px-3 py-1.5 cursor-pointer">
                {t.common.cancel}
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer">
                {t.common.save}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
