import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useAuth } from '../auth/AuthContext.jsx';
import { useDataTable } from '../hooks/useDataTable';
import Modal from '../components/Modal.jsx';
import DataTable from '../components/DataTable.jsx';
import FilterButton from '../components/FilterButton.jsx';
import FilterChips from '../components/FilterChips.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt, plural } from '../i18n/translate';
import { CircleCheck, CircleX, Plus, X } from 'lucide-react';

const EMPTY_CREATE_FORM = { fromStoreId: '', toStoreId: '', items: [] };

const STATUSES = ['REQUESTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'];

const itemsSummary = (t) => t.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ');

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

  // Cached (lib/queryClient.js): re-opening the tab shows the last list at
  // once and refreshes it in the background when stale.
  const queryClient = useQueryClient();
  const transfersQuery = useQuery({ queryKey: queryKeys.transfers(), queryFn: () => apiClient.get('/api/stock-transfers') });
  const transfers = useMemo(() => transfersQuery.data ?? [], [transfersQuery.data]);
  const loading = transfersQuery.isPending;
  const table = useDataTable({
    rows: transfers,
    // Ties fall back to from-store, so the order is stable and predictable.
    initialSort: { col: 'from', dir: 'asc' },
    columns: [
      { key: 'from', label: t.common.from, render: (r) => r.fromStoreName, sortValue: (r) => r.fromStoreName, filter: { type: 'text', placeholder: t.transfers.filterStore } },
      { key: 'to', label: t.common.to, render: (r) => r.toStoreName, sortValue: (r) => r.toStoreName, filter: { type: 'text', placeholder: t.transfers.filterStore } },
      {
        key: 'items', label: t.transfers.items, cellClassName: 'text-slate-500 dark:text-slate-400 text-xs', render: itemsSummary,
        sortValue: (r) => r.items.length, filter: { type: 'text', placeholder: t.transfers.contains, value: itemsSummary },
      },
      {
        key: 'status', label: t.common.status, sortValue: (r) => r.status,
        render: (r) => (
          <span
            className={
              r.status === 'COMPLETED'
                ? 'text-emerald-600 dark:text-emerald-400'
                : r.status === 'CANCELLED'
                  ? 'text-slate-400 dark:text-slate-500'
                  : 'text-amber-600 dark:text-amber-400'
            }
          >
            {t.transfers.status[r.status] ?? r.status}
          </span>
        ),
        filter: { type: 'select', options: STATUSES.map((s) => ({ value: s, label: t.transfers.status[s] })) },
      },
      {
        key: 'actions', label: '', cellClassName: 'text-right space-x-3',
        render: (r) =>
          r.status === 'REQUESTED' && (
            <>
              <button onClick={() => handleComplete(r)} className="text-[var(--accent)] font-medium cursor-pointer" title={t.transfers.complete}>
                <CircleCheck size={15}/>
              </button>
              <button onClick={() => handleCancel(r)} className="text-red-600 dark:text-red-400 font-medium cursor-pointer" title={t.common.cancel}>
                <CircleX size={15}/>
              </button>
            </>
          ),
      },
    ],
  });
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
          <FilterButton table={table} />
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {table.visible.length === transfers.length
              ? fmt(t.transfers.count, { count: transfers.length, transfers: plural(transfers.length, t.transfers.transfer, t.transfers.transfersWord) })
              : fmt(t.transfers.countFiltered, { visible: table.visible.length, total: transfers.length, transfers: plural(transfers.length, t.transfers.transfer, t.transfers.transfersWord) })}
          </span>
          {table.filterCount > 0 && (
            <button onClick={table.clearFilters} className="text-sm text-[var(--accent)] font-medium cursor-pointer">
              {fmt(t.transfers.clearFilters, { count: table.filterCount })}
            </button>
          )}
          <button
            onClick={openCreate}
            className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer"
            title={t.transfers.newTransfer}
          >
            <Plus size={14}/>
          </button>
        </div>
      </div>

      {(error || transfersQuery.isError) && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.transfers.loadFailed}</p>}

      <FilterChips table={table} />
      <DataTable
        table={table}
        rowKey={(r) => r.id}
        loading={loading}
        emptyText={t.transfers.noTransfers}
        noMatchText={t.transfers.noMatches}
      />

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
                    <button type="button" onClick={() => removeLineItem(item.productId)} className="text-red-600 dark:text-red-400 text-xs cursor-pointer" title={t.common.remove}>
                      <X size={14}/>
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
