import React, { useState, useEffect, useCallback, useContext } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { translations as t } from './locales';
import BackendContext from './BackendContext';

const IS_TAURI = Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__);

export default function DailySummary({ onBackToRegister, currentLocale, dynamicRate, mainCurrency }) {
  const BACKEND_URL = useContext(BackendContext);

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const s = (t[currentLocale] || {}).dailySummary || {};

  const handlePrint = async () => {
    if (IS_TAURI) {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        await getCurrentWebviewWindow().print();
      } catch {
        window.print();
      }
    } else {
      window.print();
    }
  };

  const pad = n => String(n).padStart(2, '0');

  const toSqliteDate = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00`;

  const formatDisplayDate = (d) => {
    const months = s.months || ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const month = months[d.getMonth()];
    const day = d.getDate();
    const year = d.getFullYear();
    return s.dateOrder === 'DMY'
      ? `${day} ${month} ${year}`
      : `${month} ${day}, ${year}`;
  };

  const isToday = (d) => {
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
  };

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setSummary(null);
    try {
      const date_from = toSqliteDate(selectedDate);
      const next = new Date(selectedDate);
      next.setDate(next.getDate() + 1);
      const date_to = toSqliteDate(next);
      const res = await fetch(
        `${BACKEND_URL}/api/summary/daily?date_from=${encodeURIComponent(date_from)}&date_to=${encodeURIComponent(date_to)}`
      );
      if (res.ok) setSummary(await res.json());
    } catch {}
    setLoading(false);
  }, [selectedDate, BACKEND_URL]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const prevDay = () => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; });
  const nextDay = () => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; });

  const isKhr = mainCurrency === 'KHR';
  const fmt = (n) => isKhr
    ? `${Math.round((n || 0) * (dynamicRate || 4100)).toLocaleString()} ៛`
    : `$${Number(n || 0).toFixed(2)}`;
  const fmtSub = (n) => isKhr
    ? `≈ $${Number(n || 0).toFixed(2)}`
    : `≈ ${Math.round((n || 0) * (dynamicRate || 4100)).toLocaleString()} ៛`;

  const methodLabel = (m) => ({ CASH: s.cash || 'Cash', KHQR: 'KHQR', STATIC_QR: s.staticQr || 'Bank QR' }[m] || m);
  const methodColor = (m) => ({ CASH: 'bg-emerald-500', KHQR: 'bg-indigo-500', STATIC_QR: 'bg-amber-500' }[m] || 'bg-slate-400');

  const maxMethodTotal = summary?.by_method?.length
    ? Math.max(...summary.by_method.map(m => m.total), 1)
    : 1;

  const hasData = summary && summary.order_count > 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col font-sans text-slate-900 dark:text-white antialiased">

      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center gap-4 shadow-xs flex-shrink-0 print:hidden">
        <button
          onClick={onBackToRegister}
          className="px-3.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 border border-transparent hover:border-slate-200 dark:hover:border-slate-600 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 transition-all flex items-center gap-1.5 cursor-pointer"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight font-display">
            {s.title || 'Daily Sales Summary'}
          </h1>
          <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 tracking-wider uppercase">
            {s.subtitle || 'End of Day Report'}
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="px-4 py-2 bg-slate-800 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-slate-700 dark:hover:bg-slate-100 transition-colors cursor-pointer print:hidden"
        >
          <Printer size={13} />{s.print || 'Print'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 max-w-2xl mx-auto w-full space-y-4">

        {/* Date navigation */}
        <div className="flex items-center justify-between bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-3 print:border-none print:px-0">
          <button onClick={prevDay} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer print:hidden">
            <ChevronLeft size={18} />
          </button>
          <div className="text-center">
            <p className="text-base font-bold text-slate-900 dark:text-white font-display">{formatDisplayDate(selectedDate)}</p>
            {isToday(selectedDate) && (
              <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">{s.today || 'Today'}</span>
            )}
          </div>
          <button
            onClick={nextDay}
            disabled={isToday(selectedDate)}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default print:hidden"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="text-center py-16 text-slate-400 dark:text-slate-500 text-sm font-bold">
            {s.loading || 'Loading...'}
          </div>
        ) : !hasData ? (
          <div className="text-center py-16 text-slate-400 dark:text-slate-500">
            <p className="text-sm font-bold">{s.noOrders || 'No orders recorded for this day.'}</p>
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: s.revenue || 'Revenue',
                  value: fmt(summary.total_revenue),
                  sub: fmtSub(summary.total_revenue),
                  color: 'text-slate-900 dark:text-white',
                },
                {
                  label: s.orders || 'Orders',
                  value: summary.order_count,
                  sub: `${s.avg || 'Avg'} ${fmt(summary.avg_order)}`,
                  color: 'text-slate-900 dark:text-white',
                },
                {
                  label: s.grossProfit || 'Gross Profit',
                  value: fmt(summary.gross_profit),
                  sub: fmtSub(summary.gross_profit),
                  color: summary.gross_profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500',
                },
                {
                  label: s.margin || 'Margin',
                  value: summary.total_revenue > 0
                    ? `${((summary.gross_profit / summary.total_revenue) * 100).toFixed(1)}%`
                    : '—',
                  sub: s.profitOverRevenue || 'Profit / Revenue',
                  color: 'text-slate-900 dark:text-white',
                },
              ].map(card => (
                <div key={card.label} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
                  <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{card.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{card.sub}</p>
                </div>
              ))}
            </div>

            {/* Payment breakdown */}
            {summary.by_method?.length > 0 && (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
                <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 font-display">
                  {s.paymentBreakdown || 'Payment Breakdown'}
                </h2>
                <div className="space-y-4">
                  {summary.by_method.map(m => (
                    <div key={m.payment_method}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{methodLabel(m.payment_method)}</span>
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {fmt(m.total)}{' '}
                          <span className="text-xs font-normal text-slate-400">{m.count} {s.txCount || 'txns'}</span>
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${methodColor(m.payment_method)}`}
                          style={{ width: `${Math.max((m.total / maxMethodTotal) * 100, 3)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top products */}
            {summary.top_products?.length > 0 && (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
                <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 font-display">
                  {s.topProducts || 'Top Products'}
                </h2>
                <div className="flex items-center gap-3 px-0 mb-1">
                  <span className="w-4 shrink-0" />
                  <span className="flex-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{s.topProducts || 'Product'}</span>
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider shrink-0">{s.colQty || 'Qty'}</span>
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider w-16 text-right shrink-0">{s.colRevenue || 'Revenue'}</span>
                </div>
                <div className="space-y-3">
                  {summary.top_products.map((p, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-300 dark:text-slate-600 w-4 text-right shrink-0">{i + 1}</span>
                      <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{p.name}</span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{p.total_qty}</span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white w-16 text-right shrink-0">{fmt(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
