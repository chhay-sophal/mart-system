import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../lib/apiClient';
import { useAuth } from '../auth/AuthContext.jsx';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtUsd(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function ReportsPage() {
  // Not scoped to the AppShell's single current store — "All stores" is a
  // first-class option here, sourced from the full list in AuthContext.
  const { stores } = useAuth();
  const [storeId, setStoreId] = useState('');
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // date_to is exclusive server-side (createdAt < date_to), so push it to
      // the start of the day AFTER the selected end date to include it whole.
      const inclusiveTo = new Date(dateTo);
      inclusiveTo.setDate(inclusiveTo.getDate() + 1);

      const query = { date_from: new Date(dateFrom).toISOString(), date_to: inclusiveTo.toISOString() };
      if (storeId) query.storeId = storeId;

      setReport(await apiClient.get('/api/reports/daily-summary', query));
    } catch {
      setError('Failed to load the report.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [storeId, dateFrom, dateTo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const singleStore = report?.byStore?.length === 1 ? report.byStore[0] : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">Reports</h1>
      </div>

      <div className="flex items-end gap-3 mb-4 bg-white border border-[var(--border)] rounded-xl p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Store</label>
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
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
          <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : !report ? null : (
        <>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Revenue', value: fmtUsd(report.combined.totalRevenue) },
              { label: 'Orders', value: report.combined.orderCount },
              { label: 'Avg order', value: fmtUsd(report.combined.avgOrder) },
              { label: 'Gross profit', value: fmtUsd(report.combined.grossProfit) },
            ].map((card) => (
              <div key={card.label} className="bg-white border border-[var(--border)] rounded-xl p-4">
                <p className="text-xs text-slate-500">{card.label}</p>
                <p className="text-xl font-semibold text-[var(--text-h)] mt-1">{card.value}</p>
              </div>
            ))}
          </div>

          {!storeId && report.byStore.length > 1 && (
            <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-left">
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
                      <td className="px-4 py-2">{fmtUsd(s.totalRevenue)}</td>
                      <td className="px-4 py-2">{fmtUsd(s.grossProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {singleStore && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-[var(--border)] rounded-xl p-4">
                <h2 className="text-sm font-semibold text-[var(--text-h)] mb-3">Payment breakdown</h2>
                {singleStore.byMethod.length === 0 ? (
                  <p className="text-sm text-slate-400">No orders.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {singleStore.byMethod.map((m) => (
                      <li key={m.paymentMethod} className="flex justify-between">
                        <span>{m.paymentMethod}</span>
                        <span>
                          {fmtUsd(m.total)} <span className="text-slate-400">({m.count})</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="bg-white border border-[var(--border)] rounded-xl p-4">
                <h2 className="text-sm font-semibold text-[var(--text-h)] mb-3">Top products</h2>
                {singleStore.topProducts.length === 0 ? (
                  <p className="text-sm text-slate-400">No sales.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {singleStore.topProducts.map((p) => (
                      <li key={p.productId} className="flex justify-between">
                        <span>{p.name}</span>
                        <span>
                          {p.totalQty} <span className="text-slate-400">· {fmtUsd(p.revenue)}</span>
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
