import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useAuth } from '../auth/AuthContext.jsx';
import { inMainCurrency, usdToKhr } from '../lib/orderTotals';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Revenue comes summed in both currencies (riel exact for riel sales). Other
// figures are USD; riel stores see them converted at the store's rate.
const money = (store, usd, khr) => inMainCurrency(store.mainCurrency, usd, khr ?? usdToKhr(usd, store.rate));

function Amount({ value }) {
  return (
    <>
      {value.primary} <span className="text-slate-400 dark:text-slate-500 text-xs">{value.secondary}</span>
    </>
  );
}

export default function ReportsPage() {
  // Not scoped to the AppShell's single current store — "All stores" is a
  // first-class option here, sourced from the full list in AuthContext.
  const { stores } = useAuth();
  const [storeId, setStoreId] = useState('');
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(todayStr());

  // Cached per store + date range (lib/queryClient.js): flipping back to a
  // range already viewed is instant, refreshed in the background when stale.
  const reportQuery = useQuery({
    queryKey: queryKeys.dailySummary({ storeId, dateFrom, dateTo }),
    queryFn: () => {
      // date_to is exclusive server-side (createdAt < date_to), so push it to
      // the start of the day AFTER the selected end date to include it whole.
      const inclusiveTo = new Date(dateTo);
      inclusiveTo.setDate(inclusiveTo.getDate() + 1);
      const query = { date_from: new Date(dateFrom).toISOString(), date_to: inclusiveTo.toISOString() };
      if (storeId) query.storeId = storeId;
      return apiClient.get('/api/reports/daily-summary', query);
    },
    placeholderData: (previous) => previous, // keep the last report on screen while a new range loads
  });
  const report = reportQuery.data ?? null;
  const loading = reportQuery.isPending;
  const error = reportQuery.isError ? 'Failed to load the report.' : '';

  const singleStore = report?.byStore?.length === 1 ? report.byStore[0] : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">Reports</h1>
      </div>

      <div className="flex items-end gap-3 mb-4 bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Store</label>
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
          >
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
      ) : !report ? null : (
        <>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Revenue', value: inMainCurrency(report.combined.mainCurrency, report.combined.totalRevenue, report.combined.totalRevenueKhr) },
              { label: 'Orders', value: { primary: report.combined.orderCount } },
              { label: 'Avg order', value: inMainCurrency(report.combined.mainCurrency, report.combined.avgOrder, report.combined.avgOrderKhr) },
              {
                label: 'Gross profit',
                value: inMainCurrency(
                  report.combined.mainCurrency,
                  report.combined.grossProfit,
                  report.byStore.reduce((sum, st) => sum + usdToKhr(st.grossProfit, st.rate), 0),
                ),
              },
            ].map((card) => (
              <div key={card.label} className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">{card.label}</p>
                <p className="text-xl font-semibold text-[var(--text-h)] mt-1">{card.value.primary}</p>
                {card.value.secondary && <p className="text-xs text-slate-500 dark:text-slate-400">{card.value.secondary}</p>}
              </div>
            ))}
          </div>

          {!storeId && report.byStore.length > 1 && (
            <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
                  <tr>
                    <th className="px-4 py-2">Store</th>
                    <th className="px-4 py-2">Orders</th>
                    <th className="px-4 py-2">Revenue</th>
                    <th className="px-4 py-2">Gross profit</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byStore.map((s) => (
                    <tr key={s.storeId} className="border-t border-[var(--border)]">
                      <td className="px-4 py-2">{s.storeName}</td>
                      <td className="px-4 py-2">{s.orderCount}</td>
                      <td className="px-4 py-2"><Amount value={money(s, s.totalRevenue, s.totalRevenueKhr)} /></td>
                      <td className="px-4 py-2"><Amount value={money(s, s.grossProfit)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {singleStore && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-4">
                <h2 className="text-sm font-semibold text-[var(--text-h)] mb-3">Payment breakdown</h2>
                {singleStore.byMethod.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500">No orders.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {singleStore.byMethod.map((m) => (
                      <li key={m.paymentMethod} className="flex justify-between">
                        <span>{m.paymentMethod}</span>
                        <span>
                          {money(singleStore, m.total, m.totalKhr).primary} <span className="text-slate-400 dark:text-slate-500">({m.count})</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-4">
                <h2 className="text-sm font-semibold text-[var(--text-h)] mb-3">Top products</h2>
                {singleStore.topProducts.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500">No sales.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {singleStore.topProducts.map((p) => (
                      <li key={p.productId} className="flex justify-between">
                        <span>{p.name}</span>
                        <span>
                          {p.totalQty} <span className="text-slate-400 dark:text-slate-500">· {money(singleStore, p.revenue).primary}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
