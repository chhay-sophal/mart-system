import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useDataTable } from '../hooks/useDataTable';
import Modal from '../components/Modal.jsx';
import DataTable from '../components/DataTable.jsx';
import FilterButton from '../components/FilterButton.jsx';
import FilterChips from '../components/FilterChips.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt, plural } from '../i18n/translate';

const activitySummary = (row) =>
  row.recentMovements.length === 0 ? '' : row.recentMovements.map((m) => `${m.delta > 0 ? '+' : ''}${m.delta} (${m.reason})`).join(', ');

// Store then product: pre-sorting by these gives sort ties a stable,
// predictable order (Array.prototype.sort is stable).
const byStoreThenProduct = (a, b) => a.storeName.localeCompare(b.storeName) || a.productName.localeCompare(b.productName);

export default function ReconciliationPage() {
  const { t } = useLocale();
  const [error, setError] = useState('');
  const [adjustTarget, setAdjustTarget] = useState(null); // row being corrected
  const [correctedStock, setCorrectedStock] = useState('');
  // The current stock is shown in bold, so split the sentence around it.
  const [stockBefore, stockAfter] = adjustTarget
    ? fmt(t.reconciliation.currentlyShows, { store: adjustTarget.storeName }).split('{stock}')
    : [];

  // Not scoped to the AppShell's single current store — this spans every
  // store the signed-in user can access, same list GET /api/stores returns.
  // Cached (lib/queryClient.js); refreshed in the background when stale.
  const queryClient = useQueryClient();
  const rowsQuery = useQuery({ queryKey: queryKeys.negativeStock(), queryFn: () => apiClient.get('/api/reports/negative-stock') });
  const rows = useMemo(() => [...(rowsQuery.data ?? [])].sort(byStoreThenProduct), [rowsQuery.data]);
  const loading = rowsQuery.isPending;
  const table = useDataTable({
    rows,
    initialSort: { col: 'stock', dir: 'asc' },
    columns: [
      {
        key: 'store', label: t.common.store, cellClassName: 'text-slate-500 dark:text-slate-400', render: (r) => r.storeName,
        sortValue: (r) => r.storeName, filter: { type: 'text', placeholder: t.reconciliation.filterStore },
      },
      {
        key: 'product', label: t.reconciliation.product, sortValue: (r) => r.productName,
        render: (r) => (
          <>
            {r.productName}
            {r.barcode && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">#{r.barcode}</span>}
          </>
        ),
        // Name or barcode; the newline keeps a query from matching across the two.
        filter: { type: 'text', placeholder: t.reconciliation.nameOrBarcode, value: (r) => `${r.productName}\n${r.barcode ?? ''}` },
      },
      {
        key: 'stock', label: t.reconciliation.stock, cellClassName: 'font-medium text-red-600 dark:text-red-400', sortValue: (r) => r.stock,
        filter: { type: 'numberRange', minPlaceholder: t.reconciliation.min, maxPlaceholder: t.reconciliation.max },
      },
      {
        key: 'activity', label: t.reconciliation.recentActivity, cellClassName: 'text-slate-500 dark:text-slate-400 text-xs',
        render: (r) => activitySummary(r) || '—',
        // Most recent movements first when ascending.
        sortValue: (r) => -r.recentMovements.length,
        filter: { type: 'text', placeholder: t.reconciliation.contains, value: activitySummary },
      },
      {
        key: 'actions', label: '', cellClassName: 'text-right',
        render: (r) => (
          <button
            onClick={() => {
              setAdjustTarget(r);
              setCorrectedStock('');
            }}
            className="text-[var(--accent)] font-medium cursor-pointer"
          >
            {t.reconciliation.setCorrectedCount}
          </button>
        ),
      },
    ],
  });
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
          <FilterButton table={table} />
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {table.visible.length === rows.length
              ? fmt(t.reconciliation.count, { count: rows.length, rows: plural(rows.length, t.reconciliation.row, t.reconciliation.rowsWord) })
              : fmt(t.reconciliation.countFiltered, { visible: table.visible.length, total: rows.length, rows: plural(rows.length, t.reconciliation.row, t.reconciliation.rowsWord) })}
          </span>
          {table.filterCount > 0 && (
            <button onClick={table.clearFilters} className="text-sm text-[var(--accent)] font-medium cursor-pointer">
              {fmt(t.reconciliation.clearFilters, { count: table.filterCount })}
            </button>
          )}
        </div>
      </div>

      {(error || rowsQuery.isError) && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.reconciliation.loadFailed}</p>
      )}

      <FilterChips table={table} />
      <DataTable
        table={table}
        rowKey={(r) => `${r.storeId}-${r.productId}`}
        loading={loading}
        emptyText={t.reconciliation.nothingToReconcile}
        noMatchText={t.reconciliation.noMatches}
      />

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
