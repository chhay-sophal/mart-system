import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { physicalKeyChar } from '../lib/physicalKey';
import {
  STATUS_FILTERS,
  STOCK_FILTERS,
  comparePriceBy,
  effectivePrice,
  inNumberRange,
  matchesStatus,
  matchesStock,
  matchesTextOrMissing,
} from '../lib/productFilters';
import { rangeText, useDataTable } from '../hooks/useDataTable';
import Modal from '../components/Modal.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import DataTable from '../components/DataTable.jsx';
import FilterButton from '../components/FilterButton.jsx';
import FilterChips from '../components/FilterChips.jsx';
import SearchInput from '../components/SearchInput.jsx';
import { useSearch } from '../hooks/useSearch';
import ColumnFilter, { filterInput } from '../components/ColumnFilter.jsx';
import ImportExportWizard from './ImportExportWizard.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt, plural } from '../i18n/translate';

const EMPTY_FORM = {
  name: '',
  barcode: '',
  categoryId: '',
  price: '',
  priceOverride: '',
  currency: 'USD',
  costPrice: '',
  stock: '',
  lowStockThreshold: '5',
  supplierId: '',
};

function toFormState(product) {
  return {
    name: product.name ?? '',
    barcode: product.barcode ?? '',
    categoryId: product.categoryId ?? '',
    price: String(product.defaultPrice ?? ''),
    priceOverride: product.priceOverride != null ? String(product.priceOverride) : '',
    currency: product.currency ?? 'USD',
    costPrice: String(product.costPrice ?? ''),
    stock: String(product.stock ?? ''),
    lowStockThreshold: String(product.lowStockThreshold ?? '5'),
    supplierId: product.supplierId ?? '',
  };
}

function toRequestBody(form) {
  return {
    name: form.name.trim(),
    barcode: form.barcode.trim() || null,
    categoryId: form.categoryId || null,
    price: Number(form.price),
    priceOverride: form.priceOverride.trim() === '' ? null : Number(form.priceOverride),
    currency: form.currency,
    costPrice: Number(form.costPrice) || 0,
    stock: Number(form.stock) || 0,
    lowStockThreshold: Number(form.lowStockThreshold) || 5,
    supplierId: form.supplierId || null,
  };
}

const PAGE_SIZE = 50;
const fmtPrice = (amount, currency) =>
  currency === 'KHR' ? `${Math.round(Number(amount)).toLocaleString()} ៛` : `${Number(amount).toFixed(2)}`;
const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');
const muted = 'text-slate-500 dark:text-slate-400';
const CURRENCY_OPTIONS = ['USD', 'KHR'].map((c) => ({ value: c, label: c }));

// A "contains" text box plus a "missing only" checkbox, for barcode and
// supplier. The value keeps its { mode: 'any' | 'missing', text } shape.
function TextOrMissingFilter({ value, onChange, missingLabel, placeholder }) {
  const missing = value.mode === 'missing';
  return (
    <div className="flex flex-col gap-1.5">
      {!missing && (
        <input value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} placeholder={placeholder} className={filterInput} />
      )}
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
        <input
          type="checkbox"
          checked={missing}
          onChange={() => onChange({ ...value, mode: missing ? 'any' : 'missing' })}
          className="accent-indigo-600 cursor-pointer"
        />
        {missingLabel}
      </label>
    </div>
  );
}

