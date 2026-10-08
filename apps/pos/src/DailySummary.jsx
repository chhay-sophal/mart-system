import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import { ArrowLeft, ChevronLeft, ChevronRight, Printer, WifiOff } from 'lucide-react';
import { translations as t } from './locales';
import { useBackend } from './BackendContext';
import { useToast } from './Toast';
import { usdToKhr } from './khr';
import { useShortcuts } from './hooks/useShortcuts';
import { queryKeys } from './queryClient';
import { PRINT_WIDTH_MM } from './receipt/raster';
import { printBlocksDirect, printerConfig } from './receipt/thermalPrinter';
import { buildDailySummary } from './receipt/dailySummaryModel';

const pad = n => String(n).padStart(2, '0');
const errorText = (err) => (typeof err === 'string' ? err : err?.message) || String(err);

const toSqliteDate = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00`;

export default function DailySummary({ onBackToRegister, currentLocale, dynamicRate, mainCurrency, shop = {}, printer: printerProp }) {
  const client = useBackend();
  const notify = useToast();
  // Same default-if-unset pattern as Invoice.jsx, and the same mechanism
  // (react-to-print, not window.print()/webview.print()) -- that ad-hoc pair
  // blanks the app inside the Tauri window (issue #9), which is exactly why
  // receipts already print this way instead.
  const [printer] = useState(() => printerProp ?? printerConfig());
  const paperMm = PRINT_WIDTH_MM[printer.paper] ?? PRINT_WIDTH_MM[58];
  const printRef = useRef(null);

  const [selectedDate, setSelectedDate] = useState(new Date());

  const s = (t[currentLocale] || {}).dailySummary || {};

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `daily-summary-${toSqliteDate(selectedDate).slice(0, 10)}`,
    pageStyle: `
      @page { size: ${printer.paper}mm auto; margin: 2mm; }
      html, body { margin: 0; padding: 0; background: #fff; }
    `,
  });

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

  // Cached per day (queryClient.js): stepping back to a day already viewed,
  // or re-opening the screen, is instant; refreshed in the background when stale.
  const dayFrom = toSqliteDate(selectedDate);
  const summaryQuery = useQuery({
    queryKey: queryKeys.dailySummary(dayFrom),
    queryFn: () => {
      const next = new Date(selectedDate);
      next.setDate(next.getDate() + 1);
      return client.get('/api/summary/daily', { date_from: dayFrom, date_to: toSqliteDate(next) });
    },
  });
  const summary = summaryQuery.data ?? null;
  const loading = summaryQuery.isPending;

  const prevDay = () => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; });
  const nextDay = () => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; });
  // Previous / next day by keyboard (issue #7; ← / →, see shortcuts.js).
  // Next stops at today, like the button.
  useShortcuts({
    prevDay: { run: prevDay },
    nextDay: { when: () => !isToday(selectedDate), run: nextDay },
  });

  const isKhr = mainCurrency === 'KHR';
  // `khr`: the exact riel sum the summary reports for revenue (riel sales as
  // charged); anything without one is converted from USD.
  const fmt = (n, khr) => isKhr
    ? `${(khr ?? usdToKhr(n, dynamicRate)).toLocaleString()} ៛`
    : `${Number(n || 0).toFixed(2)}`;
  const fmtSub = (n) => isKhr
    ? `≈ $${Number(n || 0).toFixed(2)}`
    : `≈ ${usdToKhr(n, dynamicRate).toLocaleString()} ៛`;

  const methodLabel = (m) => ({ CASH: s.cash || 'Cash', KHQR: 'KHQR', STATIC_QR: s.staticQr || 'Bank QR' }[m] || m);
  const methodColor = (m) => ({ CASH: 'bg-emerald-500', KHQR: 'bg-indigo-500', STATIC_QR: 'bg-amber-500' }[m] || 'bg-slate-400');

  const maxMethodTotal = summary?.by_method?.length
    ? Math.max(...summary.by_method.map(m => m.total), 1)
    : 1;

  const hasData = summary && summary.order_count > 0;

  // Mirrors Invoice.jsx: a thermal printer set up for direct printing
  // (Settings > Printer) gets the report as raw ESC/POS, bypassing the
  // system print dialog entirely; otherwise it prints the same way it
  // already did, through the hidden copy below and react-to-print.
  async function handlePrintClick() {
    if (!hasData || !printer.direct) return handlePrint();
    try {
      await printBlocksDirect(
        buildDailySummary({
          summary,
          shop,
          title: s.title || 'Daily Sales Summary',
          dateLabel: formatDisplayDate(selectedDate),
          fmt,
          methodLabel,
          s,
        }),
        printer
      );
    } catch (err) {
      notify((s.printFailedReason || "Couldn't print the report: {error}").replace('{error}', errorText(err)));
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col font-sans text-slate-900 dark:text-white antialiased">

      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center gap-4 shadow-xs flex-shrink-0">
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
          onClick={handlePrintClick}
          className="px-4 py-2 bg-slate-800 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-slate-700 dark:hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <Printer size={13} />{s.print || 'Print'}
        </button>
      </header>

      {/* Scrolling lives on this full-width div, not the centered column below
          it -- otherwise the scrollbar sits at the column's edge, floating in
          the middle of the window instead of against its right edge. */}
      <div className="flex-1 overflow-y-auto">
      <div className="p-4 md:p-6 max-w-2xl mx-auto w-full space-y-4">

        {/* Date navigation */}
        <div className="flex items-center justify-between bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-3">
          <button onClick={prevDay} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer">
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
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Store-wide when online; sidecar storeReports.js falls back to this register only. */}
        {!loading && summary?.offline && (
          <div className="mb-4 flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2.5 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
            <WifiOff size={14} className="flex-shrink-0" />
            {s.offlineNotice}
          </div>
        )}

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
                  value: fmt(summary.total_revenue, summary.total_revenue_khr),
                  sub: isKhr ? fmtSub(summary.total_revenue) : `≈ ${(summary.total_revenue_khr ?? usdToKhr(summary.total_revenue, dynamicRate)).toLocaleString()} ៛`,
                  color: 'text-slate-900 dark:text-white',
                },
                {
                  label: s.orders || 'Orders',
                  value: summary.order_count,
                  sub: `${s.avg || 'Avg'} ${fmt(summary.avg_order, summary.avg_order_khr)}`,
                  color: 'text-slate-900 dark:text-white',
                },
                {
                  label: s.grossProfit || 'Gross Profit',
                  value: fmt(summary.gross_profit, summary.gross_profit_khr),
                  sub: isKhr ? fmtSub(summary.gross_profit) : `≈ ${(summary.gross_profit_khr ?? usdToKhr(summary.gross_profit, dynamicRate)).toLocaleString()} ៛`,
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
                          {fmt(m.total, m.total_khr)}{' '}
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

            {/* Products sold -- every product sold this day (all_products),
                not just the top few; falls back to top_products against an
                older paired backend that hasn't picked up all_products yet. */}
            {(summary.all_products ?? summary.top_products ?? []).length > 0 && (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
                <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 font-display">
                  {s.productsSold || 'Products Sold'}
                </h2>
                <div className="flex items-center gap-3 px-0 mb-1">
                  <span className="w-4 shrink-0" />
                  <span className="flex-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{s.topProducts || 'Product'}</span>
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider shrink-0">{s.colQty || 'Qty'}</span>
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider w-16 text-right shrink-0">{s.colRevenue || 'Revenue'}</span>
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider w-16 text-right shrink-0">{s.colProfit || 'Profit'}</span>
                </div>
                <div className="space-y-3">
                  {(summary.all_products ?? summary.top_products ?? []).map((p, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-300 dark:text-slate-600 w-4 text-right shrink-0">{i + 1}</span>
                      <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{p.name}</span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{p.total_qty}</span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white w-16 text-right shrink-0">{fmt(p.revenue, p.revenue_khr)}</span>
                      <span className={`text-sm font-bold w-16 text-right shrink-0 ${(p.profit ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                        {fmt(p.profit, p.profit_khr)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {/* Off-screen: react-to-print copies only this ref, at the configured
          paper width, into the print window -- the visible report above
          (styled for screen, and capped to the top 5 products) never prints. */}
      <div style={{ position: 'fixed', top: '-10000px', left: '-10000px', pointerEvents: 'none' }} aria-hidden="true">
        {hasData && (
          <div ref={printRef} style={{ width: `${paperMm}mm` }} className="bg-white text-black font-sans text-[10px] leading-snug px-1">
            {shop.storeName && <p className="text-center font-bold text-xs">{shop.storeName}</p>}
            {shop.storeAddress && <p className="text-center text-[9px]">{shop.storeAddress}</p>}
            <p className="text-center font-bold text-xs mt-1">{s.title || 'Daily Sales Summary'}</p>
            <p className="text-center mb-1.5">{formatDisplayDate(selectedDate)}</p>
            <hr className="border-dashed border-black my-1" />

            <div className="flex justify-between"><span>{s.revenue || 'Revenue'}</span><span className="font-bold">{fmt(summary.total_revenue, summary.total_revenue_khr)}</span></div>
            <div className="flex justify-between"><span>{s.orders || 'Orders'}</span><span className="font-bold">{summary.order_count}</span></div>
            <div className="flex justify-between"><span>{s.avg || 'Avg'}</span><span>{fmt(summary.avg_order, summary.avg_order_khr)}</span></div>
            <div className="flex justify-between"><span>{s.grossProfit || 'Gross Profit'}</span><span className="font-bold">{fmt(summary.gross_profit, summary.gross_profit_khr)}</span></div>
            <div className="flex justify-between">
              <span>{s.margin || 'Margin'}</span>
              <span>{summary.total_revenue > 0 ? `${((summary.gross_profit / summary.total_revenue) * 100).toFixed(1)}%` : '—'}</span>
            </div>

            {summary.by_method?.length > 0 && (
              <>
                <hr className="border-dashed border-black my-1" />
                <p className="font-bold uppercase">{s.paymentBreakdown || 'Payment Breakdown'}</p>
                {summary.by_method.map((m) => (
                  <div key={m.payment_method} className="flex justify-between">
                    <span>{methodLabel(m.payment_method)} ({m.count})</span>
                    <span>{fmt(m.total, m.total_khr)}</span>
                  </div>
                ))}
              </>
            )}

            <hr className="border-dashed border-black my-1" />
            <p className="font-bold uppercase">{s.productsSold || 'Products Sold'}</p>
            <div className="flex gap-1 font-bold border-b border-black pb-0.5 mb-0.5">
              <span className="flex-1">{s.topProducts || 'Product'}</span>
              <span className="w-6 text-right shrink-0">{s.colQty || 'Qty'}</span>
              <span className="w-12 text-right shrink-0">{s.colRevenue || 'Revenue'}</span>
              <span className="w-12 text-right shrink-0">{s.colProfit || 'Profit'}</span>
            </div>
            {/* all_products: every product sold that day, not just the top 5
                shown on screen above -- falls back to top_products against an
                older paired backend that hasn't picked up all_products yet. */}
            {(summary.all_products ?? summary.top_products ?? []).map((p, i) => (
              <div key={i} className="flex gap-1">
                <span className="flex-1 truncate">{p.name}</span>
                <span className="w-6 text-right shrink-0">{p.total_qty}</span>
                <span className="w-12 text-right shrink-0">{fmt(p.revenue, p.revenue_khr)}</span>
                <span className="w-12 text-right shrink-0">{fmt(p.profit, p.profit_khr)}</span>
              </div>
            ))}

            <hr className="border-dashed border-black my-1" />
            <p className="text-center text-[9px]">{new Date().toLocaleString()}</p>
          </div>
        )}
      </div>
    </div>
  );
}
