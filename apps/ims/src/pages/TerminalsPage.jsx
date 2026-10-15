import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useDataTable } from '../hooks/useDataTable';
import Modal from '../components/Modal.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import DataTable from '../components/DataTable.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt, plural } from '../i18n/translate';

function formatDate(value, never) {
  if (!value) return never;
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

// Never paired/seen sorts as the epoch, i.e. first when ascending.
const byDate = (key) => (a, b) => new Date(a[key] ?? 0) - new Date(b[key] ?? 0);

export default function TerminalsPage() {
  const { storeId } = useOutletContext();
  const confirm = useConfirm();
  const { t } = useLocale();
  const [error, setError] = useState('');
  const [showPair, setShowPair] = useState(false);
  const [pairName, setPairName] = useState('');
  const [revealedSecret, setRevealedSecret] = useState(null); // { id, name, deviceSecret }

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
  const muted = 'text-slate-500 dark:text-slate-400';
  const table = useDataTable({
    rows: terminals,
    initialSort: { col: 'name', dir: 'asc' },
    columns: [
      { key: 'name', label: t.common.name, sortValue: (r) => r.name, filter: { type: 'text', placeholder: t.terminals.filterName } },
      {
        key: 'pairedAt', label: t.terminals.paired, cellClassName: muted, render: (r) => formatDate(r.pairedAt, t.terminals.never),
        compare: byDate('pairedAt'), filter: { type: 'dateRange', value: (r) => r.pairedAt },
      },
      {
        key: 'lastSeenAt', label: t.terminals.lastSeen, cellClassName: muted, render: (r) => formatDate(r.lastSeenAt, t.terminals.never),
        compare: byDate('lastSeenAt'), filter: { type: 'dateRange', value: (r) => r.lastSeenAt },
      },
      {
        key: 'sync', label: t.terminals.sync, sortValue: syncState,
        render: (r) =>
          !r.isActive ? (
            <span className="text-slate-300 dark:text-slate-600">—</span>
          ) : (
            <span className={isOnline(r) ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
              {isOnline(r) ? t.terminals.online : t.terminals.offline}
            </span>
          ),
        filter: {
          type: 'select', value: syncState,
          options: [
            { value: 'online', label: t.terminals.online },
            { value: 'offline', label: t.terminals.offline },
            { value: 'inactive', label: t.terminals.syncInactive },
          ],
        },
      },
      {
        key: 'status', label: t.common.status, sortValue: (r) => r.isActive,
        render: (r) => (
          <span className={r.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}>
            {r.isActive ? t.common.active : t.common.inactive}
          </span>
        ),
        filter: {
          type: 'select', value: (r) => (r.isActive ? 'active' : 'inactive'),
          options: [{ value: 'active', label: t.common.active }, { value: 'inactive', label: t.common.inactive }],
        },
      },
      {
        key: 'actions', label: '', cellClassName: 'text-right space-x-3',
        render: (r) => (
          <>
            <button onClick={() => handleRotate(r)} className="text-[var(--accent)] font-medium cursor-pointer">
              {t.terminals.rotateSecret}
            </button>
            <button onClick={() => handleToggleActive(r)} className="text-red-600 dark:text-red-400 font-medium cursor-pointer">
              {r.isActive ? t.terminals.deactivate : t.terminals.reactivate}
            </button>
          </>
        ),
      },
    ],
  });
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
      setError(t.terminals.pairFailed);
    }
  }

  async function handleRotate(terminal) {
    if (!(await confirm(fmt(t.terminals.rotateConfirm, { name: terminal.name }), { confirmLabel: t.terminals.rotate, danger: true }))) {
      return;
    }
    try {
      const res = await apiClient.post(`/api/stores/${storeId}/terminals/${terminal.id}/rotate-secret`);
      setRevealedSecret({ id: res.id, name: res.name, deviceSecret: res.deviceSecret });
      await load();
    } catch {
      setError(t.terminals.rotateFailed);
    }
  }

  async function handleToggleActive(terminal) {
    try {
      await apiClient.patch(`/api/stores/${storeId}/terminals/${terminal.id}`, { isActive: !terminal.isActive });
      await load();
    } catch {
      setError(t.terminals.updateFailed);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">{t.terminals.title}</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {table.visible.length === terminals.length
              ? fmt(plural(terminals.length, t.terminals.countOne, t.terminals.countMany), { count: terminals.length })
              : fmt(t.terminals.countFiltered, { shown: table.visible.length, total: terminals.length })}
          </span>
          {table.filterCount > 0 && (
            <button onClick={table.clearFilters} className="text-sm text-[var(--accent)] font-medium cursor-pointer">
              {fmt(t.terminals.clearFilters, { count: table.filterCount })}
            </button>
          )}
          <button
            onClick={() => setShowPair(true)}
            className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer"
          >
            {t.terminals.pairNew}
          </button>
        </div>
      </div>

      {(error || listQuery.isError) && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.terminals.loadFailed}</p>}

      <DataTable
        table={table}
        rowKey={(r) => r.id}
        loading={loading}
        emptyText={t.terminals.empty}
        noMatchText={t.terminals.noMatch}
      />

      {showPair && (
        <Modal title={t.terminals.pairNew} onClose={() => setShowPair(false)}>
          <form onSubmit={handlePair} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.terminals.terminalName}</label>
              <input
                required
                autoFocus
                placeholder={t.terminals.namePlaceholder}
                value={pairName}
                onChange={(e) => setPairName(e.target.value)}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowPair(false)} className="text-sm px-3 py-1.5 cursor-pointer">
                {t.common.cancel}
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer">
                {t.terminals.pair}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {revealedSecret && (
        <Modal title={fmt(t.terminals.secretTitle, { name: revealedSecret.name })} onClose={() => setRevealedSecret(null)}>
          <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 mb-3">
            {t.terminals.secretWarning}
          </p>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.terminals.terminalId}</label>
          <code className="block break-all bg-slate-100 dark:bg-slate-700 rounded-lg px-3 py-2 text-sm mb-3">
            {revealedSecret.id}
          </code>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.terminals.deviceSecret}</label>
          <code className="block break-all bg-slate-100 dark:bg-slate-700 rounded-lg px-3 py-2 text-sm mb-4">
            {revealedSecret.deviceSecret}
          </code>
          <div className="flex justify-end">
            <button
              onClick={() => setRevealedSecret(null)}
              className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer"
            >
              {t.terminals.savedIt}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
