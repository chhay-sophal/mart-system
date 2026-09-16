import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import Modal from '../components/Modal.jsx';
import ImportExportWizard from './ImportExportWizard.jsx';

const EMPTY_FORM = {
  name: '',
  barcode: '',
  category: '',
  price: '',
  currency: 'USD',
  costPrice: '',
  stock: '',
  lowStockThreshold: '5',
};

function toFormState(product) {
  return {
    name: product.name ?? '',
    barcode: product.barcode ?? '',
    category: product.category ?? '',
    price: String(product.defaultPrice ?? ''),
    currency: product.currency ?? 'USD',
    costPrice: String(product.costPrice ?? ''),
    stock: String(product.stock ?? ''),
    lowStockThreshold: String(product.lowStockThreshold ?? '5'),
  };
}

function toRequestBody(form) {
  return {
    name: form.name.trim(),
    barcode: form.barcode.trim() || null,
    category: form.category.trim() || null,
    price: Number(form.price),
    currency: form.currency,
    costPrice: Number(form.costPrice) || 0,
    stock: Number(form.stock) || 0,
    lowStockThreshold: Number(form.lowStockThreshold) || 5,
  };
}

export default function ProductsPage() {
  const { storeId } = useOutletContext();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | product object
  const [form, setForm] = useState(EMPTY_FORM);
  const [showImportExport, setShowImportExport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const path = lowStockOnly
        ? `/api/stores/${storeId}/products/low-stock`
        : `/api/stores/${storeId}/products`;
      const data = await apiClient.get(path);
      setProducts(lowStockOnly ? data.items ?? [] : data);
    } catch {
      setError('Failed to load products.');
    } finally {
      setLoading(false);
    }
  }, [storeId, lowStockOnly]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing('new');
  }

  function openEdit(product) {
    setForm(toFormState(product));
    setEditing(product);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const body = toRequestBody(form);
    try {
      if (editing === 'new') {
        await apiClient.post(`/api/stores/${storeId}/products`, body);
      } else {
        await apiClient.put(`/api/stores/${storeId}/products/${editing.id}`, body);
      }
      setEditing(null);
      await load();
    } catch {
      setError('Failed to save product.');
    }
  }

  async function handleDelete(product) {
    if (!window.confirm(`Remove "${product.name}"?`)) return;
    try {
      await apiClient.delete(`/api/stores/${storeId}/products/${product.id}`);
      await load();
    } catch {
      setError('Failed to remove product.');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">Products</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
            Low stock only
          </label>
          <button
            onClick={() => setShowImportExport(true)}
            className="text-sm font-medium border border-[var(--border)] rounded-lg px-3 py-1.5 hover:bg-slate-50"
          >
            Import / Export
          </button>
          <button
            onClick={openCreate}
            className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5"
          >
            Add product
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Barcode</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Stock</th>
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
            ) : products.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-400" colSpan={5}>
                  No products.
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-slate-500">{p.barcode ?? '—'}</td>
                  <td className="px-4 py-2">
                    {p.currency} {Number(p.defaultPrice).toFixed(2)}
                  </td>
                  <td className="px-4 py-2">
                    {p.stock}
                    {p.stock <= p.lowStockThreshold && (
                      <span className="ml-2 text-xs text-amber-600">low</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => openEdit(p)} className="text-[var(--accent)] font-medium mr-3">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(p)} className="text-red-600 font-medium">
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing === 'new' ? 'Add product' : 'Edit product'} onClose={() => setEditing(null)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Barcode</label>
                <input
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Price</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Currency</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="USD">USD</option>
                  <option value="KHR">KHR</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cost price</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Stock</label>
                <input
                  type="number"
                  step="1"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Low-stock threshold</label>
                <input
                  type="number"
                  step="1"
                  value={form.lowStockThreshold}
                  onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="text-sm px-3 py-1.5">
                Cancel
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5">
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showImportExport && (
        <ImportExportWizard
          storeId={storeId}
          products={products}
          onClose={() => setShowImportExport(false)}
          onImported={load}
        />
      )}
    </div>
  );
}
