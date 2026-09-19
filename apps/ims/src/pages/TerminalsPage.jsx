import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import Modal from '../components/Modal.jsx';

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

export default function TerminalsPage() {
  const { storeId } = useOutletContext();
  const [terminals, setTerminals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPair, setShowPair] = useState(false);
  const [pairName, setPairName] = useState('');
  const [revealedSecret, setRevealedSecret] = useState(null); // { id, name, deviceSecret }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTerminals(await apiClient.get(`/api/stores/${storeId}/terminals`));
    } catch {
      setError('Failed to load terminals.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

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
    if (!window.confirm(`Rotate the device secret for "${terminal.name}"? The old secret stops working immediately.`)) {
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
        <button
          onClick={() => setShowPair(true)}
          className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5"
        >
          Pair new terminal
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Paired</th>
              <th className="px-4 py-2">Last seen</th>
              <th className="px-4 py-2">Sync</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-slate-400" colSpan={6}>
                  Loading…
                </td>
              </tr>
            ) : terminals.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-400" colSpan={6}>
                  No terminals paired yet.
                </td>
              </tr>
            ) : (
              terminals.map((t) => (
                <tr key={t.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2">{t.name}</td>
                  <td className="px-4 py-2 text-slate-500">{formatDate(t.pairedAt)}</td>
                  <td className="px-4 py-2 text-slate-500">{formatDate(t.lastSeenAt)}</td>
                  <td className="px-4 py-2">
                    {!t.isActive ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <span className={isOnline(t) ? 'text-emerald-600' : 'text-amber-600'}>
                        {isOnline(t) ? 'Online' : 'Offline'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={t.isActive ? 'text-emerald-600' : 'text-slate-400'}>
                      {t.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right space-x-3">
                    <button onClick={() => handleRotate(t)} className="text-[var(--accent)] font-medium">
                      Rotate secret
                    </button>
                    <button onClick={() => handleToggleActive(t)} className="text-red-600 font-medium">
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
              <label className="block text-xs font-medium text-slate-600 mb-1">Terminal name</label>
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
              <button type="button" onClick={() => setShowPair(false)} className="text-sm px-3 py-1.5">
                Cancel
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5">
                Pair
              </button>
            </div>
          </form>
        </Modal>
      )}

      {revealedSecret && (
        <Modal title={`Device secret for "${revealedSecret.name}"`} onClose={() => setRevealedSecret(null)}>
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            Save these now — the device secret will not be shown again. Enter both in the POS terminal's setup screen.
          </p>
          <label className="block text-xs font-medium text-slate-600 mb-1">Terminal ID</label>
          <code className="block break-all bg-slate-100 rounded-lg px-3 py-2 text-sm mb-3">
            {revealedSecret.id}
          </code>
          <label className="block text-xs font-medium text-slate-600 mb-1">Device Secret</label>
          <code className="block break-all bg-slate-100 rounded-lg px-3 py-2 text-sm mb-4">
            {revealedSecret.deviceSecret}
          </code>
          <div className="flex justify-end">
            <button
              onClick={() => setRevealedSecret(null)}
              className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5"
            >
              I've saved it
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
