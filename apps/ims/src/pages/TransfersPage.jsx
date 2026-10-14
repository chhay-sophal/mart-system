import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useAuth } from '../auth/AuthContext.jsx';
import { useColumnFilter } from '../hooks/useColumnFilter';
import Modal from '../components/Modal.jsx';
import FilterableHeader, { filterInput } from '../components/FilterableHeader.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt, plural } from '../i18n/translate';

const EMPTY_CREATE_FORM = { fromStoreId: '', toStoreId: '', items: [] };

const STATUS_FILTERS = ['all', 'REQUESTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'];

const itemsSummary = (t) => t.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ');

const EMPTY_FILTERS = {
  from: '',
  to: '',
  items: '',
  status: 'all', // all | REQUESTED | IN_TRANSIT | COMPLETED | CANCELLED
};

const norm = (value) => String(value ?? '').trim().toLowerCase();

function filterTransfers(transfers, f) {
  const from = norm(f.from);
  const to = norm(f.to);
  const items = norm(f.items);
  return transfers.filter((t) => {
    if (from && !norm(t.fromStoreName).includes(from)) return false;
    if (to && !norm(t.toStoreName).includes(to)) return false;
    if (items && !norm(itemsSummary(t)).includes(items)) return false;
    if (f.status !== 'all' && t.status !== f.status) return false;
    return true;
  });
}

const COMPARE = {
  from: (a, b) => a.fromStoreName.localeCompare(b.fromStoreName),
  to: (a, b) => a.toStoreName.localeCompare(b.toStoreName),
  items: (a, b) => a.items.length - b.items.length,
  status: (a, b) => a.status.localeCompare(b.status),
};

function sortTransfers(transfers, { col, dir }) {
  const compare = COMPARE[col];
  if (!compare) return transfers;
  const sign = dir === 'desc' ? -1 : 1;
  // Ties fall back to from-store, so the order is stable and predictable.
  return [...transfers].sort((a, b) => sign * compare(a, b) || COMPARE.from(a, b));
}

const activeFilterCount = (f) => Object.entries(EMPTY_FILTERS).filter(([key, empty]) => f[key] !== empty).length;

