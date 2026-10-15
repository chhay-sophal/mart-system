import { useAuth } from '../auth/AuthContext.jsx';
import { useDataTable } from '../hooks/useDataTable';
import DataTable from '../components/DataTable.jsx';
import FilterButton from '../components/FilterButton.jsx';
import FilterChips from '../components/FilterChips.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt, plural } from '../i18n/translate';

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

// Read-only: every store the signed-in user has a role at (or every store,
// for a super admin) -- already loaded once at the app level by AuthContext
// (the same list the header's store switcher uses), so this just renders it,
// filtered and sorted in the browser.
export default function StoresPage() {
  const { stores } = useAuth();
  const { t } = useLocale();
  const roleLabel = (value) => (value === 'none' ? t.stores.noRole : (t.stores.roles[value] ?? value));
  const muted = 'text-slate-500 dark:text-slate-400';
  const contains = { type: 'text', placeholder: t.stores.contains };
  const table = useDataTable({
    rows: stores,
    initialSort: { col: 'name', dir: 'asc' },
    columns: [
      { key: 'name', label: t.common.name, cellClassName: 'font-medium', sortValue: (s) => s.name, filter: { type: 'text', placeholder: t.stores.filterName } },
      { key: 'code', label: t.stores.code, cellClassName: muted, sortValue: (s) => s.code ?? '', filter: contains },
      { key: 'address', label: t.stores.address, cellClassName: muted, render: (s) => s.address ?? '—', sortValue: (s) => s.address ?? '', filter: contains },
      { key: 'phone', label: t.stores.phone, cellClassName: muted, render: (s) => s.phone ?? '—', sortValue: (s) => s.phone ?? '', filter: contains },
      { key: 'timezone', label: t.stores.timezone, cellClassName: muted, sortValue: (s) => s.timezone ?? '', filter: contains },
      {
        key: 'role', label: t.stores.yourRole, cellClassName: muted, render: (s) => (s.role ? roleLabel(s.role) : '—'),
        sortValue: (s) => s.role ?? '',
        filter: {
          type: 'select',
          options: ['ADMIN', 'INVENTORY', 'CASHIER', 'none'].map((value) => ({ value, label: roleLabel(value) })),
          match: (s, v) => (v === 'none' ? !s.role : s.role === v),
        },
      },
      {
        key: 'status', label: t.common.status, sortValue: (s) => Number(s.isActive),
        render: (s) =>
          s.isActive ? (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t.common.active}</span>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">{t.common.inactive}</span>
          ),
        filter: {
          type: 'select', value: (s) => (s.isActive ? 'active' : 'inactive'),
          options: [{ value: 'active', label: t.common.active }, { value: 'inactive', label: t.common.inactive }],
        },
      },
      {
        key: 'createdAt', label: t.stores.created, cellClassName: `${muted} whitespace-nowrap`, render: (s) => formatDate(s.createdAt),
        sortValue: (s) => new Date(s.createdAt).getTime(), filter: { type: 'dateRange', value: (s) => s.createdAt },
      },
    ],
  });
  const visible = table.visible;
  const filterCount = table.filterCount;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">{t.stores.title}</h1>
        <div className="flex items-center gap-3">
          <FilterButton table={table} />
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {visible.length === stores.length
              ? fmt(plural(stores.length, t.stores.countOne, t.stores.countMany), { count: stores.length })
              : fmt(t.stores.countFiltered, { visible: visible.length, total: stores.length })}
          </span>
          {filterCount > 0 && (
            <button onClick={table.clearFilters} className="text-sm text-[var(--accent)] font-medium cursor-pointer">
              {fmt(t.stores.clearFilters, { count: filterCount })}
            </button>
          )}
        </div>
      </div>

      <FilterChips table={table} />
      <DataTable
        table={table}
        rowKey={(s) => s.id}
        emptyText={t.stores.noAccess}
        noMatchText={t.stores.noMatch}
      />
    </div>
  );
}
