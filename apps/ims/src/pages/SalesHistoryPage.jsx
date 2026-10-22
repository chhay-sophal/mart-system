import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { ApiError } from '@mart-system/api-client';
import { useAuth } from '../auth/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt as fill } from '../i18n/translate';
import Modal from '../components/Modal.jsx';
import { useDataTable } from '../hooks/useDataTable';
import DataTable from '../components/DataTable.jsx';
import FilterButton from '../components/FilterButton.jsx';
import FilterChips from '../components/FilterChips.jsx';
import SearchInput from '../components/SearchInput.jsx';
import { useSearch } from '../hooks/useSearch';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { printReceipt } from '../lib/receipt';
import { fmtKhr, fmtUsd, inMainCurrency, mainCurrencyOf, orderTotal, orderTotalKhr, roundKhr } from '../lib/orderTotals';
import { Ban, Download, Printer } from 'lucide-react';

// IMS counterpart of POS Order History (issue #6): the same filters, sorting,
// export and receipt reprint, for one branch or all of them. Rows come from
// GET /api/orders in the POS's snake_case shape (totals: lib/orderTotals.js).

const PAGE_SIZE = 20;
const PAYMENT_METHODS = ['CASH', 'KHQR', 'STATIC_QR', 'CARD'];

// Riel is shown to the nearest 100 (the smallest note), like the POS.
const fmtDateTime = (iso, locale) =>
  new Date(iso).toLocaleString(locale === 'km' ? 'km-KH' : 'en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const itemCount = (o) => (o.items || []).reduce((sum, i) => sum + i.quantity, 0);
const isVoided = (o) => o.status === 'VOIDED';

// Local-getter-based, not `date.toISOString().slice(0, 10)`: that converts to
// UTC first, so anywhere east of UTC it can silently land on the wrong
// calendar day for part of the local day.
const toLocalDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// dateFrom/dateTo are plain 'YYYY-MM-DD' (<input type="date"> values, local
// time, no timezone). Empty means unbounded on that side -- "All time" is
// just both sides empty, not a distinct mode. Shared by the main list filter
// and the export modal below.
function getDateRange(dateFrom, dateTo) {
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
  let to = null;
  if (dateTo) {
    to = new Date(`${dateTo}T00:00:00`);
    to.setDate(to.getDate() + 1); // exclusive upper bound -- through the end of the selected day
  }
  return { from: from ? from.toISOString() : null, to: to ? to.toISOString() : null };
}

const DATE_PRESETS = ['today', 'yesterday', '7d', '30d', 'all'];

// The {from, to} the date inputs land on for each shortcut -- shared by
// applyDatePreset (sets it) and the active-chip check (detects it), so they
// can never silently drift apart. 'month' is export-only (see ExportModal).
function presetRange(preset) {
  const today = new Date();
  const fmt = toLocalDateStr;
  const todayStr = fmt(today);
  if (preset === 'today') return { from: todayStr, to: todayStr };
  if (preset === 'yesterday') { const d = new Date(today); d.setDate(d.getDate() - 1); const y = fmt(d); return { from: y, to: y }; }
  if (preset === '7d')  { const d = new Date(today); d.setDate(d.getDate() - 7);  return { from: fmt(d), to: todayStr }; }
  if (preset === '30d') { const d = new Date(today); d.setDate(d.getDate() - 30); return { from: fmt(d), to: todayStr }; }
  if (preset === 'month') return { from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), to: todayStr };
  return { from: '', to: '' }; // 'all'
}

