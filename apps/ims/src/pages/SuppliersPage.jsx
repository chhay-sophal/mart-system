import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useColumnFilter } from '../hooks/useColumnFilter';
import Modal from '../components/Modal.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import FilterableHeader, { filterInput } from '../components/FilterableHeader.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt, plural } from '../i18n/translate';

const STATUS_FILTERS = ['active', 'archived', 'all'];

// One filters object (search bar + every column's own filter dropdown),
// mirroring ProductsPage's EMPTY_FILTERS/filterProducts pattern.
const EMPTY_FILTERS = {
  search: '', // name, phone, or email (top search bar)
  name: '',
  phone1: '',
  phone2: '',
  email: '',
  address: '',
  productsMin: '',
  productsMax: '',
  status: 'active', // active | archived | all
};

const norm = (value) => String(value ?? '').trim().toLowerCase();

function matchesStatus(s, mode) {
  switch (mode) {
    case 'archived':
      return s.isDeleted;
    case 'all':
      return true;
    default: // 'active'
      return !s.isDeleted;
  }
}

function filterSuppliers(suppliers, f) {
  const search = norm(f.search);
  const name = norm(f.name);
  const phone1 = f.phone1.trim();
  const phone2 = f.phone2.trim();
  const email = norm(f.email);
  const address = norm(f.address);
  const min = f.productsMin === '' ? null : Number(f.productsMin);
  const max = f.productsMax === '' ? null : Number(f.productsMax);
  return suppliers.filter((s) => {
    if (search) {
      const hit =
        norm(s.name).includes(search) ||
        s.phone1.includes(search) ||
        (s.phone2 ?? '').includes(search) ||
        norm(s.email).includes(search);
      if (!hit) return false;
    }
    if (name && !norm(s.name).includes(name)) return false;
    if (phone1 && !s.phone1.includes(phone1)) return false;
    if (phone2 && !(s.phone2 ?? '').includes(phone2)) return false;
    if (email && !norm(s.email).includes(email)) return false;
    if (address && !norm(s.address).includes(address)) return false;
    if (min !== null && !(s.productCount >= min)) return false;
    if (max !== null && !(s.productCount <= max)) return false;
    return matchesStatus(s, f.status);
  });
}

const activeFilterCount = (f) =>
  Object.entries(EMPTY_FILTERS).filter(([key, empty]) => key !== 'search' && f[key] !== empty).length;

const EMPTY_FORM = { name: '', phone1: '', phone2: '', email: '', address: '' };
const PAGE_SIZE = 50;

function toFormState(supplier) {
  return {
    name: supplier.name ?? '',
    phone1: supplier.phone1 ?? '',
    phone2: supplier.phone2 ?? '',
    email: supplier.email ?? '',
    address: supplier.address ?? '',
  };
}

function toRequestBody(form) {
  return {
    name: form.name.trim(),
    phone1: form.phone1.trim(),
    phone2: form.phone2.trim() || null,
    email: form.email.trim() || null,
    address: form.address.trim() || null,
  };
}

