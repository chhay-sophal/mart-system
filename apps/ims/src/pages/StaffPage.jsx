import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import Modal from '../components/Modal.jsx';

const ROLES = ['CASHIER', 'INVENTORY', 'ADMIN'];
const CREATE_FORM = { email: '', name: '', password: '', role: 'CASHIER', pin: '' };

export default function StaffPage() {
  const { storeId } = useOutletContext();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(CREATE_FORM);
  const [pinTarget, setPinTarget] = useState(null); // staff row being reset
  const [pinValue, setPinValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStaff(await apiClient.get(`/api/stores/${storeId}/staff`));
    } catch {
      setError('Failed to load staff.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await apiClient.post(`/api/stores/${storeId}/staff`, {
        ...createForm,
        pin: createForm.pin || undefined,
      });
      setShowCreate(false);
      setCreateForm(CREATE_FORM);
      await load();
    } catch (err) {
      setError(err?.body?.error ?? 'Failed to create staff member.');
    }
  }

  async function handleRoleChange(row, role) {
    try {
      await apiClient.patch(`/api/stores/${storeId}/staff/${row.userId}`, { role });
      await load();
    } catch {
      setError('Failed to update role.');
    }
  }

  async function handleToggleActive(row) {
    try {
      if (row.isActive) {
        await apiClient.delete(`/api/stores/${storeId}/staff/${row.userId}`);
      } else {
        await apiClient.patch(`/api/stores/${storeId}/staff/${row.userId}`, { isActive: true });
      }
      await load();
    } catch {
      setError('Failed to update status.');
    }
  }

  async function handleResetPin(e) {
    e.preventDefault();
    try {
      await apiClient.post(`/api/stores/${storeId}/staff/${pinTarget.userId}/reset-pin`, { pin: pinValue });
      setPinTarget(null);
      setPinValue('');
      await load();
    } catch (err) {
      setError(err?.body?.error ?? 'Failed to reset PIN — it may already be used by someone else at this store.');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">Staff</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5"
        >
          Add staff
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">PIN</th>
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
            ) : staff.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-400" colSpan={6}>
                  No staff yet.
                </td>
              </tr>
            ) : (
              staff.map((row) => (
                <tr key={row.userId} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2 text-slate-500">{row.email}</td>
                  <td className="px-4 py-2">
                    <select
                      value={row.role}
                      onChange={(e) => handleRoleChange(row, e.target.value)}
                      className="border border-[var(--border)] rounded-lg px-2 py-1 text-sm"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{row.hasPinSet ? 'Set' : 'Not set'}</td>
                  <td className="px-4 py-2">
                    <span className={row.isActive ? 'text-emerald-600' : 'text-slate-400'}>
                      {row.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right space-x-3">
                    <button
                      onClick={() => {
                        setPinTarget(row);
                        setPinValue('');
                      }}
                      className="text-[var(--accent)] font-medium"
                    >
                      Reset PIN
                    </button>
                    <button onClick={() => handleToggleActive(row)} className="text-red-600 font-medium">
                      {row.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="Add staff" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input
                required
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <input
                required
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Initial password</label>
              <input
                required
                minLength={8}
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">PIN (optional)</label>
                <input
                  minLength={4}
                  maxLength={8}
                  value={createForm.pin}
                  onChange={(e) => setCreateForm({ ...createForm, pin: e.target.value })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="text-sm px-3 py-1.5">
                Cancel
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5">
                Create
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pinTarget && (
        <Modal title={`Reset PIN for ${pinTarget.name}`} onClose={() => setPinTarget(null)}>
          <form onSubmit={handleResetPin} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">New PIN</label>
              <input
                required
                minLength={4}
                maxLength={8}
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value)}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPinTarget(null)} className="text-sm px-3 py-1.5">
                Cancel
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5">
                Save PIN
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
