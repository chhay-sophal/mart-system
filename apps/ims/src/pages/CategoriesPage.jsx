import { useMemo, useState } from 'react';
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

export default function CategoriesPage() {
  const { storeId } = useOutletContext();
  const confirm = useConfirm();
  const { t } = useLocale();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | category object
  const [name, setName] = useState('');
  // Same pattern as SuppliersPage: anything but the default "active" status
  // filter needs archived rows from the backend, and the filter lives in
  // useDataTable (which needs this query's rows), so it's mirrored here.
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const queryClient = useQueryClient();
  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories(storeId, includeDeleted),
    queryFn: () => apiClient.get(`/api/stores/${storeId}/categories${includeDeleted ? '?includeDeleted=true' : ''}`),
    enabled: Boolean(storeId),
  });
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const search = useSearch(categories, [(c) => c.name]);

  const table = useDataTable({
    rows: search.results,
    initialSort: { col: 'name', dir: 'asc' },
    columns: [
      { key: 'name', label: t.common.name, cellClassName: 'font-medium', sortValue: (c) => c.name, filter: { type: 'text', placeholder: t.categories.filterName } },
      {
        key: 'products', label: t.categories.products, cellClassName: 'text-center', sortValue: (c) => c.productCount,
        filter: { type: 'numberRange', minPlaceholder: t.categories.min, maxPlaceholder: t.categories.max },
      },
      {
        key: 'status', label: t.common.status, sortValue: (c) => Number(c.isDeleted),
        render: (c) =>
          c.isDeleted ? (
            <span className="text-slate-500 dark:text-slate-400">{t.common.archived}</span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t.common.active}</span>
          ),
        filter: {
          type: 'select', defaultValue: ['active'],
          options: ['active', 'archived'].map((value) => ({ value, label: t.common[value] })),
          match: (c, v) => (v === 'archived' ? c.isDeleted : !c.isDeleted),
        },
      },
      {
        key: 'actions', label: '', cellClassName: 'text-right whitespace-nowrap',
        render: (c) =>
          c.isDeleted ? (
            <button onClick={() => handleRestore(c)} className="text-[var(--accent)] font-medium cursor-pointer">
              {t.common.restore}
            </button>
          ) : (
            <>
              <button onClick={() => openEdit(c)} className="text-[var(--accent)] font-medium mr-3 cursor-pointer">
                {t.common.edit}
              </button>
              <button
                onClick={() => handleDelete(c)}
                className={c.productCount === 0 ? 'text-red-600 dark:text-red-400 font-medium cursor-pointer' : 'text-slate-600 dark:text-slate-300 font-medium cursor-pointer'}
              >
                {c.productCount === 0 ? t.common.delete : t.common.archive}
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

  // Prefix match covers both the plain and show-archived lists; products
  // too, since they show their category's name.
  const load = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['categories', storeId] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
    ]);

  function openCreate() {
    setName('');
    setEditing('new');
  }

  function openEdit(category) {
    setName(category.name);
    setEditing(category);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const body = { name: name.trim() };
    try {
      if (editing === 'new') {
        await apiClient.post(`/api/stores/${storeId}/categories`, body);
      } else {
        await apiClient.put(`/api/stores/${storeId}/categories/${editing.id}`, body);
      }
      setEditing(null);
      setError('');
      await load();
    } catch (err) {
      setError(err?.body?.error ?? t.categories.saveFailed);
    }
  }

  async function handleDelete(category) {
    const message = category.productCount === 0
      ? fmt(t.categories.confirmDelete, { name: category.name })
      : fmt(plural(category.productCount, t.categories.confirmArchiveOne, t.categories.confirmArchiveMany), {
          name: category.name,
          count: category.productCount,
        });
    const confirmLabel = category.productCount === 0 ? t.common.delete : t.common.archive;
    if (!(await confirm(message, { confirmLabel, danger: category.productCount === 0 }))) return;
    try {
      await apiClient.delete(`/api/stores/${storeId}/categories/${category.id}`);
      await load();
    } catch {
      setError(t.categories.removeFailed);
    }
  }

  async function handleRestore(category) {
    try {
      await apiClient.post(`/api/stores/${storeId}/categories/${category.id}/restore`);
      await load();
    } catch {
      setError(t.categories.restoreFailed);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">{t.categories.title}</h1>
        <button onClick={openCreate} className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer">
          {t.categories.add}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <SearchInput value={search.query} onChange={search.setQuery} placeholder={t.categories.searchPlaceholder} />
        <FilterButton table={table} />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {visible.length === categories.length
            ? fmt(t.categories.count, { count: categories.length })
            : fmt(t.categories.countFiltered, { visible: visible.length, total: categories.length })}
        </span>
        {(filterCount > 0 || search.isActive) && (
          <button
            onClick={() => {
              table.clearFilters();
              search.clear();
            }}
            className="text-sm text-[var(--accent)] font-medium cursor-pointer"
          >
            {filterCount > 0 ? fmt(t.categories.clearFilters, { count: filterCount }) : t.categories.clearSearch}
          </button>
        )}
      </div>

      {(error || categoriesQuery.isError) && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.categories.loadFailed}</p>
      )}

      <FilterChips table={table} />
      <DataTable
        table={table}
        rowKey={(c) => c.id}
        loading={categoriesQuery.isPending}
        emptyText={categories.length === 0 ? t.categories.noCategories : t.categories.noMatch}
        noMatchText={t.categories.noMatch}
      />

      {editing && (
        <Modal title={editing === 'new' ? t.categories.add : t.categories.editTitle} onClose={() => setEditing(null)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.common.name}</label>
              <input
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
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
