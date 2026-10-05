import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { ApiError } from '@mart-system/api-client';
import { useAuth } from '../auth/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { printReceipt } from '../lib/receipt';
import { fmtKhr, fmtUsd, inMainCurrency, mainCurrencyOf, orderTotal, orderTotalKhr, roundKhr } from '../lib/orderTotals';

// IMS counterpart of POS Order History (issue #6): the same filters, sorting,
// export and receipt reprint, for one branch or all of them. Rows come from
// GET /api/orders in the POS's snake_case shape (totals: lib/orderTotals.js).

const PAGE_SIZE = 20;
const PAYMENT_METHODS = ['CASH', 'KHQR', 'STATIC_QR', 'CARD'];
const PAYMENT_LABELS = { CASH: 'Cash', KHQR: 'KHQR', STATIC_QR: 'Static QR', CARD: 'Card' };
const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 days' },
  { key: 'month', label: '30 days' },
  { key: 'all', label: 'All' },
];

// Riel is shown to the nearest 100 (the smallest note), like the POS.
const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const itemCount = (o) => (o.items || []).reduce((sum, i) => sum + i.quantity, 0);
const isVoided = (o) => o.status === 'VOIDED';

function periodRange(period) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'today') return { from: start };
  if (period === 'week') return { from: new Date(start.getTime() - 7 * 86400_000) };
  if (period === 'month') return { from: new Date(start.getTime() - 30 * 86400_000) };
  return {};
}

const EXPORT_COLUMNS = [
  { key: 'receipt', header: 'Receipt #', wch: 12, val: (o) => o.receipt_no },
  { key: 'date', header: 'Date', wch: 12, val: (o) => new Date(o.created_at).toLocaleDateString('en-US') },
  { key: 'time', header: 'Time', wch: 10, val: (o) => new Date(o.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) },
  { key: 'branch', header: 'Branch', wch: 18, val: (o) => o.store_name },
  { key: 'register', header: 'Register', wch: 18, val: (o) => o.terminal_name },
  { key: 'items', header: 'Items', wch: 8, val: (o) => itemCount(o) },
  { key: 'totalUsd', header: 'Total (USD)', wch: 12, val: (o) => Number(Number(o.total_amount).toFixed(2)) },
  { key: 'totalKhr', header: 'Total (KHR)', wch: 14, val: (o) => orderTotalKhr(o) },
  { key: 'payment', header: 'Payment', wch: 10, val: (o) => PAYMENT_LABELS[o.payment_method] ?? o.payment_method },
  { key: 'bank', header: 'Bank', wch: 10, val: (o) => o.bank_name ?? '' },
  { key: 'paidUsd', header: 'Paid (USD)', wch: 12, val: (o) => o.amount_paid_usd },
  { key: 'paidKhr', header: 'Paid (KHR)', wch: 12, val: (o) => o.amount_paid_khr },
  { key: 'changeKhr', header: 'Change (KHR)', wch: 13, val: (o) => o.change_given_khr },
  { key: 'status', header: 'Status', wch: 11, val: (o) => o.status },
  { key: 'products', header: 'Products', wch: 40, val: (o) => (o.items || []).map((i) => `${i.product_name} x${i.quantity}`).join(', ') },
];
const DEFAULT_EXPORT_COLUMNS = ['receipt', 'date', 'time', 'branch', 'items', 'totalUsd', 'totalKhr', 'payment', 'status'];

