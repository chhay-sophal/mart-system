import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../lib/apiClient';
import { useAuth } from '../auth/AuthContext.jsx';
import Modal from '../components/Modal.jsx';

const EMPTY_CREATE_FORM = { fromStoreId: '', toStoreId: '', items: [] };

export default function TransfersPage() {
  // Not scoped to the AppShell's single current store — a transfer inherently
  // spans two, so this uses the full store list from AuthContext directly.
  const { stores } = useAuth();
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [fromStoreProducts, setFromStoreProducts] = useState([]);
  const [pendingProductId, setPendingProductId] = useState('');
  const [pendingQuantity, setPendingQuantity] = useState('1');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTransfers(await apiClient.get('/api/stock-transfers'));
    } catch {
      setError('Failed to load transfers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      setFromStoreProducts(await apiClient.get(`/api/stores/${fromStoreId}/products`));
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
      setError(err?.body?.error ?? 'Failed to create transfer.');
    }
  }

  async function handleComplete(transfer) {
    try {
      await apiClient.post(`/api/stock-transfers/${transfer.id}/complete`);
      await load();
    } catch (err) {
      setError(err?.body?.error ?? 'Failed to complete transfer — you may need a role at the receiving store.');
    }
  }

  async function handleCancel(transfer) {
    try {
      await apiClient.post(`/api/stock-transfers/${transfer.id}/cancel`);
      await load();
    } catch (err) {
      setError(err?.body?.error ?? 'Failed to cancel transfer.');
    }
  }

  const canSubmitCreate =
    createForm.fromStoreId && createForm.toStoreId && createForm.fromStoreId !== createForm.toStoreId && createForm.items.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">Stock transfers</h1>
        <button
          onClick={openCreate}
          className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5"
        >
          New transfer
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">From</th>
              <th className="px-4 py-2">To</th>
              <th className="px-4 py-2">Items</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-slate-400" colSpan={5}>
                  Loading…
                </td>
              </tr>
            ) : transfers.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-400" colSpan={5}>
                  No transfers yet.
                </td>
              </tr>
            ) : (
              transfers.map((t) => (
                <tr key={t.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2">{t.fromStoreName}</td>
                  <td className="px-4 py-2">{t.toStoreName}</td>
                  <td className="px-4 py-2 text-slate-500 text-xs">
                    {t.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ')}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        t.status === 'COMPLETED'
                          ? 'text-emerald-600'
                          : t.status === 'CANCELLED'
                            ? 'text-slate-400'
                            : 'text-amber-600'
                      }
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right space-x-3">
                    {t.status === 'REQUESTED' && (
                      <>
                        <button onClick={() => handleComplete(t)} className="text-[var(--accent)] font-medium">
                          Complete
                        </button>
                        <button onClick={() => handleCancel(t)} className="text-red-600 font-medium">
                          Cancel
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
        <Modal title="New stock transfer" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">From store</label>
                <select
                  required
                  value={createForm.fromStoreId}
                  onChange={(e) => handleFromStoreChange(e.target.value)}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="">Select…</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">To store</label>
                <select
                  required
                  value={createForm.toStoreId}
                  onChange={(e) => setCreateForm({ ...createForm, toStoreId: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="">Select…</option>
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
                <label className="block text-xs font-medium text-slate-600 mb-1">Add item</label>
                <div className="flex gap-2">
                  <select
                    value={pendingProductId}
                    onChange={(e) => setPendingProductId(e.target.value)}
                    className="flex-1 border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                  >
                    <option value="">Select a product…</option>
                    {fromStoreProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.stock} in stock)
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={pendingQuantity}
                    onChange={(e) => setPendingQuantity(e.target.value)}
                    className="w-20 border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                  />
                  <button type="button" onClick={addLineItem} className="text-sm px-3 py-1.5 border border-[var(--border)] rounded-lg">
                    Add
                  </button>
                </div>
              </div>
            )}

            {createForm.items.length > 0 && (
              <ul className="text-sm space-y-1">
                {createForm.items.map((item) => (
                  <li key={item.productId} className="flex items-center justify-between">
                    <span>
                      {item.quantity}× {item.name}
                    </span>
                    <button type="button" onClick={() => removeLineItem(item.productId)} className="text-red-600 text-xs">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="text-sm px-3 py-1.5">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmitCreate}
                className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
              >
                Request transfer
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
