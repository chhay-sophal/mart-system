import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { suppliersQuery as suppliersQueryOptions } from '../lib/queries';
import { useDataTable } from '../hooks/useDataTable';
import Modal from '../components/Modal.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import DataTable from '../components/DataTable.jsx';
import FilterButton from '../components/FilterButton.jsx';
import FilterChips from '../components/FilterChips.jsx';
import Pagination from '../components/Pagination.jsx';
import SearchInput from '../components/SearchInput.jsx';
import { useSearch } from '../hooks/useSearch';
import { usePagination } from '../hooks/usePagination';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt, plural } from '../i18n/translate';
import IconButton from '../components/IconButton.jsx';
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from 'lucide-react';


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
  const [editing, setEditing] = useState(null); // null | 'new' | supplier object
  const [form, setForm] = useState(EMPTY_FORM);

  // The one shared supplier list (archived included; the Status filter
  // below hides those by default), the same cache Products reads.
  const queryClient = useQueryClient();
  const suppliersQuery = useQuery(suppliersQueryOptions(storeId));
  const suppliers = useMemo(() => suppliersQuery.data ?? [], [suppliersQuery.data]);
  const loading = suppliersQuery.isPending;
  // The top search bar: name, phone, or email.
  const search = useSearch(suppliers, [(s) => s.name, (s) => s.phone1, (s) => s.phone2, (s) => s.email], { persistKey: 'suppliers:search' });

  const muted = 'text-slate-500 dark:text-slate-400';
  const contains = { type: 'text', placeholder: t.suppliers.contains };
  const table = useDataTable({
    rows: search.results,
    initialSort: { col: 'name', dir: 'asc' },
    persistKey: 'suppliers:table',
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
            <IconButton icon={ArchiveRestore} label={t.common.restore} tone="accent" onClick={() => handleRestore(s)} />
          ) : (
            <span className="inline-flex gap-1">
              <IconButton icon={Pencil} label={t.common.edit} tone="accent" onClick={() => openEdit(s)} />
              {/* Unused: deleted outright (red); in use: archived. */}
              {s.productCount === 0 ? (
                <IconButton icon={Trash2} label={t.common.delete} tone="danger" onClick={() => handleDelete(s)} />
              ) : (
                <IconButton icon={Archive} label={t.common.archive} onClick={() => handleDelete(s)} />
              )}
            </span>
          ),
      },
    ],
  });
  const visible = table.visible;
  const filterCount = table.filterCount;

  const load = () => queryClient.invalidateQueries({ queryKey: queryKeys.suppliers() });

  const pager = usePagination(visible, PAGE_SIZE, JSON.stringify([search.query, table.filters, table.sort, storeId]), 'suppliers:page');

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
          className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer inline-flex items-center gap-1.5"
        >
          <Plus size={16} aria-hidden="true" />
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
        rows={pager.pageRows}
        rowKey={(s) => s.id}
        loading={loading}
        // The search bar narrows rows before the table sees them, so "no
        // suppliers at all" has to be judged against the unsearched list.
        emptyText={suppliers.length === 0 ? t.suppliers.noSuppliers : t.suppliers.noMatch}
        noMatchText={t.suppliers.noMatch}
      />

      <Pagination pager={pager} />

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