// Headers come from t.sales.exportColumns[key].
const EXPORT_COLUMNS = [
  { key: 'receipt', wch: 12, val: (o) => o.receipt_no },
  { key: 'date', wch: 12, val: (o) => new Date(o.created_at).toLocaleDateString('en-US') },
  { key: 'time', wch: 10, val: (o) => new Date(o.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) },
  { key: 'branch', wch: 18, val: (o) => o.store_name },
  { key: 'register', wch: 18, val: (o) => o.terminal_name },
  { key: 'items', wch: 8, val: (o) => itemCount(o) },
  { key: 'totalUsd', wch: 12, val: (o) => Number(Number(o.total_amount).toFixed(2)) },
  { key: 'totalKhr', wch: 14, val: (o) => orderTotalKhr(o) },
  { key: 'payment', wch: 10, val: (o, t) => t.sales.methods[o.payment_method] ?? o.payment_method },
  { key: 'bank', wch: 10, val: (o) => o.bank_name ?? '' },
  { key: 'paidUsd', wch: 12, val: (o) => o.amount_paid_usd },
  { key: 'paidKhr', wch: 12, val: (o) => o.amount_paid_khr },
  { key: 'changeKhr', wch: 13, val: (o) => o.change_given_khr },
  { key: 'status', wch: 11, val: (o, t) => t.sales.statuses[o.status] ?? o.status },
  { key: 'products', wch: 40, val: (o) => (o.items || []).map((i) => `${i.product_name} x${i.quantity}`).join(', ') },
];
const DEFAULT_EXPORT_COLUMNS = ['receipt', 'date', 'time', 'branch', 'items', 'totalUsd', 'totalKhr', 'payment', 'status'];

