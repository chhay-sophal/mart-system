import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useColumnFilter } from '../hooks/useColumnFilter';
import Modal from '../components/Modal.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import FilterableHeader, { filterInput } from '../components/FilterableHeader.jsx';

function formatDate(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

// Comfortably clears the backend's 60s lastSeenAt write-throttle (requireTerminal.ts)
// plus normal jitter, while still meaning "recent."
const ONLINE_THRESHOLD_MS = 3 * 60 * 1000;

function isOnline(terminal) {
  return Boolean(terminal.lastSeenAt) && Date.now() - new Date(terminal.lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

// 'inactive' mirrors the "—" shown in the Sync column for a deactivated terminal.
function syncState(terminal) {
  if (!terminal.isActive) return 'inactive';
  return isOnline(terminal) ? 'online' : 'offline';
}

const SYNC_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'inactive', label: '— (inactive)' },
];

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const EMPTY_FILTERS = {
  name: '',
  pairedFrom: '', // 'YYYY-MM-DD', local, inclusive
  pairedTo: '',
  lastSeenFrom: '',
  lastSeenTo: '',
  sync: 'all', // all | online | offline | inactive
  status: 'all', // all | active | inactive
};

const norm = (value) => String(value ?? '').trim().toLowerCase();

// from/to are 'YYYY-MM-DD' (<input type="date"> values, local time, no
// timezone) -- both bounds inclusive of the whole selected day. A null value
// (terminal never paired/seen) never matches a bound.
function inDateRange(value, fromStr, toStr) {
  if (!fromStr && !toStr) return true;
  if (!value) return false;
  const d = new Date(value);
  if (fromStr && d < new Date(`${fromStr}T00:00:00`)) return false;
  if (toStr) {
    const to = new Date(`${toStr}T00:00:00`);
    to.setDate(to.getDate() + 1); // exclusive upper bound -- through the end of the selected day
    if (d >= to) return false;
  }
  return true;
}

function filterTerminals(terminals, f) {
  const name = norm(f.name);
  return terminals.filter((t) => {
    if (name && !norm(t.name).includes(name)) return false;
    if (!inDateRange(t.pairedAt, f.pairedFrom, f.pairedTo)) return false;
    if (!inDateRange(t.lastSeenAt, f.lastSeenFrom, f.lastSeenTo)) return false;
    if (f.sync !== 'all' && syncState(t) !== f.sync) return false;
    if (f.status !== 'all' && (f.status === 'active') !== t.isActive) return false;
    return true;
  });
}

const COMPARE = {
  name: (a, b) => a.name.localeCompare(b.name),
  pairedAt: (a, b) => new Date(a.pairedAt ?? 0) - new Date(b.pairedAt ?? 0),
  lastSeenAt: (a, b) => new Date(a.lastSeenAt ?? 0) - new Date(b.lastSeenAt ?? 0),
  sync: (a, b) => syncState(a).localeCompare(syncState(b)),
  status: (a, b) => Number(a.isActive) - Number(b.isActive),
};

function sortTerminals(terminals, { col, dir }) {
  const compare = COMPARE[col];
  if (!compare) return terminals;
  const sign = dir === 'desc' ? -1 : 1;
  // Ties fall back to name, so the order is stable and predictable.
  return [...terminals].sort((a, b) => sign * compare(a, b) || COMPARE.name(a, b));
}

const activeFilterCount = (f) => Object.entries(EMPTY_FILTERS).filter(([key, empty]) => f[key] !== empty).length;

export default function TerminalsPage() {
  const { storeId } = useOutletContext();
  const confirm = useConfirm();
  const [error, setError] = useState('');
  const [showPair, setShowPair] = useState(false);
  const [pairName, setPairName] = useState('');
  const [revealedSecret, setRevealedSecret] = useState(null); // { id, name, deviceSecret }
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ col: 'name', dir: 'asc' });
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const { openFilterCol, toggleFilterCol, filterPanelRef } = useColumnFilter();
  const toggleSort = (col) =>
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  const filterCount = activeFilterCount(filters);

  // Cached (lib/queryClient.js): re-opening the tab shows the last list at
  // once and refreshes it in the background when stale.
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: queryKeys.terminals(storeId),
    queryFn: () => apiClient.get(`/api/stores/${storeId}/terminals`),
    enabled: Boolean(storeId),
  });
  const terminals = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const loading = listQuery.isPending;
  const visible = useMemo(() => sortTerminals(filterTerminals(terminals, filters), sort), [terminals, filters, sort]);
  // After a save: refresh the cached list.
  const load = () => queryClient.invalidateQueries({ queryKey: queryKeys.terminals(storeId) });

  async function handlePair(e) {
    e.preventDefault();
    try {
      const res = await apiClient.post(`/api/stores/${storeId}/terminals`, { name: pairName });
      setShowPair(false);
      setPairName('');
      setRevealedSecret({ id: res.id, name: res.name, deviceSecret: res.deviceSecret });
      await load();
    } catch {
      setError('Failed to pair terminal.');
    }
  }

  async function handleRotate(terminal) {
    if (!(await confirm(`Rotate the device secret for "${terminal.name}"? The old secret stops working immediately.`, { confirmLabel: 'Rotate', danger: true }))) {
      return;
    }
    try {
      const res = await apiClient.post(`/api/stores/${storeId}/terminals/${terminal.id}/rotate-secret`);
      setRevealedSecret({ id: res.id, name: res.name, deviceSecret: res.deviceSecret });
      await load();
    } catch {
      setError('Failed to rotate secret.');
    }
  }

  async function handleToggleActive(terminal) {
    try {
      await apiClient.patch(`/api/stores/${storeId}/terminals/${terminal.id}`, { isActive: !terminal.isActive });
      await load();
    } catch {
      setError('Failed to update terminal.');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">Terminals</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {visible.length === terminals.length ? `${terminals.length} terminals` : `${visible.length} of ${terminals.length} terminals`}
          </span>
          {filterCount > 0 && (
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-sm text-[var(--accent)] font-medium cursor-pointer">
              Clear filters ({filterCount})
            </button>
          )}
          <button
            onClick={() => setShowPair(true)}
            className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer"
          >
            Pair new terminal
          </button>
        </div>
      </div>

      {(error || listQuery.isError) && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || 'Failed to load terminals.'}</p>}

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
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
                col="pairedAt" label="Paired" sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'pairedAt'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.pairedFrom !== EMPTY_FILTERS.pairedFrom || filters.pairedTo !== EMPTY_FILTERS.pairedTo}
              >
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-500 dark:text-slate-400">
                    From
                    <input type="date" value={filters.pairedFrom} onChange={(e) => setFilter('pairedFrom', e.target.value)} className={`${filterInput} mt-0.5`} />
                  </label>
                  <label className="text-xs text-slate-500 dark:text-slate-400">
                    To
                    <input type="date" value={filters.pairedTo} onChange={(e) => setFilter('pairedTo', e.target.value)} className={`${filterInput} mt-0.5`} />
                  </label>
                </div>
              </FilterableHeader>
              <FilterableHeader
                col="lastSeenAt" label="Last seen" sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'lastSeenAt'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.lastSeenFrom !== EMPTY_FILTERS.lastSeenFrom || filters.lastSeenTo !== EMPTY_FILTERS.lastSeenTo}
              >
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-500 dark:text-slate-400">
                    From
                    <input type="date" value={filters.lastSeenFrom} onChange={(e) => setFilter('lastSeenFrom', e.target.value)} className={`${filterInput} mt-0.5`} />
                  </label>
                  <label className="text-xs text-slate-500 dark:text-slate-400">
                    To
                    <input type="date" value={filters.lastSeenTo} onChange={(e) => setFilter('lastSeenTo', e.target.value)} className={`${filterInput} mt-0.5`} />
                  </label>
                </div>
              </FilterableHeader>
              <FilterableHeader
                col="sync" label="Sync" sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'sync'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.sync !== EMPTY_FILTERS.sync}
              >
                <select value={filters.sync} onChange={(e) => setFilter('sync', e.target.value)} className={filterInput}>
                  {SYNC_FILTERS.map((o) => (
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
                  {terminals.length === 0 ? 'No terminals paired yet.' : 'No terminals match the filters.'}
                </td>
              </tr>
            ) : (
              visible.map((t) => (
                <tr key={t.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2">{t.name}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{formatDate(t.pairedAt)}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{formatDate(t.lastSeenAt)}</td>
                  <td className="px-4 py-2">
                    {!t.isActive ? (
                      <span className="text-slate-300 dark:text-slate-600">—</span>
                    ) : (
                      <span className={isOnline(t) ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                        {isOnline(t) ? 'Online' : 'Offline'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={t.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}>
                      {t.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right space-x-3">
                    <button onClick={() => handleRotate(t)} className="text-[var(--accent)] font-medium cursor-pointer">
                      Rotate secret
                    </button>
                    <button onClick={() => handleToggleActive(t)} className="text-red-600 dark:text-red-400 font-medium cursor-pointer">
                      {t.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showPair && (
        <Modal title="Pair new terminal" onClose={() => setShowPair(false)}>
          <form onSubmit={handlePair} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Terminal name</label>
              <input
                required
                autoFocus
                placeholder="e.g. Register 2"
                value={pairName}
                onChange={(e) => setPairName(e.target.value)}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowPair(false)} className="text-sm px-3 py-1.5 cursor-pointer">
                Cancel
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer">
                Pair
              </button>
            </div>
          </form>
        </Modal>
      )}

      {revealedSecret && (
        <Modal title={`Device secret for "${revealedSecret.name}"`} onClose={() => setRevealedSecret(null)}>
          <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 mb-3">
            Save these now — the device secret will not be shown again. Enter both in the POS terminal's setup screen.
          </p>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Terminal ID</label>
          <code className="block break-all bg-slate-100 dark:bg-slate-700 rounded-lg px-3 py-2 text-sm mb-3">
            {revealedSecret.id}
          </code>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Device Secret</label>
          <code className="block break-all bg-slate-100 dark:bg-slate-700 rounded-lg px-3 py-2 text-sm mb-4">
            {revealedSecret.deviceSecret}
          </code>
          <div className="flex justify-end">
            <button
              onClick={() => setRevealedSecret(null)}
              className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer"
            >
              I've saved it
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
