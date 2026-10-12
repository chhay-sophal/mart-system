import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useColumnFilter } from '../hooks/useColumnFilter';
import FilterableHeader, { filterInput } from '../components/FilterableHeader.jsx';

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

const ROLE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'INVENTORY', label: 'Inventory' },
  { value: 'CASHIER', label: 'Cashier' },
  { value: 'none', label: 'No role' },
];

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const EMPTY_FILTERS = {
  name: '',
  code: '',
  address: '',
  phone: '',
  timezone: '',
  role: 'all', // all | ADMIN | INVENTORY | CASHIER | none
  status: 'all', // all | active | inactive
  createdFrom: '', // 'YYYY-MM-DD', local, inclusive
  createdTo: '',   // 'YYYY-MM-DD', local, inclusive
};

// from/to are 'YYYY-MM-DD' (<input type="date"> values, local time, no
// timezone) -- both bounds inclusive of the whole selected day.
function inDateRange(value, fromStr, toStr) {
  if (!fromStr && !toStr) return true;
  const d = new Date(value);
  if (fromStr && d < new Date(`${fromStr}T00:00:00`)) return false;
  if (toStr) {
    const to = new Date(`${toStr}T00:00:00`);
    to.setDate(to.getDate() + 1); // exclusive upper bound -- through the end of the selected day
    if (d >= to) return false;
  }
  return true;
}

const norm = (value) => String(value ?? '').trim().toLowerCase();

function matchesRole(store, mode) {
  if (mode === 'all') return true;
  if (mode === 'none') return !store.role;
  return store.role === mode;
}

function matchesStatus(store, mode) {
  if (mode === 'all') return true;
  return mode === 'active' ? store.isActive : !store.isActive;
}

function filterStores(stores, f) {
  const name = norm(f.name);
  const code = norm(f.code);
  const address = norm(f.address);
  const phone = norm(f.phone);
  const timezone = norm(f.timezone);
  return stores.filter((store) => {
    if (name && !norm(store.name).includes(name)) return false;
    if (code && !norm(store.code).includes(code)) return false;
    if (address && !norm(store.address).includes(address)) return false;
    if (phone && !norm(store.phone).includes(phone)) return false;
    if (timezone && !norm(store.timezone).includes(timezone)) return false;
    if (!matchesRole(store, f.role)) return false;
    if (!matchesStatus(store, f.status)) return false;
    return inDateRange(store.createdAt, f.createdFrom, f.createdTo);
  });
}

const COMPARE = {
  name: (a, b) => a.name.localeCompare(b.name),
  code: (a, b) => (a.code ?? '').localeCompare(b.code ?? ''),
  address: (a, b) => (a.address ?? '').localeCompare(b.address ?? ''),
  phone: (a, b) => (a.phone ?? '').localeCompare(b.phone ?? ''),
  timezone: (a, b) => (a.timezone ?? '').localeCompare(b.timezone ?? ''),
  role: (a, b) => (a.role ?? '').localeCompare(b.role ?? ''),
  status: (a, b) => Number(a.isActive) - Number(b.isActive),
  createdAt: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
};

function sortStores(stores, { col, dir }) {
  const compare = COMPARE[col];
  if (!compare) return stores;
  const sign = dir === 'desc' ? -1 : 1;
  // Ties fall back to name, so the order is stable and predictable.
  return [...stores].sort((a, b) => sign * compare(a, b) || COMPARE.name(a, b));
}

const activeFilterCount = (f) => Object.entries(EMPTY_FILTERS).filter(([key, empty]) => f[key] !== empty).length;

