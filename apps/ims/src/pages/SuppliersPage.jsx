import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useDataTable } from '../hooks/useDataTable';
import Modal from '../components/Modal.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import DataTable from '../components/DataTable.jsx';
import FilterButton from '../components/FilterButton.jsx';
import FilterChips from '../components/FilterChips.jsx';
import SearchInput from '../components/SearchInput.jsx';
import { useSearch } from '../hooks/useSearch';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt, plural } from '../i18n/translate';


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
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | supplier object
  const [form, setForm] = useState(EMPTY_FORM);
  // Anything but the default "active" status filter needs archived rows
  // included in what the backend returns at all. The filter itself lives in
  // useDataTable below, which needs this query's rows -- so it's mirrored
  // here, updated during render (not in an effect) to avoid a stale frame.
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const queryClient = useQueryClient();
  const suppliersQuery = useQuery({
    queryKey: queryKeys.suppliers(storeId, includeDeleted),
    queryFn: () => apiClient.get(`/api/stores/${storeId}/suppliers${includeDeleted ? '?includeDeleted=true' : ''}`),
    enabled: Boolean(storeId),
  });
  const suppliers = useMemo(() => suppliersQuery.data ?? [], [suppliersQuery.data]);
  const loading = suppliersQuery.isPending;
  // The top search bar: name, phone, or email.
  const search = useSearch(suppliers, [(s) => s.name, (s) => s.phone1, (s) => s.phone2, (s) => s.email]);

  const muted = 'text-slate-500 dark:text-slate-400';
  const contains = { type: 'text', placeholder: t.suppliers.contains };
  const table = useDataTable({
    rows: search.results,
    initialSort: { col: 'name', dir: 'asc' },
    columns: [
      { key: 'name', label: t.common.name, cellClassName: 'font-medium', sortValue: (s) => s.name, filter: { type: 'text', placeholder: t.suppliers.filterName } },
      { key: 'phone1', label: t.suppliers.phone1, cellClassName: muted, sortValue: (s) => s.phone1, filter: contains },
      { key: 'phone2', label: t.suppliers.phone2, cellClassName: muted, render: (s) => s.phone2 ?? '—', sortValue: (s) => s.phone2 ?? '', filter: contains },
      { key: 'email', label: t.suppliers.email, cellClassName: muted, render: (s) => s.email ?? '—', sortValue: (s) => s.email ?? '', filter: contains },
      { key: 'address', label: t.suppliers.address, cellClassName: muted, render: (s) => s.address ?? '—', sortValue: (s) => s.address ?? '', filter: contains },
      {
        key: 'products', label: t.suppliers.products, cellClassName: 'text-center', sortValue: (s) => s.productCount,
        filter: { type: 'numberRange', minPlaceholder: t.suppliers.min, maxPlaceholder: t.suppliers.max },
      },
      {
        key: 'status', label: t.common.status, sortValue: (s) => Number(s.isDeleted),
        render: (s) =>
          s.isDeleted ? (
            <span className="text-slate-500 dark:text-slate-400">{t.common.archived}</span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t.common.active}</span>
          ),
        filter: {
          type: 'select', defaultValue: ['active'],
          options: ['active', 'archived'].map((value) => ({ value, label: t.common[value] })),
          match: (s, v) => (v === 'archived' ? s.isDeleted : !s.isDeleted),
        },
      },
      {
        key: 'actions', label: '', cellClassName: 'text-right whitespace-nowrap',
        render: (s) =>
          s.isDeleted ? (
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
          ),
      },
    ],
  });
  const wantDeleted = !(table.filters.status.length === 1 && table.filters.status[0] === 'active');
  if (wantDeleted !== includeDeleted) setIncludeDeleted(wantDeleted);
  const visible = table.visible;
  const filterCount = table.filterCount;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [search.query, table.filters, table.sort, storeId]);

  // Prefix match (no includeDeleted in the key here) invalidates both the
  // plain and the show-archived variant, since either one can change a save.
  const load = () => queryClient.invalidateQueries({ queryKey: ['suppliers', storeId] });

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
        <SearchInput value={search.query} onChange={search.setQuery} placeholder={t.suppliers.searchPlaceholder} />
        <FilterButton table={table} />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {visible.length === suppliers.length
            ? fmt(t.suppliers.count, { count: suppliers.length })
            : fmt(t.suppliers.countFiltered, { visible: visible.length, total: suppliers.length })}
        </span>
        {(filterCount > 0 || search.isActive) && (
          <button
            onClick={() => {
              table.clearFilters();
              search.clear();
            }}
            className="text-sm text-[var(--accent)] font-medium cursor-pointer">
            {filterCount > 0 ? fmt(t.suppliers.clearFilters, { count: filterCount }) : t.suppliers.clearSearch}
          </button>
        )}
      </div>

      {(error || suppliersQuery.isError) && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.suppliers.loadFailed}</p>
      )}

      <FilterChips table={table} />
      <DataTable
        table={table}
        rows={pageRows}
        rowKey={(s) => s.id}
        loading={loading}
        // The search bar narrows rows before the table sees them, so "no
        // suppliers at all" has to be judged against the unsearched list.
        emptyText={suppliers.length === 0 ? t.suppliers.noSuppliers : t.suppliers.noMatch}
        noMatchText={t.suppliers.noMatch}
      />

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