export default function SuppliersPage() {
  const { storeId } = useOutletContext();
  const confirm = useConfirm();
  const { t } = useLocale();
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ col: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | supplier object
  const [form, setForm] = useState(EMPTY_FORM);
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const { openFilterCol, toggleFilterCol, filterPanelRef } = useColumnFilter();
  // Anything but the default "active" needs archived rows included in what
  // the backend returns at all.
  const includeDeleted = filters.status !== 'active';

  const queryClient = useQueryClient();
  const suppliersQuery = useQuery({
    queryKey: queryKeys.suppliers(storeId, includeDeleted),
    queryFn: () => apiClient.get(`/api/stores/${storeId}/suppliers${includeDeleted ? '?includeDeleted=true' : ''}`),
    enabled: Boolean(storeId),
  });
  const suppliers = useMemo(() => suppliersQuery.data ?? [], [suppliersQuery.data]);
  const loading = suppliersQuery.isPending;
  const filterCount = activeFilterCount(filters);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [filters, sort, storeId]);

  const toggleSort = (col) =>
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));

  // Prefix match (no includeDeleted in the key here) invalidates both the
  // plain and the show-archived variant, since either one can change a save.
  const load = () => queryClient.invalidateQueries({ queryKey: ['suppliers', storeId] });

  const visible = filterSuppliers(suppliers, filters)
    .sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      switch (sort.col) {
        case 'phone1':  return dir * a.phone1.localeCompare(b.phone1);
        case 'phone2':  return dir * (a.phone2 ?? '').localeCompare(b.phone2 ?? '');
        case 'email':   return dir * (a.email ?? '').localeCompare(b.email ?? '');
        case 'address': return dir * (a.address ?? '').localeCompare(b.address ?? '');
        case 'products': return dir * (a.productCount - b.productCount);
        case 'status':  return dir * (Number(a.isDeleted) - Number(b.isDeleted));
        default:        return dir * a.name.localeCompare(b.name);
      }
    });

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing('new');
  }

  function openEdit(supplier) {
    setForm(toFormState(supplier));
    setEditing(supplier);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const body = toRequestBody(form);
    try {
      if (editing === 'new') {
        await apiClient.post(`/api/stores/${storeId}/suppliers`, body);
      } else {
        await apiClient.put(`/api/stores/${storeId}/suppliers/${editing.id}`, body);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err?.body?.error ?? t.suppliers.saveFailed);
    }
  }

  async function handleDelete(supplier) {
    const message = supplier.productCount === 0
      ? fmt(t.suppliers.confirmDelete, { name: supplier.name })
      : fmt(plural(supplier.productCount, t.suppliers.confirmArchiveOne, t.suppliers.confirmArchiveMany), {
          name: supplier.name,
          count: supplier.productCount,
        });
    const confirmLabel = supplier.productCount === 0 ? t.common.delete : t.common.archive;
    if (!(await confirm(message, { confirmLabel, danger: supplier.productCount === 0 }))) return;
    try {
      await apiClient.delete(`/api/stores/${storeId}/suppliers/${supplier.id}`);
      await load();
    } catch {
      setError(t.suppliers.removeFailed);
    }
  }

  async function handleRestore(supplier) {
    try {
      await apiClient.post(`/api/stores/${storeId}/suppliers/${supplier.id}/restore`);
      await load();
    } catch {
      setError(t.suppliers.restoreFailed);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">{t.suppliers.title}</h1>
        <button
          onClick={openCreate}
          className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer"
        >
          {t.suppliers.add}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          type="search"
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
          placeholder={t.suppliers.searchPlaceholder}
          className="flex-1 min-w-64 border border-[var(--border)] rounded-lg px-3 h-9 text-sm bg-white dark:bg-slate-800"
        />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {visible.length === suppliers.length
            ? fmt(t.suppliers.count, { count: suppliers.length })
            : fmt(t.suppliers.countFiltered, { visible: visible.length, total: suppliers.length })}
        </span>
        {(filterCount > 0 || filters.search) && (
          <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-sm text-[var(--accent)] font-medium cursor-pointer">
            {filterCount > 0 ? fmt(t.suppliers.clearFilters, { count: filterCount }) : t.suppliers.clearSearch}
          </button>
        )}
      </div>

      {(error || suppliersQuery.isError) && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.suppliers.loadFailed}</p>
      )}

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
            <tr>
              <FilterableHeader
                col="name" label={t.common.name} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'name'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.name !== EMPTY_FILTERS.name}
              >
                <input
                  value={filters.name}
                  onChange={(e) => setFilter('name', e.target.value)}
                  placeholder={t.suppliers.filterName}
                  className={filterInput}
                  autoFocus
                />
              </FilterableHeader>
              <FilterableHeader
                col="phone1" label={t.suppliers.phone1} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'phone1'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.phone1 !== EMPTY_FILTERS.phone1}
              >
                <input
                  value={filters.phone1}
                  onChange={(e) => setFilter('phone1', e.target.value)}
                  placeholder={t.suppliers.contains}
                  className={filterInput}
                />
              </FilterableHeader>
              <FilterableHeader
                col="phone2" label={t.suppliers.phone2} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'phone2'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.phone2 !== EMPTY_FILTERS.phone2}
              >
                <input
                  value={filters.phone2}
                  onChange={(e) => setFilter('phone2', e.target.value)}
                  placeholder={t.suppliers.contains}
                  className={filterInput}
                />
              </FilterableHeader>
              <FilterableHeader
                col="email" label={t.suppliers.email} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'email'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.email !== EMPTY_FILTERS.email}
              >
                <input
                  value={filters.email}
                  onChange={(e) => setFilter('email', e.target.value)}
                  placeholder={t.suppliers.contains}
                  className={filterInput}
                />
              </FilterableHeader>
              <FilterableHeader
                col="address" label={t.suppliers.address} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'address'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.address !== EMPTY_FILTERS.address}
              >
                <input
                  value={filters.address}
                  onChange={(e) => setFilter('address', e.target.value)}
                  placeholder={t.suppliers.contains}
                  className={filterInput}
                />
              </FilterableHeader>
              <FilterableHeader
                col="products" label={t.suppliers.products} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'products'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.productsMin !== EMPTY_FILTERS.productsMin || filters.productsMax !== EMPTY_FILTERS.productsMax}
              >
                <div className="flex gap-1">
                  <input type="number" value={filters.productsMin} onChange={(e) => setFilter('productsMin', e.target.value)} placeholder={t.suppliers.min} className={`${filterInput} w-20`} />
                  <input type="number" value={filters.productsMax} onChange={(e) => setFilter('productsMax', e.target.value)} placeholder={t.suppliers.max} className={`${filterInput} w-20`} />
                </div>
              </FilterableHeader>
              <FilterableHeader
                col="status" label={t.common.status} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'status'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.status !== EMPTY_FILTERS.status}
              >
                <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={filterInput}>
                  {STATUS_FILTERS.map((value) => (
                    <option key={value} value={value}>{t.common[value]}</option>
                  ))}
                </select>
              </FilterableHeader>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={8}>
                  {t.common.loading}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={8}>
                  {suppliers.length === 0 ? t.suppliers.noSuppliers : t.suppliers.noMatch}
                </td>
              </tr>
            ) : (
              pageRows.map((s) => (
                <tr key={s.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 font-medium">{s.name}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{s.phone1}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{s.phone2 ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{s.email ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{s.address ?? '—'}</td>
                  <td className="px-4 py-2 text-center">{s.productCount}</td>
                  <td className="px-4 py-2">
                    {s.isDeleted ? (
                      <span className="text-slate-500 dark:text-slate-400">{t.common.archived}</span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t.common.active}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {s.isDeleted ? (
                      <button onClick={() => handleRestore(s)} className="text-[var(--accent)] font-medium cursor-pointer">
                        {t.common.restore}
                      </button>
                    ) : (
                      <>
                        <button onClick={() => openEdit(s)} className="text-[var(--accent)] font-medium mr-3 cursor-pointer">
                          {t.common.edit}
                        </button>
                        <button
                          onClick={() => handleDelete(s)}
                          className={s.productCount === 0 ? 'text-red-600 dark:text-red-400 font-medium cursor-pointer' : 'text-slate-600 dark:text-slate-300 font-medium cursor-pointer'}
                        >
                          {s.productCount === 0 ? t.common.delete : t.common.archive}
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

      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-slate-600 dark:text-slate-300">
          <span>
            {fmt(t.suppliers.range, {
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, visible.length),
              total: visible.length,
            })}
          </span>
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="px-3 py-1 border border-[var(--border)] rounded-lg disabled:opacity-40 cursor-pointer">{t.common.previous}</button>
            <span>{fmt(t.common.page, { page, pages: pageCount })}</span>
            <button disabled={page === pageCount} onClick={() => setPage(page + 1)} className="px-3 py-1 border border-[var(--border)] rounded-lg disabled:opacity-40 cursor-pointer">{t.common.next}</button>
          </div>
        </div>
      )}

      {editing && (
        <Modal title={editing === 'new' ? t.suppliers.add : t.suppliers.editTitle} onClose={() => setEditing(null)}>
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
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.suppliers.phone1}</label>
                <input
                  required
                  value={form.phone1}
                  onChange={(e) => setForm({ ...form, phone1: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.suppliers.phone2}</label>
                <input
                  value={form.phone2}
                  onChange={(e) => setForm({ ...form, phone2: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.suppliers.email}</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.suppliers.address}</label>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="text-sm px-3 h-9 inline-flex items-center justify-center border border-transparent cursor-pointer">
                {t.common.cancel}
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 h-9 inline-flex items-center justify-center border border-transparent cursor-pointer">
                {t.common.save}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
