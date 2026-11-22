import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { ApiError } from '@mart-system/api-client';
import { useAuth } from '../auth/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt as fill, plural } from '../i18n/translate';
import Modal from '../components/Modal.jsx';
import DateRangeFilter from '../components/DateRangeFilter.jsx';
import StoreSelect from '../components/StoreSelect.jsx';
import { useDataTable } from '../hooks/useDataTable';
import DataTable from '../components/DataTable.jsx';
import FilterButton from '../components/FilterButton.jsx';
import FilterChips from '../components/FilterChips.jsx';
import Pagination from '../components/Pagination.jsx';
import SearchInput from '../components/SearchInput.jsx';
import { useSearch } from '../hooks/useSearch';
import { usePagination } from '../hooks/usePagination';
import { useDateRangeState, useStoreFilterState } from '../hooks/useFilterState';
import { usePersistentState } from '../hooks/usePersistentState';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { printReceipt } from '../lib/receipt';
import { DATE_PRESETS, toApiRange, todayStr } from '../lib/dateRange';
import { fmtKhr, fmtUsd, inMainCurrency, mainCurrencyOf, orderTotal, orderTotalKhr, roundKhr } from '../lib/orderTotals';
import { Download, Printer } from 'lucide-react';

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

  // Store, range, search, filters, sort and page are all remembered while
  // you visit other pages (hooks/useFilterState.js, usePersistentState.js). The store defaults to the header's; the
  // range is free-form (presets are shortcuts), defaulting to today.
  const [storeFilter, setStoreFilter] = useStoreFilterState('sales:store', currentStoreId ?? '');
  const [dateFrom, dateTo, setDateRange] = useDateRangeState('sales:range', DATE_PRESETS);
  const [showVoided, setShowVoided] = usePersistentState('sales:showVoided', false);
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
      const query = toApiRange(dateFrom, dateTo);
      if (storeFilter) query.storeId = storeFilter;
      return apiClient.get('/api/orders', query);
    },
    placeholderData: (previous) => previous, // keep the last rows on screen while a new filter loads
  });
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const loading = ordersQuery.isPending;

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
  ], { persistKey: 'sales:search' });

  const nowrap = 'whitespace-nowrap';
  const table = useDataTable({
    rows: search.results,
    initialSort: { col: 'date', dir: 'desc' },
    persistKey: 'sales:orders',
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
        ? [{ key: 'branch', label: t.common.store, sortValue: (o) => o.store_name, render: (o) => o.store_name, filter: { type: 'text', placeholder: t.sales.contains } }]
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

  const pager = usePagination(
    filtered,
    PAGE_SIZE,
    JSON.stringify([storeFilter, dateFrom, dateTo, search.query, showVoided, table.sort, table.filters]),
    'sales:page'
  );

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
        <button onClick={() => setExportOpen(true)} className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 h-9 inline-flex items-center justify-center border border-transparent cursor-pointer gap-1.5">
          <Download size={16} aria-hidden="true" />
          {t.sales.export}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4 bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-4">
        <StoreSelect value={storeFilter} onChange={setStoreFilter} />
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={setDateRange}
          presets={DATE_PRESETS}
        />
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

      {/* A one-line summary, not stat cards: this page is the sales log, and
          the Reports page owns the headline figures. What this adds is that
          it follows the search and filters. */}
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
        {fill(t.sales.summary, {
          count: counted.length,
          sales: plural(counted.length, t.sales.saleOne, t.sales.saleMany),
          revenue: revenue.primary,
          average: average.primary,
        })}
        {(search.isActive || table.filterCount > 0) && ` (${t.sales.summaryFiltered})`}
      </p>

      {(error || ordersQuery.isError) && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.sales.loadFailed}</p>}

      <FilterChips table={table} />
      <DataTable
        table={table}
        rows={pager.pageRows}
        rowKey={(o) => o.id}
        loading={loading}
        emptyText={t.sales.noSales}
        noMatchText={t.sales.noSales}
        rowClassName={(o) => `hover:bg-slate-50 dark:hover:bg-slate-800 ${isVoided(o) ? 'text-slate-400 dark:text-slate-500' : ''}`}
        onRowClick={(o) => setExpandedId(expandedId === o.id ? null : o.id)}
        isExpanded={(o) => expandedId === o.id}
        renderExpanded={(o) => <OrderDetail order={o} onVoid={() => setVoidTarget(o)} />}
      />

      <Pagination pager={pager} />

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
          <button onClick={() => printReceipt(o)} className="text-xs font-medium border border-[var(--border)] rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 cursor-pointer inline-flex items-center gap-1.5">
            <Printer size={14} aria-hidden="true" />
            {t.sales.printReceipt}
          </button>
          {!voided && (
            <button onClick={onVoid} className="text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
              {t.sales.voidSale}
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
  const [dateFrom, setDateFrom] = useState(todayStr);
  const [dateTo, setDateTo] = useState(todayStr);
  const [payment, setPayment] = useState('all');
  const [includeVoided, setIncludeVoided] = useState(false);
  const [columns, setColumns] = useState(() => new Set(DEFAULT_EXPORT_COLUMNS));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  async function runExport() {
    setExporting(true);
    setError('');
    try {
      const query = { limit: 5000, ...toApiRange(dateFrom, dateTo) };
      if (storeId) query.storeId = storeId;
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
          <StoreSelect value={storeId} onChange={setStoreId} />
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
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
          presets={DATE_PRESETS}
        />
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