// Read-only: every store the signed-in user has a role at (or every store,
// for a super admin) -- already loaded once at the app level by AuthContext
// (the same list the header's store switcher uses), so this just renders it,
// filtered and sorted in the browser.
export default function StoresPage() {
  const { stores } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ col: 'name', dir: 'asc' });
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const { openFilterCol, toggleFilterCol, filterPanelRef } = useColumnFilter();
  const toggleSort = (col) =>
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  const filterCount = activeFilterCount(filters);

  const visible = useMemo(() => sortStores(filterStores(stores, filters), sort), [stores, filters, sort]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">Stores</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {visible.length === stores.length ? `${stores.length} store${stores.length === 1 ? '' : 's'}` : `${visible.length} of ${stores.length} stores`}
          </span>
          {filterCount > 0 && (
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-sm text-[var(--accent)] font-medium cursor-pointer">
              Clear filters ({filterCount})
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
              <tr>
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
                  col="code" label="Code" sort={sort} onSort={toggleSort}
                  isOpen={openFilterCol === 'code'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                  hasActiveFilter={filters.code !== EMPTY_FILTERS.code}
                >
                  <input
                    value={filters.code}
                    onChange={(e) => setFilter('code', e.target.value)}
                    placeholder="Contains"
                    className={filterInput}
                  />
                </FilterableHeader>
                <FilterableHeader
                  col="address" label="Address" sort={sort} onSort={toggleSort}
                  isOpen={openFilterCol === 'address'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                  hasActiveFilter={filters.address !== EMPTY_FILTERS.address}
                >
                  <input
                    value={filters.address}
                    onChange={(e) => setFilter('address', e.target.value)}
                    placeholder="Contains"
                    className={filterInput}
                  />
                </FilterableHeader>
                <FilterableHeader
                  col="phone" label="Phone" sort={sort} onSort={toggleSort}
                  isOpen={openFilterCol === 'phone'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                  hasActiveFilter={filters.phone !== EMPTY_FILTERS.phone}
                >
                  <input
                    value={filters.phone}
                    onChange={(e) => setFilter('phone', e.target.value)}
                    placeholder="Contains"
                    className={filterInput}
                  />
                </FilterableHeader>
                <FilterableHeader
                  col="timezone" label="Timezone" sort={sort} onSort={toggleSort}
                  isOpen={openFilterCol === 'timezone'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                  hasActiveFilter={filters.timezone !== EMPTY_FILTERS.timezone}
                >
                  <input
                    value={filters.timezone}
                    onChange={(e) => setFilter('timezone', e.target.value)}
                    placeholder="Contains"
                    className={filterInput}
                  />
                </FilterableHeader>
                <FilterableHeader
                  col="role" label="Your role" sort={sort} onSort={toggleSort}
                  isOpen={openFilterCol === 'role'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                  hasActiveFilter={filters.role !== EMPTY_FILTERS.role}
                >
                  <select value={filters.role} onChange={(e) => setFilter('role', e.target.value)} className={filterInput}>
                    {ROLE_FILTERS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </FilterableHeader>
                <FilterableHeader
                  col="status" label="Status" sort={sort} onSort={toggleSort}
                  isOpen={openFilterCol === 'status'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                  hasActiveFilter={filters.status !== EMPTY_FILTERS.status}
                >
                  <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={filterInput}>
                    {STATUS_FILTERS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </FilterableHeader>
                <FilterableHeader
                  col="createdAt" label="Created" sort={sort} onSort={toggleSort}
                  isOpen={openFilterCol === 'createdAt'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                  hasActiveFilter={filters.createdFrom !== EMPTY_FILTERS.createdFrom || filters.createdTo !== EMPTY_FILTERS.createdTo}
                >
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-500 dark:text-slate-400">
                      From
                      <input type="date" value={filters.createdFrom} onChange={(e) => setFilter('createdFrom', e.target.value)} className={`${filterInput} mt-0.5`} />
                    </label>
                    <label className="text-xs text-slate-500 dark:text-slate-400">
                      To
                      <input type="date" value={filters.createdTo} onChange={(e) => setFilter('createdTo', e.target.value)} className={`${filterInput} mt-0.5`} />
                    </label>
                  </div>
                </FilterableHeader>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={8}>
                    {stores.length === 0 ? 'No store access. Contact an administrator.' : 'No stores match the filters.'}
                  </td>
                </tr>
              ) : (
                visible.map((store) => (
                  <tr key={store.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-2 font-medium">{store.name}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{store.code}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{store.address ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{store.phone ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{store.timezone}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{store.role ?? '—'}</td>
                    <td className="px-4 py-2">
                      {store.isActive ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">Active</span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(store.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