export default function SalesHistoryPage() {
  const { storeId: currentStoreId } = useOutletContext();
  const { stores } = useAuth();
  const { t, locale } = useLocale();

  const [storeFilter, setStoreFilter] = useState(currentStoreId ?? '');
  // Free-form date range, not a fixed set of periods -- defaults to today.
  const [dateFrom, setDateFrom] = useState(() => toLocalDateStr(new Date()));
  const [dateTo, setDateTo] = useState(() => toLocalDateStr(new Date()));
  const [showVoided, setShowVoided] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState(null);

  const [error, setError] = useState('');
  const [voidTarget, setVoidTarget] = useState(null);
  const [voiding, setVoiding] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const allBranches = storeFilter === '';

  // Cached per branch + range (lib/queryClient.js): re-opening the tab or
  // flipping back to a filter already viewed is instant, refreshed in the
  // background when stale.
  const queryClient = useQueryClient();
  const ordersKey = queryKeys.orders({ storeId: storeFilter, dateFrom, dateTo });
  const ordersQuery = useQuery({
    queryKey: ordersKey,
    queryFn: () => {
      const { from, to } = getDateRange(dateFrom, dateTo);
      const query = {};
      if (storeFilter) query.storeId = storeFilter;
      if (from) query.date_from = from;
      if (to) query.date_to = to;
      return apiClient.get('/api/orders', query);
    },
    placeholderData: (previous) => previous, // keep the last rows on screen while a new filter loads
  });
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const loading = ordersQuery.isPending;

  // Quick shortcuts onto the same free-form range the date inputs edit --
  // "All" is just both sides cleared, not a separate mode.
  const applyDatePreset = (preset) => {
    const { from, to } = presetRange(preset);
    setDateFrom(from);
    setDateTo(to);
  };
  // Highlights a preset chip only while the inputs still exactly match it --
  // editing a date by hand deselects every chip, which is the correct "this
  // is now a custom range" signal rather than a stale/misleading highlight.
  const activeDatePreset = DATE_PRESETS.find((p) => {
    const r = presetRange(p);
    return r.from === dateFrom && r.to === dateTo;
  });

  // The filter bar's search and show-voided toggle narrow the fetched rows
  // first; the table's filters (Filter button) narrow further. Its branch/register
  // filters work within the already-fetched rows (the Branch select
  // above still drives which branch's data is fetched at all).
  const shownOrders = useMemo(() => orders.filter((o) => showVoided || !isVoided(o)), [orders, showVoided]);
  const search = useSearch(shownOrders, [
    (o) => o.receipt_no,
    (o) => o.terminal_name,
    (o) => o.store_name,
    (o) => (o.items || []).flatMap((i) => [i.product_name, i.barcode]),
  ]);

  const nowrap = 'whitespace-nowrap';
  const table = useDataTable({
    rows: search.results,
    initialSort: { col: 'date', dir: 'desc' },
    columns: [
      {
        key: 'receipt', label: t.sales.receiptNo, cellClassName: `font-medium ${nowrap}`, sortValue: (o) => o.receipt_no,
        filter: { type: 'text', placeholder: t.sales.contains },
        render: (o) => (
          <>
            #{o.receipt_no}
            {isVoided(o) && <span className="ml-2 text-[10px] font-semibold uppercase bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded px-1.5 py-0.5">{t.sales.voided}</span>}
          </>
        ),
      },
      // Date stays sort-only: the filter bar above already drives the actual
      // date range this page fetches (with quick presets), so a second date
      // filter here would just duplicate it.
      {
        key: 'date', label: t.common.date, cellClassName: nowrap, sortValue: (o) => new Date(o.created_at).getTime(),
        render: (o) => fmtDateTime(o.created_at, locale),
      },
      ...(allBranches
        ? [{ key: 'branch', label: t.sales.branch, sortValue: (o) => o.store_name, render: (o) => o.store_name, filter: { type: 'text', placeholder: t.sales.contains } }]
        : []),
      { key: 'register', label: t.sales.register, sortValue: (o) => o.terminal_name, render: (o) => o.terminal_name, filter: { type: 'text', placeholder: t.sales.contains } },
      {
        key: 'items', label: t.sales.items, className: 'text-center', sortValue: itemCount, render: itemCount,
        filter: { type: 'numberRange', minPlaceholder: t.sales.min, maxPlaceholder: t.sales.max },
      },
      {
        key: 'total', label: t.common.total, className: 'text-right', sortValue: (o) => Number(o.total_amount),
        filter: { type: 'numberRange', minPlaceholder: t.sales.min, maxPlaceholder: t.sales.max },
        render: (o) => (
          <span className={`${nowrap} ${isVoided(o) ? 'line-through' : ''}`}>
            <span className="font-medium">{orderTotal(o).primary}</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">{orderTotal(o).secondary}</span>
          </span>
        ),
      },
      // Its filter is also driven by the Payment select in the filter bar above.
      {
        key: 'payment', label: t.sales.payment, cellClassName: nowrap, sortValue: (o) => o.payment_method,
        filter: { type: 'select', value: (o) => o.payment_method, options: PAYMENT_METHODS.map((m) => ({ value: m, label: t.sales.methods[m] })) },
        render: (o) => (
          <>
            {t.sales.methods[o.payment_method] ?? o.payment_method}
            {o.bank_name && <span className="text-xs text-slate-500 dark:text-slate-400"> · {o.bank_name}</span>}
          </>
        ),
      },
    ],
  });
  const filtered = table.visible;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [storeFilter, dateFrom, dateTo, search.query, showVoided, table.sort, table.filters]);

  const counted = filtered.filter((o) => !isVoided(o));
  const revenueUsd = counted.reduce((sum, o) => sum + Number(o.total_amount), 0);
  const revenueKhr = counted.reduce((sum, o) => sum + orderTotalKhr(o), 0);
  const leadCurrency = mainCurrencyOf(counted);
  const revenue = inMainCurrency(leadCurrency, revenueUsd, revenueKhr);
  const average = inMainCurrency(
    leadCurrency,
    counted.length ? revenueUsd / counted.length : 0,
    counted.length ? roundKhr(revenueKhr / counted.length) : 0,
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const voidBody = voidTarget
    ? t.sales.voidBody.split('{receipt}').map((part) => fill(part, { total: orderTotal(voidTarget).primary, store: voidTarget.store_name }))
    : [];

  async function confirmVoid() {
    setVoiding(true);
    try {
      const updated = await apiClient.post(`/api/stores/${voidTarget.store_id}/orders/${voidTarget.id}/void`);
      // Show it voided right away, then refresh everything a void changes:
      // other cached sales lists, reports, and product stock (it's restocked).
      queryClient.setQueryData(ordersKey, (list) => list?.map((o) => (o.id === updated.id ? updated : o)));
      for (const queryKey of [['orders'], ['reports'], ['products']]) queryClient.invalidateQueries({ queryKey });
      setVoidTarget(null);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(status === 403 || status === 401 ? t.sales.voidOnlyAdmins : err?.body?.error || t.sales.voidFailed);
      setVoidTarget(null);
    } finally {
      setVoiding(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">{t.sales.title}</h1>
        <button onClick={() => setExportOpen(true)} className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 h-9 inline-flex items-center justify-center border border-transparent cursor-pointer" title={t.sales.export}>
          <Download size={14}/>
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4 bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.sales.branch}</label>
          <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm">
            <option value="">{t.sales.allBranches}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.sales.dateRange}</label>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => applyDatePreset(preset)}
                  className={`px-3 h-9 inline-flex items-center justify-center text-sm whitespace-nowrap border border-transparent cursor-pointer ${activeDatePreset === preset ? 'bg-[var(--accent)] text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                  {t.sales.presets[preset]}
                </button>
              ))}
            </div>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
            />
            <span className="text-slate-400 dark:text-slate-500">–</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
            />
          </div>
        </div>
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.common.search}</label>
          <SearchInput value={search.query} onChange={search.setQuery} placeholder={t.sales.searchPlaceholder} className="w-full" />
        </div>
        <FilterButton table={table} />
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 pb-1.5">
          <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
          {t.sales.showVoided}
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.sales.revenue}</p>
          <p className="text-xl font-semibold text-[var(--text-h)] mt-1">{revenue.primary}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{revenue.secondary}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.sales.sales}</p>
          <p className="text-xl font-semibold text-[var(--text-h)] mt-1">{counted.length}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.sales.averageSale}</p>
          <p className="text-xl font-semibold text-[var(--text-h)] mt-1">{average.primary}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{average.secondary}</p>
        </div>
      </div>

      {(error || ordersQuery.isError) && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.sales.loadFailed}</p>}

      <FilterChips table={table} />
      <DataTable
        table={table}
        rows={pageRows}
        rowKey={(o) => o.id}
        loading={loading}
        emptyText={t.sales.noSales}
        noMatchText={t.sales.noSales}
        rowClassName={(o) => `hover:bg-slate-50 dark:hover:bg-slate-800 ${isVoided(o) ? 'text-slate-400 dark:text-slate-500' : ''}`}
        onRowClick={(o) => setExpandedId(expandedId === o.id ? null : o.id)}
        isExpanded={(o) => expandedId === o.id}
        renderExpanded={(o) => <OrderDetail order={o} onVoid={() => setVoidTarget(o)} />}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-slate-600 dark:text-slate-300">
          <span>
            {fill(t.sales.range, { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, filtered.length), total: filtered.length })}
          </span>
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="px-3 py-1 border border-[var(--border)] rounded-lg disabled:opacity-40 cursor-pointer">{t.common.previous}</button>
            <span>{fill(t.common.page, { page, pages: totalPages })}</span>
            <button disabled={page === totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1 border border-[var(--border)] rounded-lg disabled:opacity-40 cursor-pointer">{t.common.next}</button>
          </div>
        </div>
      )}

      {voidTarget && (
        <Modal title={t.sales.voidTitle} onClose={() => !voiding && setVoidTarget(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {voidBody[0]}
            <span className="font-semibold">#{voidTarget.receipt_no}</span>
            {voidBody[1]}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setVoidTarget(null)} disabled={voiding} className="text-sm px-3 py-1.5 border border-transparent cursor-pointer">{t.common.cancel}</button>
            <button onClick={confirmVoid} disabled={voiding} className="text-sm font-medium bg-red-600 text-white rounded-lg px-3 py-1.5 border border-transparent disabled:opacity-60 cursor-pointer">
              {voiding ? t.sales.voiding : t.sales.voidSale}
            </button>
          </div>
        </Modal>
      )}

      {exportOpen && (
        <ExportModal stores={stores} defaultStoreId={storeFilter} onClose={() => setExportOpen(false)} />
      )}
    </div>
  );
}

// The line items, payment breakdown and actions shown under an expanded row.
function OrderDetail({ order: o, onVoid }) {
  const { t } = useLocale();
  const voided = isVoided(o);
  return (
    <>
      <table className="w-full text-xs mb-3">
        <thead className="text-slate-500 dark:text-slate-400 text-left">
          <tr>
            <th className="py-1 font-medium">{t.sales.product}</th>
            <th className="py-1 font-medium">{t.sales.barcode}</th>
            <th className="py-1 font-medium text-right">{t.sales.qty}</th>
            <th className="py-1 font-medium text-right">{t.sales.price}</th>
            <th className="py-1 font-medium text-right">{t.sales.lineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((i, idx) => {
            const fmt = i.currency === 'KHR' ? fmtKhr : fmtUsd;
            return (
              <tr key={idx} className="border-t border-[var(--border)]">
                <td className="py-1">{i.product_name}</td>
                <td className="py-1 text-slate-500 dark:text-slate-400">{i.barcode ?? ''}</td>
                <td className="py-1 text-right">{i.quantity}</td>
                <td className="py-1 text-right">{fmt(i.price)}</td>
                <td className="py-1 text-right">
                  {/* What the line charged, less its item discount. */}
                  {fmt(i.price * i.quantity - (i.discount || 0))}
                  {i.discount > 0 && <span className="block text-xs text-amber-600 dark:text-amber-400">−{fmt(i.discount)}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-4">
          {o.amount_paid_usd > 0 && <span>{fill(t.sales.paidUsd, { amount: fmtUsd(o.amount_paid_usd) })}</span>}
          {o.amount_paid_khr > 0 && <span>{fill(t.sales.paidKhr, { amount: fmtKhr(o.amount_paid_khr) })}</span>}
          {o.change_given_khr > 0 && <span>{fill(t.sales.changeAmount, { amount: fmtKhr(o.change_given_khr) })}</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => printReceipt(o)} className="text-xs font-medium border border-[var(--border)] rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 cursor-pointer" title={t.sales.printReceipt}>
            <Printer size={14}/>
          </button>
          {!voided && (
            <button onClick={onVoid} className="text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer" title={t.sales.voidSale}>
              <Ban size={14}/>
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function ExportModal({ stores, defaultStoreId, onClose }) {
  const { t } = useLocale();
  const [storeId, setStoreId] = useState(defaultStoreId);
  const [dateFrom, setDateFrom] = useState(() => toLocalDateStr(new Date()));
  const [dateTo, setDateTo] = useState(() => toLocalDateStr(new Date()));
  const [payment, setPayment] = useState('all');
  const [includeVoided, setIncludeVoided] = useState(false);
  const [columns, setColumns] = useState(() => new Set(DEFAULT_EXPORT_COLUMNS));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const preset = (key) => {
    const { from, to } = presetRange(key);
    setDateFrom(from);
    setDateTo(to);
  };

  async function runExport() {
    setExporting(true);
    setError('');
    try {
      const query = { limit: 5000 };
      if (storeId) query.storeId = storeId;
      const { from, to } = getDateRange(dateFrom, dateTo);
      if (from) query.date_from = from;
      if (to) query.date_to = to;
      const rows = (await apiClient.get('/api/orders', query))
        .filter((o) => includeVoided || !isVoided(o))
        .filter((o) => payment === 'all' || o.payment_method === payment);
      const active = EXPORT_COLUMNS.filter((c) => columns.has(c.key));
      const ws = XLSX.utils.json_to_sheet(rows.map((o) => Object.fromEntries(active.map((c) => [t.sales.exportColumns[c.key], c.val(o, t)]))));
      ws['!cols'] = active.map((c) => ({ wch: c.wch }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, t.sales.sheetName);
      const branch = storeId ? stores.find((s) => s.id === storeId)?.name ?? 'branch' : 'all-branches';
      XLSX.writeFile(wb, `sales-${branch.replace(/[^\w-]+/g, '-').toLowerCase()}-${dateFrom || 'all'}_${dateTo || 'all'}.xlsx`);
      onClose();
    } catch {
      setError(t.sales.exportFailed);
    } finally {
      setExporting(false);
    }
  }

  const toggleColumn = (key) =>
    setColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Modal title={t.sales.exportTitle} onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.sales.branch}</label>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm">
              <option value="">{t.sales.allBranches}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.common.from}</label>
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.common.to}</label>
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.sales.payment}</label>
            <select value={payment} onChange={(e) => setPayment(e.target.value)} className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm">
              <option value="all">{t.sales.allMethods}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{t.sales.methods[m]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {['today', 'yesterday', '7d', '30d', 'month', 'all'].map((key) => (
            <button key={key} onClick={() => preset(key)} className="text-xs border border-[var(--border)] rounded-lg px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
              {t.sales.exportPresets[key]}
            </button>
          ))}
        </div>
        <div>
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">{t.sales.columns}</p>
          <div className="grid grid-cols-3 gap-2">
            {EXPORT_COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={columns.has(c.key)} onChange={() => toggleColumn(c.key)} />
                {t.sales.exportColumns[c.key]}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={includeVoided} onChange={(e) => setIncludeVoided(e.target.checked)} />
          {t.sales.includeVoided}
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 border border-transparent cursor-pointer">{t.common.cancel}</button>
          <button
            onClick={runExport}
            disabled={exporting || columns.size === 0}
            className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 border border-transparent disabled:opacity-60 cursor-pointer"
          >
            {exporting ? t.sales.exporting : t.sales.exportToExcel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