export default function TransfersPage() {
  // Not scoped to the AppShell's single current store — a transfer inherently
  // spans two, so this uses the full store list from AuthContext directly.
  const { stores } = useAuth();
  const { t } = useLocale();
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [fromStoreProducts, setFromStoreProducts] = useState([]);
  const [pendingProductId, setPendingProductId] = useState('');
  const [pendingQuantity, setPendingQuantity] = useState('1');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ col: 'from', dir: 'asc' });
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const { openFilterCol, toggleFilterCol, filterPanelRef } = useColumnFilter();
  const toggleSort = (col) =>
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  const filterCount = activeFilterCount(filters);

  // Cached (lib/queryClient.js): re-opening the tab shows the last list at
  // once and refreshes it in the background when stale.
  const queryClient = useQueryClient();
  const transfersQuery = useQuery({ queryKey: queryKeys.transfers(), queryFn: () => apiClient.get('/api/stock-transfers') });
  const transfers = useMemo(() => transfersQuery.data ?? [], [transfersQuery.data]);
  const loading = transfersQuery.isPending;
  const visible = useMemo(() => sortTransfers(filterTransfers(transfers, filters), sort), [transfers, filters, sort]);
  // After a save: shipping/receiving moves stock between stores, so product
  // lists and reports are out of date too.
  const load = () =>
    Promise.all(
      [queryKeys.transfers(), ['products'], ['reports']].map((queryKey) => queryClient.invalidateQueries({ queryKey }))
    );

  function openCreate() {
    setCreateForm(EMPTY_CREATE_FORM);
    setFromStoreProducts([]);
    setPendingProductId('');
    setPendingQuantity('1');
    setShowCreate(true);
  }

  async function handleFromStoreChange(fromStoreId) {
    setCreateForm({ ...createForm, fromStoreId, items: [] });
    setPendingProductId('');
    if (!fromStoreId) {
      setFromStoreProducts([]);
      return;
    }
    try {
      // Shares the Products page's cache for that store.
      setFromStoreProducts(
        await queryClient.fetchQuery({
          queryKey: queryKeys.products(fromStoreId),
          queryFn: () => apiClient.get(`/api/stores/${fromStoreId}/products`),
        })
      );
    } catch {
      setFromStoreProducts([]);
    }
  }

  function addLineItem() {
    if (!pendingProductId || Number(pendingQuantity) <= 0) return;
    const product = fromStoreProducts.find((p) => p.id === pendingProductId);
    if (!product || createForm.items.some((i) => i.productId === pendingProductId)) return;
    setCreateForm({
      ...createForm,
      items: [...createForm.items, { productId: product.id, name: product.name, quantity: Number(pendingQuantity) }],
    });
    setPendingProductId('');
    setPendingQuantity('1');
  }

  function removeLineItem(productId) {
    setCreateForm({ ...createForm, items: createForm.items.filter((i) => i.productId !== productId) });
  }

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await apiClient.post('/api/stock-transfers', {
        fromStoreId: createForm.fromStoreId,
        toStoreId: createForm.toStoreId,
        items: createForm.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      });
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err?.body?.error ?? t.transfers.createFailed);
    }
  }

  async function handleComplete(transfer) {
    try {
      await apiClient.post(`/api/stock-transfers/${transfer.id}/complete`);
      await load();
    } catch (err) {
      setError(err?.body?.error ?? t.transfers.completeFailed);
    }
  }

  async function handleCancel(transfer) {
    try {
      await apiClient.post(`/api/stock-transfers/${transfer.id}/cancel`);
      await load();
    } catch (err) {
      setError(err?.body?.error ?? t.transfers.cancelFailed);
    }
  }

  const canSubmitCreate =
    createForm.fromStoreId && createForm.toStoreId && createForm.fromStoreId !== createForm.toStoreId && createForm.items.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">{t.transfers.title}</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {visible.length === transfers.length
              ? fmt(t.transfers.count, { count: transfers.length, transfers: plural(transfers.length, t.transfers.transfer, t.transfers.transfersWord) })
              : fmt(t.transfers.countFiltered, { visible: visible.length, total: transfers.length, transfers: plural(transfers.length, t.transfers.transfer, t.transfers.transfersWord) })}
          </span>
          {filterCount > 0 && (
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-sm text-[var(--accent)] font-medium cursor-pointer">
              {fmt(t.transfers.clearFilters, { count: filterCount })}
            </button>
          )}
          <button
            onClick={openCreate}
            className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer"
          >
            {t.transfers.newTransfer}
          </button>
        </div>
      </div>

      {(error || transfersQuery.isError) && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.transfers.loadFailed}</p>}

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
            <tr>
              <FilterableHeader
                col="from" label={t.common.from} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'from'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.from !== EMPTY_FILTERS.from}
              >
                <input
                  value={filters.from}
                  onChange={(e) => setFilter('from', e.target.value)}
                  placeholder={t.transfers.filterStore}
                  className={filterInput}
                  autoFocus
                />
              </FilterableHeader>
              <FilterableHeader
                col="to" label={t.common.to} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'to'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.to !== EMPTY_FILTERS.to}
              >
                <input
                  value={filters.to}
                  onChange={(e) => setFilter('to', e.target.value)}
                  placeholder={t.transfers.filterStore}
                  className={filterInput}
                />
              </FilterableHeader>
              <FilterableHeader
                col="items" label={t.transfers.items} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'items'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.items !== EMPTY_FILTERS.items}
              >
                <input
                  value={filters.items}
                  onChange={(e) => setFilter('items', e.target.value)}
                  placeholder={t.transfers.contains}
                  className={filterInput}
                />
              </FilterableHeader>
              <FilterableHeader
                col="status" label={t.common.status} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'status'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.status !== EMPTY_FILTERS.status}
              >
                <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={filterInput}>
                  {STATUS_FILTERS.map((value) => (
                    <option key={value} value={value}>{value === 'all' ? t.common.all : t.transfers.status[value]}</option>
                  ))}
                </select>
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
                  {transfers.length === 0 ? t.transfers.noTransfers : t.transfers.noMatches}
                </td>
              </tr>
            ) : (
              visible.map((tr) => (
                <tr key={tr.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2">{tr.fromStoreName}</td>
                  <td className="px-4 py-2">{tr.toStoreName}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400 text-xs">
                    {itemsSummary(tr)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        tr.status === 'COMPLETED'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : tr.status === 'CANCELLED'
                            ? 'text-slate-400 dark:text-slate-500'
                            : 'text-amber-600 dark:text-amber-400'
                      }
                    >
                      {t.transfers.status[tr.status] ?? tr.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right space-x-3">
                    {tr.status === 'REQUESTED' && (
                      <>
                        <button onClick={() => handleComplete(tr)} className="text-[var(--accent)] font-medium cursor-pointer">
                          {t.transfers.complete}
                        </button>
                        <button onClick={() => handleCancel(tr)} className="text-red-600 dark:text-red-400 font-medium cursor-pointer">
                          {t.common.cancel}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title={t.transfers.modalTitle} onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.transfers.fromStore}</label>
                <select
                  required
                  value={createForm.fromStoreId}
                  onChange={(e) => handleFromStoreChange(e.target.value)}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="">{t.common.select}</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.transfers.toStore}</label>
                <select
                  required
                  value={createForm.toStoreId}
                  onChange={(e) => setCreateForm({ ...createForm, toStoreId: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="">{t.common.select}</option>
                  {stores
                    .filter((s) => s.id !== createForm.fromStoreId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {createForm.fromStoreId && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.transfers.addItem}</label>
                <div className="flex gap-2">
                  <select
                    value={pendingProductId}
                    onChange={(e) => setPendingProductId(e.target.value)}
                    className="flex-1 border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                  >
                    <option value="">{t.transfers.selectProduct}</option>
                    {fromStoreProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {fmt(t.transfers.productOption, { name: p.name, stock: p.stock })}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={pendingQuantity}
                    onChange={(e) => setPendingQuantity(e.target.value)}
                    className="w-20 border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                  />
                  <button type="button" onClick={addLineItem} className="text-sm px-3 h-9 inline-flex items-center justify-center border border-[var(--border)] rounded-lg cursor-pointer">
                    {t.common.add}
                  </button>
                </div>
              </div>
            )}

            {createForm.items.length > 0 && (
              <ul className="text-sm space-y-1">
                {createForm.items.map((item) => (
                  <li key={item.productId} className="flex items-center justify-between">
                    <span>
                      {fmt(t.transfers.lineItem, { quantity: item.quantity, name: item.name })}
                    </span>
                    <button type="button" onClick={() => removeLineItem(item.productId)} className="text-red-600 dark:text-red-400 text-xs cursor-pointer">
                      {t.common.remove}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="text-sm px-3 py-1.5 cursor-pointer">
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={!canSubmitCreate}
                className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 disabled:opacity-50 cursor-pointer"
              >
                {t.transfers.requestTransfer}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
