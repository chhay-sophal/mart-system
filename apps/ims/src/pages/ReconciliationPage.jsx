import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import Modal from '../components/Modal.jsx';

export default function ReconciliationPage() {
  const [error, setError] = useState('');
  const [adjustTarget, setAdjustTarget] = useState(null); // row being corrected
  const [correctedStock, setCorrectedStock] = useState('');

  // Not scoped to the AppShell's single current store — this spans every
  // store the signed-in user can access, same list GET /api/stores returns.
  // Cached (lib/queryClient.js); refreshed in the background when stale.
  const queryClient = useQueryClient();
  const rowsQuery = useQuery({ queryKey: queryKeys.negativeStock(), queryFn: () => apiClient.get('/api/reports/negative-stock') });
  const rows = rowsQuery.data ?? [];
  const loading = rowsQuery.isPending;
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
      setError(err?.body?.error ?? 'Failed to adjust stock.');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-h)]">Stock reconciliation</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Products whose stock has gone negative across every store you can access — a sale or transfer went
            through when the shelf count didn't match the system.
          </p>
        </div>
      </div>

      {(error || rowsQuery.isError) && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || 'Failed to load the negative-stock report.'}</p>
      )}

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
            <tr>
              <th className="px-4 py-2">Store</th>
              <th className="px-4 py-2">Product</th>
              <th className="px-4 py-2">Stock</th>
              <th className="px-4 py-2">Recent activity</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={5}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={5}>
                  Nothing to reconcile — no store has negative stock right now.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.storeId}-${row.productId}`} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{row.storeName}</td>
                  <td className="px-4 py-2">
                    {row.productName}
                    {row.barcode && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">#{row.barcode}</span>}
                  </td>
                  <td className="px-4 py-2 font-medium text-red-600 dark:text-red-400">{row.stock}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400 text-xs">
                    {row.recentMovements.length === 0
                      ? '—'
                      : row.recentMovements
                          .map((m) => `${m.delta > 0 ? '+' : ''}${m.delta} (${m.reason})`)
                          .join(', ')}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => {
                        setAdjustTarget(row);
                        setCorrectedStock('');
                      }}
                      className="text-[var(--accent)] font-medium cursor-pointer"
                    >
                      Set corrected count
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {adjustTarget && (
        <Modal title={`Correct stock — ${adjustTarget.productName}`} onClose={() => setAdjustTarget(null)}>
          <form onSubmit={handleAdjust} className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {adjustTarget.storeName} currently shows <span className="font-medium">{adjustTarget.stock}</span>.
              Enter the actual physical count — this is recorded as an audited adjustment, not silently overwritten.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Corrected stock count</label>
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
                Cancel
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer">
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
