import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { EMPTY_FILTERS, STOCK_FILTERS, activeFilterCount, effectivePrice, filterProducts, sortProducts } from '../lib/productFilters';
import Modal from '../components/Modal.jsx';
import ImportExportWizard from './ImportExportWizard.jsx';

const EMPTY_FORM = {
  name: '',
  barcode: '',
  category: '',
  price: '',
  priceOverride: '',
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
    priceOverride: product.priceOverride != null ? String(product.priceOverride) : '',
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
    priceOverride: form.priceOverride.trim() === '' ? null : Number(form.priceOverride),
    currency: form.currency,
    costPrice: Number(form.costPrice) || 0,
    stock: Number(form.stock) || 0,
    lowStockThreshold: Number(form.lowStockThreshold) || 5,
  };
}

const PAGE_SIZE = 50;
const fmtPrice = (amount, currency) =>
  currency === 'KHR' ? `${Math.round(Number(amount)).toLocaleString()} ៛` : `${Number(amount).toFixed(2)}`;

export default function ProductsPage() {
  const { storeId } = useOutletContext();
  const [error, setError] = useState(''); // save/delete errors
  // Search, per-column filters and sort (issue #8), applied in the browser.
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ col: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const searchRef = useRef(null);
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const [editing, setEditing] = useState(null); // null | 'new' | product object
  const [form, setForm] = useState(EMPTY_FORM);
  const [showImportExport, setShowImportExport] = useState(false);

  // Cached (lib/queryClient.js): re-opening the tab shows the last list at
  // once and refreshes it in the background when stale.
  const queryClient = useQueryClient();
  const productsQuery = useQuery({
    queryKey: queryKeys.products(storeId),
    queryFn: async () => {
      const data = await apiClient.get(`/api/stores/${storeId}/products`);
      return Array.isArray(data) ? data : [];
    },
    enabled: Boolean(storeId),
  });
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const loading = productsQuery.isPending;

  // Deferred, so typing stays responsive while a long list re-filters.
  const deferredFilters = useDeferredValue(filters);
  const visible = useMemo(
    () => sortProducts(filterProducts(products, deferredFilters), sort),
    [products, deferredFilters, sort]
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filterCount = activeFilterCount(filters);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [filters, sort, storeId]);

  // "/" jumps to the search box (unless already typing somewhere).
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (e.key !== '/' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleSort = (col) =>
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  // After a save: refresh this store's product lists (full and low-stock),
  // and reports, whose negative-stock list depends on stock.
  const load = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.products(storeId) }),
      queryClient.invalidateQueries({ queryKey: ['reports'] }),
    ]);

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

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          ref={searchRef}
          type="search"
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
          placeholder="Search by name or barcode…  ( / )"
          className="flex-1 min-w-64 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-white"
        />
        <span className="text-sm text-slate-500">
          {visible.length === products.length ? `${products.length} products` : `${visible.length} of ${products.length} products`}
        </span>
        {(filterCount > 0 || filters.search) && (
          <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-sm text-[var(--accent)] font-medium">
            Clear {filterCount > 0 ? `filters (${filterCount})` : 'search'}
          </button>
        )}
      </div>

      {(error || productsQuery.isError) && (
        <p className="text-sm text-red-600 mb-3">{error || 'Failed to load products.'}</p>
      )}

      <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <SortHeader col="name" sort={sort} onSort={toggleSort}>Name</SortHeader>
              <SortHeader col="barcode" sort={sort} onSort={toggleSort}>Barcode</SortHeader>
              <SortHeader col="price" sort={sort} onSort={toggleSort}>Price</SortHeader>
              <SortHeader col="stock" sort={sort} onSort={toggleSort}>Stock</SortHeader>
              <th className="px-4 py-2"></th>
            </tr>
            <tr className="border-t border-[var(--border)] align-top">
              <th className="px-4 py-2 font-normal">
                <input value={filters.name} onChange={(e) => setFilter('name', e.target.value)} placeholder="Filter name" className={filterInput} />
              </th>
              <th className="px-4 py-2 font-normal">
                <div className="flex gap-1">
                  <select value={filters.barcodeMode} onChange={(e) => setFilter('barcodeMode', e.target.value)} className={filterInput}>
                    <option value="any">Any</option>
                    <option value="missing">No barcode</option>
                  </select>
                  {filters.barcodeMode === 'any' && (
                    <input value={filters.barcode} onChange={(e) => setFilter('barcode', e.target.value)} placeholder="Contains" className={filterInput} />
                  )}
                </div>
              </th>
              <th className="px-4 py-2 font-normal">
                <div className="flex gap-1">
                  <select value={filters.currency} onChange={(e) => setFilter('currency', e.target.value)} className={filterInput}>
                    <option value="all">All</option>
                    <option value="USD">USD</option>
                    <option value="KHR">KHR</option>
                  </select>
                  <input type="number" value={filters.priceMin} onChange={(e) => setFilter('priceMin', e.target.value)} placeholder="Min" className={`${filterInput} w-20`} />
                  <input type="number" value={filters.priceMax} onChange={(e) => setFilter('priceMax', e.target.value)} placeholder="Max" className={`${filterInput} w-20`} />
                </div>
              </th>
              <th className="px-4 py-2 font-normal">
                <select value={filters.stock} onChange={(e) => setFilter('stock', e.target.value)} className={filterInput}>
                  {STOCK_FILTERS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </th>
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
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-400" colSpan={5}>
                  {products.length === 0 ? 'No products.' : 'No products match the search or filters.'}
                </td>
              </tr>
            ) : (
              pageRows.map((p) => (
                <tr key={p.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-slate-500">{p.barcode ?? '—'}</td>
                  <td className="px-4 py-2">
                    {fmtPrice(effectivePrice(p), p.currency)}
                    {p.priceOverride != null && (
                      <span className="ml-2 text-xs text-slate-400 line-through">{fmtPrice(p.defaultPrice, p.currency)}</span>
                    )}
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

      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-slate-600">
          <span>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visible.length)} of {visible.length}
          </span>
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="px-3 py-1 border border-[var(--border)] rounded-lg disabled:opacity-40">Prev</button>
            <span>Page {page} / {pageCount}</span>
            <button disabled={page === pageCount} onClick={() => setPage(page + 1)} className="px-3 py-1 border border-[var(--border)] rounded-lg disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

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
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Price override <span className="text-slate-400">(this store only, leave blank to use the price above)</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Same as price"
                value={form.priceOverride}
                onChange={(e) => setForm({ ...form, priceOverride: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
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

const filterInput = 'w-full border border-[var(--border)] rounded-md px-2 py-1 text-xs bg-white text-slate-700';

function SortHeader({ col, sort, onSort, children }) {
  const active = sort.col === col;
  return (
    <th className="px-4 py-2">
      <button type="button" onClick={() => onSort(col)} className="font-medium hover:text-slate-800 select-none">
        {children}
        <span className="ml-1 text-[var(--accent)]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
}
