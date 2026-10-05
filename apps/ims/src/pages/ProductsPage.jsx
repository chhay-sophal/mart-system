import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  // Which column's filter dropdown is open (one at a time) and the one panel
  // DOM node currently rendered, so a single outside-click listener can close it.
  const [openFilterCol, setOpenFilterCol] = useState(null);
  const filterPanelRef = useRef(null);
  const toggleFilterCol = (col) => setOpenFilterCol((prev) => (prev === col ? null : col));
  const [editing, setEditing] = useState(null); // null | 'new' | product object
  const [form, setForm] = useState(EMPTY_FORM);
  const [showImportExport, setShowImportExport] = useState(false);
  // Bulk delete: ids persist across filter/sort/page changes (so a multi-page
  // selection isn't silently dropped), but reset when switching stores.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

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
  const pageIds = pageRows.map((p) => p.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageSelected = !allPageSelected && pageIds.some((id) => selected.has(id));
  const filterCount = activeFilterCount(filters);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [filters, sort, storeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set());
  }, [storeId]);

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

  // Closes the open column filter dropdown on an outside click or Escape.
  useEffect(() => {
    if (!openFilterCol) return;
    const onPointerDown = (e) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target)) setOpenFilterCol(null);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpenFilterCol(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openFilterCol]);

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

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Only affects the current page's rows -- a selection can span pages, but
  // "select all" shouldn't silently reach into rows the user can't see.
  function toggleSelectPage(ids, selectAll) {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (selectAll ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!window.confirm(`Remove ${selected.size} selected product${selected.size === 1 ? '' : 's'}?`)) return;
    setBulkDeleting(true);
    try {
      await apiClient.post(`/api/stores/${storeId}/products/bulk-delete`, { productIds: Array.from(selected) });
      setSelected(new Set());
      await load();
    } catch {
      setError('Failed to remove the selected products.');
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">Products</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowImportExport(true)}
            className="text-sm font-medium border border-[var(--border)] rounded-lg px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
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
          className="flex-1 min-w-64 border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-800"
        />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {visible.length === products.length ? `${products.length} products` : `${visible.length} of ${products.length} products`}
        </span>
        {(filterCount > 0 || filters.search) && (
          <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-sm text-[var(--accent)] font-medium">
            Clear {filterCount > 0 ? `filters (${filterCount})` : 'search'}
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-lg">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{selected.size} selected</span>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bulkDeleting ? 'Removing…' : 'Delete selected'}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 ml-auto">
            Clear selection
          </button>
        </div>
      )}

      {(error || productsQuery.isError) && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || 'Failed to load products.'}</p>
      )}

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
            <tr>
              <th className="px-4 py-2 w-8">
                <SelectAllCheckbox
                  checked={allPageSelected}
                  indeterminate={somePageSelected}
                  onChange={() => toggleSelectPage(pageIds, !allPageSelected)}
                />
              </th>
              <FilterableHeader
                col="name" label="Name" sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'name'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.name !== EMPTY_FILTERS.name}
              >
                <input
                  value={filters.name}
                  onChange={(e) => setFilter('name', e.target.value)}
                  placeholder="Filter name"
                  className={filterInput}
                  autoFocus
                />
              </FilterableHeader>
              <FilterableHeader
                col="barcode" label="Barcode" sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'barcode'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.barcodeMode !== EMPTY_FILTERS.barcodeMode || filters.barcode !== EMPTY_FILTERS.barcode}
              >
                <div className="flex flex-col gap-1.5">
                  <select value={filters.barcodeMode} onChange={(e) => setFilter('barcodeMode', e.target.value)} className={filterInput}>
                    <option value="any">Any</option>
                    <option value="missing">No barcode</option>
                  </select>
                  {filters.barcodeMode === 'any' && (
                    <input value={filters.barcode} onChange={(e) => setFilter('barcode', e.target.value)} placeholder="Contains" className={filterInput} />
                  )}
                </div>
              </FilterableHeader>
              <FilterableHeader
                col="price" label="Price" sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'price'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={
                  filters.currency !== EMPTY_FILTERS.currency ||
                  filters.priceMin !== EMPTY_FILTERS.priceMin ||
                  filters.priceMax !== EMPTY_FILTERS.priceMax
                }
              >
                <div className="flex flex-col gap-1.5">
                  <select value={filters.currency} onChange={(e) => setFilter('currency', e.target.value)} className={filterInput}>
                    <option value="all">All currencies</option>
                    <option value="USD">USD</option>
                    <option value="KHR">KHR</option>
                  </select>
                  <div className="flex gap-1">
                    <input type="number" value={filters.priceMin} onChange={(e) => setFilter('priceMin', e.target.value)} placeholder="Min" className={`${filterInput} w-20`} />
                    <input type="number" value={filters.priceMax} onChange={(e) => setFilter('priceMax', e.target.value)} placeholder="Max" className={`${filterInput} w-20`} />
                  </div>
                </div>
              </FilterableHeader>
              <FilterableHeader
                col="stock" label="Stock" sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'stock'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.stock !== EMPTY_FILTERS.stock}
              >
                <select value={filters.stock} onChange={(e) => setFilter('stock', e.target.value)} className={filterInput}>
                  {STOCK_FILTERS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </FilterableHeader>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={6}>
                  Loading…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={6}>
                  {products.length === 0 ? 'No products.' : 'No products match the search or filters.'}
                </td>
              </tr>
            ) : (
              pageRows.map((p) => (
                <tr key={p.id} className={`border-t border-[var(--border)] ${selected.has(p.id) ? 'bg-indigo-50/50 dark:bg-indigo-950/30' : ''}`}>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelected(p.id)}
                      className="accent-indigo-600 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{p.barcode ?? '—'}</td>
                  <td className="px-4 py-2">
                    {fmtPrice(effectivePrice(p), p.currency)}
                    {p.priceOverride != null && (
                      <span className="ml-2 text-xs text-slate-400 dark:text-slate-500 line-through">{fmtPrice(p.defaultPrice, p.currency)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {p.stock}
                    {p.stock <= p.lowStockThreshold && (
                      <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">low</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => openEdit(p)} className="text-[var(--accent)] font-medium mr-3">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(p)} className="text-red-600 dark:text-red-400 font-medium">
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
        <div className="flex items-center justify-between mt-3 text-sm text-slate-600 dark:text-slate-300">
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
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Barcode</label>
                <input
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Category</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Price</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Currency</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                >
                  <option value="USD">USD</option>
                  <option value="KHR">KHR</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Cost price</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Price override <span className="text-slate-400 dark:text-slate-500">(this store only, leave blank to use the price above)</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Same as price"
                value={form.priceOverride}
                onChange={(e) => setForm({ ...form, priceOverride: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Stock</label>
                <input
                  type="number"
                  step="1"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Low-stock threshold</label>
                <input
                  type="number"
                  step="1"
                  value={form.lowStockThreshold}
                  onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
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

const filterInput = 'w-full border border-[var(--border)] rounded-md px-3 h-9 text-sm bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200';

// A plain `checked` prop can't express "some but not all rows on this page
// are selected" -- that's the DOM-only `indeterminate` property, which has
// no JSX attribute and must be set imperatively on the element itself.
function SelectAllCheckbox({ checked, indeterminate, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} className="accent-indigo-600 cursor-pointer" />;
}

function FilterIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16l-6.5 7.5V19l-3-1.5v-5L4 5z" />
    </svg>
  );
}

// Column header: clicking the label text sorts (unchanged); a separate
// filter button on the right opens a dropdown with that column's filter
// controls, replacing the old always-visible filter-inputs row.
function FilterableHeader({ col, label, sort, onSort, isOpen, onToggleFilter, hasActiveFilter, panelRef, children }) {
  const active = sort.col === col;
  const buttonRef = useRef(null);
  // Screen coordinates for the portaled panel below, in state (not read at
  // render time) so a resize/scroll while open re-renders it at the right spot.
  const [pos, setPos] = useState(null);

  // The table's wrapper div needs overflow-hidden to clip its background to
  // the rounded corners, which would also clip this dropdown if it rendered
  // as a normal descendant -- a short table (few rows) left no room below.
  // Rendering it through a portal, positioned from the button's own
  // viewport rect, escapes that clipping entirely.
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const updatePos = () => {
      const r = buttonRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isOpen]);

  return (
    <th className="px-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => onSort(col)} className="font-medium hover:text-slate-800 dark:hover:text-slate-100 select-none">
          {label}
          <span className="ml-1 text-[var(--accent)]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
        <button
          ref={buttonRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFilter(col); }}
          aria-label={`Filter ${label}`}
          aria-expanded={isOpen}
          className={`p-1 rounded-md transition-colors cursor-pointer ${
            hasActiveFilter ? 'bg-indigo-50 dark:bg-indigo-950/40 text-[var(--accent)]' : 'text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <FilterIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      {isOpen && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 min-w-[200px] bg-white dark:bg-slate-800 border border-[var(--border)] rounded-lg shadow-lg p-3 font-normal"
        >
          {children}
        </div>,
        document.body
      )}
    </th>
  );
}