export default function SalesHistoryPage() {
  const { storeId: currentStoreId } = useOutletContext();
  const { stores } = useAuth();

  const [storeFilter, setStoreFilter] = useState(currentStoreId ?? '');
  const [period, setPeriod] = useState('today');
  const [payFilter, setPayFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showVoided, setShowVoided] = useState(false);
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState(null);

  const [error, setError] = useState('');
  const [voidTarget, setVoidTarget] = useState(null);
  const [voiding, setVoiding] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const allBranches = storeFilter === '';

  // Cached per branch + period (lib/queryClient.js): re-opening the tab or
  // flipping back to a filter already viewed is instant, refreshed in the
  // background when stale. The period's start is worked out at fetch time,
  // so "Today" is always today's.
  const queryClient = useQueryClient();
  const ordersKey = queryKeys.orders({ storeId: storeFilter, period });
  const ordersQuery = useQuery({
    queryKey: ordersKey,
    queryFn: () => {
      const { from } = periodRange(period);
      const query = {};
      if (storeFilter) query.storeId = storeFilter;
      if (from) query.date_from = from.toISOString();
      return apiClient.get('/api/orders', query);
    },
    placeholderData: (previous) => previous, // keep the last rows on screen while a new filter loads
  });
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const loading = ordersQuery.isPending;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [storeFilter, period, payFilter, search, showVoided, sort]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const dir = sort.dir === 'asc' ? 1 : -1;
    const byDate = (a, b) => new Date(a.created_at) - new Date(b.created_at);
    return orders
      .filter((o) => showVoided || !isVoided(o))
      .filter((o) => payFilter === 'all' || o.payment_method === payFilter)
      .filter(
        (o) =>
          !q ||
          o.receipt_no.toLowerCase().includes(q) ||
          (o.terminal_name ?? '').toLowerCase().includes(q) ||
          (o.store_name ?? '').toLowerCase().includes(q) ||
          (o.items || []).some((i) => i.product_name?.toLowerCase().includes(q) || i.barcode?.includes(q))
      )
      .sort((a, b) => {
        switch (sort.col) {
          case 'receipt': return dir * a.receipt_no.localeCompare(b.receipt_no);
          case 'branch': return dir * (a.store_name ?? '').localeCompare(b.store_name ?? '') || -byDate(a, b);
          case 'register': return dir * (a.terminal_name ?? '').localeCompare(b.terminal_name ?? '') || -byDate(a, b);
          case 'items': return dir * (itemCount(a) - itemCount(b));
          case 'total': return dir * (a.total_amount - b.total_amount);
          case 'payment': return dir * a.payment_method.localeCompare(b.payment_method);
          default: return dir * byDate(a, b);
        }
      });
  }, [orders, showVoided, payFilter, search, sort]);

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

  const toggleSort = (col) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'date' ? 'desc' : 'asc' }));

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
      setError(status === 403 || status === 401 ? 'Only store admins can void sales.' : err?.body?.error || 'Failed to void the sale.');
      setVoidTarget(null);
    } finally {
      setVoiding(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">Sales history</h1>
        <button onClick={() => setExportOpen(true)} className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5">
          Export
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4 bg-white border border-[var(--border)] rounded-xl p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Branch</label>
          <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm">
            <option value="">All branches</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Period</label>
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-sm ${period === p.key ? 'bg-[var(--accent)] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Payment</label>
          <select value={payFilter} onChange={(e) => setPayFilter(e.target.value)} className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm">
            <option value="all">All methods</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-slate-600 mb-1">Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Receipt #, product, barcode, register…"
            className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 pb-1.5">
          <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
          Show voided
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-[var(--border)] rounded-xl p-4">
          <p className="text-xs text-slate-500">Revenue</p>
          <p className="text-xl font-semibold text-[var(--text-h)] mt-1">{revenue.primary}</p>
          <p className="text-xs text-slate-500">{revenue.secondary}</p>
        </div>
        <div className="bg-white border border-[var(--border)] rounded-xl p-4">
          <p className="text-xs text-slate-500">Sales</p>
          <p className="text-xl font-semibold text-[var(--text-h)] mt-1">{counted.length}</p>
        </div>
        <div className="bg-white border border-[var(--border)] rounded-xl p-4">
          <p className="text-xs text-slate-500">Average sale</p>
          <p className="text-xl font-semibold text-[var(--text-h)] mt-1">{average.primary}</p>
          <p className="text-xs text-slate-500">{average.secondary}</p>
        </div>
      </div>

      {(error || ordersQuery.isError) && <p className="text-sm text-red-600 mb-3">{error || 'Failed to load sales.'}</p>}

      <div className="bg-white border border-[var(--border)] rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <SortTh sort={sort} onSort={toggleSort} col="receipt">Receipt #</SortTh>
              <SortTh sort={sort} onSort={toggleSort} col="date">Date</SortTh>
              {allBranches && <SortTh sort={sort} onSort={toggleSort} col="branch">Branch</SortTh>}
              <SortTh sort={sort} onSort={toggleSort} col="register">Register</SortTh>
              <SortTh sort={sort} onSort={toggleSort} col="items" className="text-center">Items</SortTh>
              <SortTh sort={sort} onSort={toggleSort} col="total" className="text-right">Total</SortTh>
              <SortTh sort={sort} onSort={toggleSort} col="payment">Payment</SortTh>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-4 text-slate-400" colSpan={7}>Loading…</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td className="px-3 py-4 text-slate-400" colSpan={7}>No sales found.</td></tr>
            ) : (
              pageRows.map((o) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  showBranch={allBranches}
                  expanded={expandedId === o.id}
                  onToggle={() => setExpandedId(expandedId === o.id ? null : o.id)}
                  onVoid={() => setVoidTarget(o)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-slate-600">
          <span>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="px-3 py-1 border border-[var(--border)] rounded-lg disabled:opacity-40">Prev</button>
            <span>Page {page} / {totalPages}</span>
            <button disabled={page === totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1 border border-[var(--border)] rounded-lg disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {voidTarget && (
        <Modal title="Void this sale?" onClose={() => !voiding && setVoidTarget(null)}>
          <p className="text-sm text-slate-600">
            Receipt <span className="font-semibold">#{voidTarget.receipt_no}</span> ({orderTotal(voidTarget).primary}, {voidTarget.store_name}) will be
            marked voided and its items put back in stock. It no longer counts toward revenue.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setVoidTarget(null)} disabled={voiding} className="text-sm px-3 py-1.5">Cancel</button>
            <button onClick={confirmVoid} disabled={voiding} className="text-sm font-medium bg-red-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-60">
              {voiding ? 'Voiding…' : 'Void sale'}
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

function SortTh({ col, sort, onSort, children, className = '' }) {
  return (
    <th className={`px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap ${className}`} onClick={() => onSort(col)}>
      {children}
      <span className="text-[var(--accent)]">{sort.col === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
    </th>
  );
}

function OrderRow({ order: o, showBranch, expanded, onToggle, onVoid }) {
  const voided = isVoided(o);
  return (
    <>
      <tr onClick={onToggle} className={`border-t border-[var(--border)] cursor-pointer hover:bg-slate-50 ${voided ? 'text-slate-400' : ''}`}>
        <td className="px-3 py-2 font-medium whitespace-nowrap">
          #{o.receipt_no}
          {voided && <span className="ml-2 text-[10px] font-semibold uppercase bg-red-50 text-red-600 rounded px-1.5 py-0.5">Voided</span>}
        </td>
        <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(o.created_at)}</td>
        {showBranch && <td className="px-3 py-2">{o.store_name}</td>}
        <td className="px-3 py-2">{o.terminal_name}</td>
        <td className="px-3 py-2 text-center">{itemCount(o)}</td>
        <td className={`px-3 py-2 text-right whitespace-nowrap ${voided ? 'line-through' : ''}`}>
          <span className="font-medium">{orderTotal(o).primary}</span>
          <span className="block text-xs text-slate-500">{orderTotal(o).secondary}</span>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          {PAYMENT_LABELS[o.payment_method] ?? o.payment_method}
          {o.bank_name && <span className="text-xs text-slate-500"> · {o.bank_name}</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50/60">
          <td colSpan={7} className="px-4 py-3">
            <table className="w-full text-xs mb-3">
              <thead className="text-slate-500 text-left">
                <tr>
                  <th className="py-1 font-medium">Product</th>
                  <th className="py-1 font-medium">Barcode</th>
                  <th className="py-1 font-medium text-right">Qty</th>
                  <th className="py-1 font-medium text-right">Price</th>
                  <th className="py-1 font-medium text-right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i, idx) => {
                  const fmt = i.currency === 'KHR' ? fmtKhr : fmtUsd;
                  return (
                    <tr key={idx} className="border-t border-[var(--border)]">
                      <td className="py-1">{i.product_name}</td>
                      <td className="py-1 text-slate-500">{i.barcode ?? ''}</td>
                      <td className="py-1 text-right">{i.quantity}</td>
                      <td className="py-1 text-right">{fmt(i.price)}</td>
                      <td className="py-1 text-right">
                        {/* What the line charged, less its item discount. */}
                        {fmt(i.price * i.quantity - (i.discount || 0))}
                        {i.discount > 0 && <span className="block text-xs text-amber-600">−{fmt(i.discount)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-600 flex flex-wrap gap-x-4">
                {o.amount_paid_usd > 0 && <span>Paid USD: {fmtUsd(o.amount_paid_usd)}</span>}
                {o.amount_paid_khr > 0 && <span>Paid KHR: {fmtKhr(o.amount_paid_khr)}</span>}
                {o.change_given_khr > 0 && <span>Change: {fmtKhr(o.change_given_khr)}</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => printReceipt(o)} className="text-xs font-medium border border-[var(--border)] rounded-lg px-3 py-1.5 bg-white">
                  Print receipt
                </button>
                {!voided && (
                  <button onClick={onVoid} className="text-xs font-medium text-red-600 border border-red-200 rounded-lg px-3 py-1.5 bg-white hover:bg-red-50">
                    Void sale
                  </button>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ExportModal({ stores, defaultStoreId, onClose }) {
  const today = new Date();
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [storeId, setStoreId] = useState(defaultStoreId);
  const [dateFrom, setDateFrom] = useState(isoDay(today));
  const [dateTo, setDateTo] = useState(isoDay(today));
  const [payment, setPayment] = useState('all');
  const [includeVoided, setIncludeVoided] = useState(false);
  const [columns, setColumns] = useState(() => new Set(DEFAULT_EXPORT_COLUMNS));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const preset = (key) => {
    const end = isoDay(today);
    const daysAgo = (n) => isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
    if (key === 'today') { setDateFrom(end); setDateTo(end); }
    if (key === '7d') { setDateFrom(daysAgo(7)); setDateTo(end); }
    if (key === '30d') { setDateFrom(daysAgo(30)); setDateTo(end); }
    if (key === 'month') { setDateFrom(isoDay(new Date(today.getFullYear(), today.getMonth(), 1))); setDateTo(end); }
    if (key === 'all') { setDateFrom(''); setDateTo(''); }
  };

  async function runExport() {
    setExporting(true);
    setError('');
    try {
      const query = { limit: 5000 };
      if (storeId) query.storeId = storeId;
      // Local calendar days -> instants: from the start of dateFrom to the start of the day after dateTo.
      if (dateFrom) query.date_from = new Date(`${dateFrom}T00:00:00`).toISOString();
      if (dateTo) {
        const end = new Date(`${dateTo}T00:00:00`);
        end.setDate(end.getDate() + 1);
        query.date_to = end.toISOString();
      }
      const rows = (await apiClient.get('/api/orders', query))
        .filter((o) => includeVoided || !isVoided(o))
        .filter((o) => payment === 'all' || o.payment_method === payment);
      const active = EXPORT_COLUMNS.filter((c) => columns.has(c.key));
      const ws = XLSX.utils.json_to_sheet(rows.map((o) => Object.fromEntries(active.map((c) => [c.header, c.val(o)]))));
      ws['!cols'] = active.map((c) => ({ wch: c.wch }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sales');
      const branch = storeId ? stores.find((s) => s.id === storeId)?.name ?? 'branch' : 'all-branches';
      XLSX.writeFile(wb, `sales-${branch.replace(/[^\w-]+/g, '-').toLowerCase()}-${dateFrom || 'all'}_${dateTo || 'all'}.xlsx`);
      onClose();
    } catch {
      setError('Export failed.');
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
    <Modal title="Export sales" onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Branch</label>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm">
              <option value="">All branches</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Payment</label>
            <select value={payment} onChange={(e) => setPayment(e.target.value)} className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm">
              <option value="all">All methods</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['all', 'All time']].map(([key, label]) => (
            <button key={key} onClick={() => preset(key)} className="text-xs border border-[var(--border)] rounded-lg px-2.5 py-1 hover:bg-slate-50">
              {label}
            </button>
          ))}
        </div>
        <div>
          <p className="text-xs font-medium text-slate-600 mb-2">Columns</p>
          <div className="grid grid-cols-3 gap-2">
            {EXPORT_COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={columns.has(c.key)} onChange={() => toggleColumn(c.key)} />
                {c.header}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={includeVoided} onChange={(e) => setIncludeVoided(e.target.checked)} />
          Include voided sales
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5">Cancel</button>
          <button
            onClick={runExport}
            disabled={exporting || columns.size === 0}
            className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 disabled:opacity-60"
          >
            {exporting ? 'Exporting…' : 'Export to Excel'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