export default function ProductsPage() {
  const { storeId } = useOutletContext();
  const { stores } = useAuth();
  const confirm = useConfirm();
  const { t } = useLocale();
  const [error, setError] = useState(''); // save/delete errors
  // This page's own store filter -- independent of the header's global store
  // switcher. '' means "All stores"; null means "not initialized yet" (stores
  // haven't loaded), which keeps the products query disabled below.
  const [viewStoreId, setViewStoreId] = useState(null);
  // Search bar (issue #8), applied in the browser before the table's own
  // per-column filters/sort (useDataTable below).
  const [page, setPage] = useState(1);
  // Mirrors the table's status filter (kept in step by `table` below): the
  // products query needs it before the table hook can run, since the hook
  // needs the query's rows.
  const [statusFilter, setStatusFilter] = useState(['active']);
  const [editing, setEditing] = useState(null); // null | 'new' | product object
  const [form, setForm] = useState(EMPTY_FORM);
  const [showImportExport, setShowImportExport] = useState(false);
  const [viewingSupplierFor, setViewingSupplierFor] = useState(null); // the clicked product, or null
  // Bulk delete: storeProductIds (not product ids -- the same product can
  // appear from more than one store in the "All stores" view) persist across
  // filter/sort/page changes (so a multi-page selection isn't silently
  // dropped), but reset when the view's store filter changes.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // The status column's own filter drives this -- anything but the default
  // "active only" needs archived rows included in what the backend returns at all.
  const includeDeleted = !(statusFilter.length === 1 && statusFilter[0] === 'active');

  // Seeds the view filter from the header's current store the first time it's
  // available, but never again -- once the user's picked a store (or "All
  // stores") here, switching the header's store elsewhere shouldn't silently
  // override this page's own choice.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (storeId && viewStoreId === null) setViewStoreId(storeId);
  }, [storeId, viewStoreId]);

  // Cached (lib/queryClient.js): re-opening the tab shows the last list at
  // once and refreshes it in the background when stale.
  const queryClient = useQueryClient();
  const productsQuery = useQuery({
    queryKey: queryKeys.products(viewStoreId, includeDeleted),
    queryFn: async () => {
      const url = viewStoreId ? `/api/stores/${viewStoreId}/products` : '/api/products';
      const data = await apiClient.get(`${url}${includeDeleted ? '?includeDeleted=true' : ''}`);
      return Array.isArray(data) ? data : [];
    },
    enabled: viewStoreId != null,
  });
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const loading = productsQuery.isPending;
  // Which store "Add product" targets: the store currently being viewed, or
  // (viewing "All stores") the header's active store -- there's no single
  // store to default a new product into otherwise.
  const createStoreId = viewStoreId || storeId;
  // The store's main currency (Settings > POS) is a new product's default.
  const settingsQuery = useQuery({
    queryKey: queryKeys.storeSettings(createStoreId),
    queryFn: () => apiClient.get(`/api/stores/${createStoreId}/settings`),
    enabled: Boolean(createStoreId),
  });
  const mainCurrency = settingsQuery.data?.settings?.main_currency === 'KHR' ? 'KHR' : 'USD';

  // Also backs the read-only supplier-details popup (click a product's
  // supplier name) -- reuses this instead of a separate fetch per click.
  const suppliersQuery = useQuery({
    queryKey: queryKeys.suppliers(storeId),
    queryFn: () => apiClient.get(`/api/stores/${storeId}/suppliers`),
    enabled: Boolean(storeId),
  });
  const suppliers = useMemo(() => suppliersQuery.data ?? [], [suppliersQuery.data]);
  // Active categories, for the form's picker.
  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories(storeId),
    queryFn: () => apiClient.get(`/api/stores/${storeId}/categories`),
    enabled: Boolean(storeId),
  });
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  // The Category column's filter choices: every category the loaded products
  // actually use (archived ones included), plus "No category".
  const categoryOptions = useMemo(() => {
    const byId = new Map();
    for (const p of products) if (p.categoryId) byId.set(p.categoryId, p.categoryName);
    return [...byId]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([value, label]) => ({ value, label }))
      .concat({ value: 'none', label: t.products.noCategory });
  }, [products, t]);
  // A soft-deleted supplier drops out of the list above (and its own GET
  // 404s), so fall back to the name already cached on the product itself --
  // the only thing still available once a supplier's been removed.
  const viewingSupplier = viewingSupplierFor
    ? (suppliers.find((s) => s.id === viewingSupplierFor.supplierId) ?? { name: viewingSupplierFor.supplierName, deleted: true })
    : null;

  // Deferred, so typing stays responsive while a long list re-filters.
  const search = useSearch(products, [(p) => p.name, (p) => p.barcode]);

  const baseTable = useDataTable({
    rows: search.results,
    initialSort: { col: 'name', dir: 'asc' },
    columns: [
      {
        key: 'select',
        className: 'w-8',
        header: null, // the select-all checkbox -- filled in below, once the page's rows are known
        render: (p) => (
          <input
            type="checkbox"
            checked={selected.has(p.storeProductId)}
            onChange={() => toggleSelected(p.storeProductId)}
            disabled={p.isDeleted}
            className="accent-indigo-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          />
        ),
      },
      { key: 'name', label: t.products.colName, sortValue: (p) => p.name, filter: { type: 'text', placeholder: t.products.filterName } },
      ...(viewStoreId === '' ? [{ key: 'store', label: t.products.colStore, cellClassName: muted, render: (p) => p.storeName }] : []),
      {
        key: 'barcode', label: t.products.colBarcode, cellClassName: muted, render: (p) => p.barcode ?? '—', sortValue: (p) => p.barcode,
        filter: {
          type: 'custom',
          empty: { mode: 'any', text: '' },
          match: (p, v) => matchesTextOrMissing(p.barcode, v),
          describe: (v) => (v.mode === 'missing' ? t.products.noBarcode : v.text.trim()),
          render: (props) => <TextOrMissingFilter {...props} missingLabel={t.products.noBarcode} placeholder={t.products.contains} />,
        },
      },
      {
        key: 'category', label: t.products.category, cellClassName: muted, render: (p) => p.categoryName ?? '—',
        sortValue: (p) => p.categoryName,
        filter: { type: 'select', value: (p) => p.categoryId ?? 'none', options: categoryOptions },
      },
      {
        key: 'costPrice', label: t.products.colCostPrice, cellClassName: muted, render: (p) => fmtPrice(p.costPrice, p.currency),
        compare: comparePriceBy((p) => Number(p.costPrice)),
        filter: { type: 'numberRange', value: (p) => Number(p.costPrice), minPlaceholder: t.products.min, maxPlaceholder: t.products.max },
      },
      {
        key: 'price', label: t.products.colPrice, compare: comparePriceBy(effectivePrice),
        render: (p) => (
          <>
            {fmtPrice(effectivePrice(p), p.currency)}
            {p.priceOverride != null && (
              <span className="ml-2 text-xs text-slate-400 dark:text-slate-500 line-through">{fmtPrice(p.defaultPrice, p.currency)}</span>
            )}
          </>
        ),
        filter: {
          type: 'custom',
          // currencies: checked currency codes, none checked = any currency.
          empty: { currencies: [], min: '', max: '' },
          match: (p, v) =>
            (v.currencies.length === 0 || v.currencies.includes(p.currency)) && inNumberRange(effectivePrice(p), v.min, v.max),
          describe: (v) =>
            [v.currencies.join(', '), (v.min !== '' || v.max !== '') && rangeText(v.min, v.max)].filter(Boolean).join(' '),
          render: ({ value, onChange }) => (
            <div className="flex flex-col gap-1.5">
              <ColumnFilter
                filter={{ type: 'select', options: CURRENCY_OPTIONS }}
                value={value.currencies}
                onChange={(currencies) => onChange({ ...value, currencies })}
              />
              <div className="flex gap-1">
                <input type="number" value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value })} placeholder={t.products.min} className={`${filterInput} flex-1 min-w-0`} />
                <input type="number" value={value.max} onChange={(e) => onChange({ ...value, max: e.target.value })} placeholder={t.products.max} className={`${filterInput} flex-1 min-w-0`} />
              </div>
            </div>
          ),
        },
      },
      {
        key: 'stock', label: t.products.colStock, sortValue: (p) => p.stock,
        render: (p) => (
          <>
            {p.stock}
            {p.stock <= p.lowStockThreshold && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">{t.products.lowBadge}</span>}
          </>
        ),
        filter: { type: 'select', options: STOCK_FILTERS, match: matchesStock },
      },
      {
        key: 'supplier', label: t.products.colSupplier, sortValue: (p) => p.supplierName,
        render: (p) =>
          p.supplierName ? (
            <button onClick={() => setViewingSupplierFor(p)} className="text-[var(--accent)] hover:underline cursor-pointer">
              {p.supplierName}
            </button>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">—</span>
          ),
        filter: {
          type: 'custom',
          empty: { mode: 'any', text: '' },
          match: (p, v) => matchesTextOrMissing(p.supplierName, v),
          describe: (v) => (v.mode === 'missing' ? t.products.noSupplier : v.text.trim()),
          render: (props) => <TextOrMissingFilter {...props} missingLabel={t.products.noSupplier} placeholder={t.products.contains} />,
        },
      },
      {
        key: 'status', label: t.products.colStatus, sortValue: (p) => p.isDeleted,
        render: (p) =>
          p.isDeleted ? (
            <span className={muted}>{t.products.statusArchived}</span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t.products.statusActive}</span>
          ),
        filter: { type: 'select', defaultValue: ['active'], options: STATUS_FILTERS, match: matchesStatus },
      },
      {
        key: 'createdAt', label: t.products.colCreated, cellClassName: `${muted} whitespace-nowrap`, render: (p) => formatDate(p.createdAt),
        sortValue: (p) => new Date(p.createdAt).getTime(), filter: { type: 'dateRange', value: (p) => p.createdAt },
      },
      {
        key: 'updatedAt', label: t.products.colUpdated, cellClassName: `${muted} whitespace-nowrap`, render: (p) => formatDate(p.updatedAt),
        sortValue: (p) => new Date(p.updatedAt).getTime(), filter: { type: 'dateRange', value: (p) => p.updatedAt },
      },
      {
        key: 'actions', label: '', cellClassName: 'text-right',
        render: (p) =>
          p.isDeleted ? (
            <button onClick={() => handleRestore(p)} className="text-[var(--accent)] font-medium cursor-pointer">
              {t.common.restore}
            </button>
          ) : (
            <>
              <button onClick={() => openEdit(p)} className="text-[var(--accent)] font-medium mr-3 cursor-pointer">
                {t.common.edit}
              </button>
              <button onClick={() => handleArchive(p)} className="text-slate-600 dark:text-slate-300 font-medium cursor-pointer">
                {t.common.archive}
              </button>
            </>
          ),
      },
    ],
  });
  const visible = baseTable.visible;
  const filterCount = baseTable.filterCount;

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // Archived rows aren't selectable (their own checkbox is disabled), so
  // "select all" shouldn't try to select them either. Keyed by storeProductId,
  // not product id -- the same product can appear once per store it's
  // stocked at in the "All stores" view.
  const pageIds = pageRows.filter((p) => !p.isDeleted).map((p) => p.storeProductId);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageSelected = !allPageSelected && pageIds.some((id) => selected.has(id));

  const table = {
    ...baseTable,
    columns: baseTable.columns.map((c) =>
      c.key === 'select'
        ? {
            ...c,
            header: (
              <SelectAllCheckbox
                checked={allPageSelected}
                indeterminate={somePageSelected}
                onChange={() => toggleSelectPage(pageIds, !allPageSelected)}
              />
            ),
          }
        : c
    ),
    // Keeps statusFilter (which drives the query's includeDeleted) in step
    // with the table's own status filter, in the same event -- no lag.
    setFilter: (key, value) => {
      if (key === 'status') setStatusFilter(value);
      baseTable.setFilter(key, value);
    },
    clearFilters: () => {
      setStatusFilter(['active']);
      baseTable.clearFilters();
    },
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [table.filters, table.sort, search.query, viewStoreId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set());
  }, [viewStoreId]);

  // After a save: refresh every product list (full, low-stock, every store
  // and the "All stores" view alike) and reports, whose negative-stock list
  // depends on stock. Prefix match (no storeId/includeDeleted in the key
  // here) invalidates all of them, since a save made from one store's or
  // "All stores"' view should be reflected in every other view too.
  const load = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['reports'] }),
      // Category product counts change when a product moves or is archived.
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
    ]);

  function openCreate() {
    setForm({ ...EMPTY_FORM, currency: mainCurrency });
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
        await apiClient.post(`/api/stores/${createStoreId}/products`, body);
      } else {
        // The row's own store, not createStoreId/the view filter -- editing
        // always targets wherever this particular product actually lives.
        await apiClient.put(`/api/stores/${editing.storeId}/products/${editing.id}`, body);
      }
      setEditing(null);
      await load();
    } catch {
      setError(t.products.saveFailed);
    }
  }

  async function handleArchive(product) {
    if (!(await confirm(fmt(t.products.confirmArchive, { name: product.name }), { confirmLabel: t.common.archive }))) return;
    try {
      await apiClient.delete(`/api/stores/${product.storeId}/products/${product.id}`);
      await load();
    } catch {
      setError(t.products.archiveFailed);
    }
  }

  async function handleRestore(product) {
    try {
      await apiClient.post(`/api/stores/${product.storeId}/products/${product.id}/restore`);
      await load();
    } catch {
      setError(t.products.restoreFailed);
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

  async function handleBulkArchive() {
    if (selected.size === 0) return;
    if (!(await confirm(fmt(plural(selected.size, t.products.confirmBulkArchiveOne, t.products.confirmBulkArchive), { count: selected.size }), { confirmLabel: t.common.archive }))) return;
    setBulkDeleting(true);
    try {
      // Selection is by storeProductId, and in the "All stores" view can span
      // several stores -- the bulk-delete endpoint is scoped to one store, so
      // group into one request per store rather than assuming they're all here.
      const byStore = new Map();
      for (const p of products) {
        if (!selected.has(p.storeProductId)) continue;
        if (!byStore.has(p.storeId)) byStore.set(p.storeId, []);
        byStore.get(p.storeId).push(p.id);
      }
      await Promise.all(
        [...byStore.entries()].map(([sid, productIds]) => apiClient.post(`/api/stores/${sid}/products/bulk-delete`, { productIds }))
      );
      setSelected(new Set());
      await load();
    } catch {
      setError(t.products.bulkArchiveFailed);
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">{t.products.title}</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowImportExport(true)}
            className="text-sm font-medium border border-[var(--border)] rounded-lg px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {t.products.importExport}
          </button>
          <button
            onClick={openCreate}
            className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer"
          >
            {t.products.addProduct}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select
          value={viewStoreId ?? ''}
          onChange={(e) => setViewStoreId(e.target.value)}
          className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
        >
          <option value="">{t.common.allStores}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <SearchInput value={search.query} onChange={search.setQuery} placeholder={t.products.searchPlaceholder} shortcut />
        <FilterButton table={table} />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {visible.length === products.length
            ? fmt(plural(products.length, t.products.countOne, t.products.count), { count: products.length })
            : fmt(t.products.countFiltered, { visible: visible.length, total: products.length })}
        </span>
        {(filterCount > 0 || search.isActive) && (
          <button
            onClick={() => {
              search.clear();
              table.clearFilters();
            }}
            className="text-sm text-[var(--accent)] font-medium cursor-pointer">
            {filterCount > 0 ? fmt(t.products.clearFilters, { count: filterCount }) : t.products.clearSearch}
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-lg">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{fmt(t.products.selectedCount, { count: selected.size })}</span>
          <button
            onClick={handleBulkArchive}
            disabled={bulkDeleting}
            className="text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {bulkDeleting ? t.products.archiving : t.products.archiveSelected}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 ml-auto cursor-pointer">
            {t.products.clearSelection}
          </button>
        </div>
      )}

      {(error || productsQuery.isError) && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.products.loadFailed}</p>
      )}

      <FilterChips table={table} />
      <DataTable
        table={table}
        rows={pageRows}
        rowKey={(p) => p.storeProductId}
        loading={loading}
        emptyText={products.length === 0 ? t.products.noProducts : t.products.noMatches}
        noMatchText={t.products.noMatches}
        rowClassName={(p) => (selected.has(p.storeProductId) ? 'bg-indigo-50/50 dark:bg-indigo-950/30' : '')}
      />

      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-slate-600 dark:text-slate-300">
          <span>
            {fmt(t.products.rangeOf, { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, visible.length), total: visible.length })}
          </span>
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="px-3 py-1 border border-[var(--border)] rounded-lg disabled:opacity-40 cursor-pointer">{t.products.prev}</button>
            <span>{fmt(t.products.pageOf, { page, pages: pageCount })}</span>
            <button disabled={page === pageCount} onClick={() => setPage(page + 1)} className="px-3 py-1 border border-[var(--border)] rounded-lg disabled:opacity-40 cursor-pointer">{t.common.next}</button>
          </div>
        </div>
      )}

      {editing && (
        <Modal
          title={
            editing === 'new'
              ? (stores.find((s) => s.id === createStoreId)
                ? fmt(t.products.addProductFor, { store: stores.find((s) => s.id === createStoreId).name })
                : t.products.addProduct)
              : editing.storeName
                ? fmt(t.products.editProductFor, { store: editing.storeName })
                : t.products.editProduct
          }
          onClose={() => setEditing(null)}
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.common.name}</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.products.colBarcode}</label>
                <input
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  onKeyDown={(e) => {
                    // A scanner's trailing Enter would otherwise submit this
                    // form (a plain text input submits on Enter) before the
                    // rest of the fields are filled in.
                    if (e.key === 'Enter') { e.preventDefault(); return; }
                    // A scanner "types" into this field like a keyboard; under
                    // a non-Latin input language the browser would otherwise
                    // insert that language's character for the key instead of
                    // the barcode's actual (ASCII) one. Inserted at the caret
                    // (replacing any selection), not just appended, since this
                    // field is also hand-edited, not only scanned into.
                    const ch = physicalKeyChar(e);
                    if (ch === null) return;
                    e.preventDefault();
                    const input = e.target;
                    const { selectionStart, selectionEnd, value } = input;
                    const next = value.slice(0, selectionStart) + ch + value.slice(selectionEnd);
                    const caret = selectionStart + 1;
                    setForm((prev) => ({ ...prev, barcode: next }));
                    // Setting .value via React's controlled re-render can
                    // otherwise drop the caret to the end of the field.
                    requestAnimationFrame(() => input.setSelectionRange(caret, caret));
                  }}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.products.category}</label>
                <SearchableSelect
                  value={form.categoryId}
                  onChange={(categoryId) => setForm({ ...form, categoryId })}
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  emptyLabel={t.products.noCategory}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.products.currency}</label>
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
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.products.colCostPrice}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.products.colPrice}</label>
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
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                {t.products.priceOverride} <span className="text-slate-400 dark:text-slate-500">{t.products.priceOverrideHint}</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder={t.products.sameAsPrice}
                value={form.priceOverride}
                onChange={(e) => setForm({ ...form, priceOverride: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.products.colStock}</label>
                <input
                  type="number"
                  step="1"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.products.lowStockThreshold}</label>
                <input
                  type="number"
                  step="1"
                  value={form.lowStockThreshold}
                  onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.products.colSupplier}</label>
              <SearchableSelect
                value={form.supplierId}
                onChange={(supplierId) => setForm({ ...form, supplierId })}
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                emptyLabel={t.products.noSupplier}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="text-sm px-3 py-1.5 cursor-pointer">
                {t.common.cancel}
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer">
                {t.common.save}
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

      {viewingSupplierFor && (
        <Modal title={t.products.supplierTitle} onClose={() => setViewingSupplierFor(null)}>
          {viewingSupplier?.deleted ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t.products.supplierRemoved.split('{name}').map((part, i) => (
                <span key={i}>
                  {i > 0 && <span className="font-medium text-[var(--text-h)]">{viewingSupplier.name}</span>}
                  {part}
                </span>
              ))}
            </p>
          ) : (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.common.name}</dt>
                <dd className="text-[var(--text-h)]">{viewingSupplier?.name}</dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.products.phone1}</dt>
                  <dd>{viewingSupplier?.phone1}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.products.phone2}</dt>
                  <dd>{viewingSupplier?.phone2 ?? '—'}</dd>
                </div>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.products.email}</dt>
                <dd>{viewingSupplier?.email ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.products.address}</dt>
                <dd>{viewingSupplier?.address ?? '—'}</dd>
              </div>
            </dl>
          )}
          <div className="flex justify-between items-center pt-4 mt-1">
            <Link to="/suppliers" className="text-sm text-[var(--accent)] font-medium">
              {t.products.manageSuppliers}
            </Link>
            <button onClick={() => setViewingSupplierFor(null)} className="text-sm px-3 h-9 inline-flex items-center justify-center border border-transparent cursor-pointer">
              {t.common.close}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

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
