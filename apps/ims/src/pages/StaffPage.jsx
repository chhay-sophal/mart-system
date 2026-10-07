import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import Modal from '../components/Modal.jsx';

const ROLES = ['CASHIER', 'INVENTORY', 'ADMIN'];
// Staff PINs are exactly 4 digits (the POS lock screen has four places).
const onlyDigits = (value) => value.replace(/[^0-9]/g, '').slice(0, 4);

const CREATE_FORM = { email: '', name: '', password: '', role: 'CASHIER', pin: '' };

export default function StaffPage() {
  const { storeId } = useOutletContext();
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(CREATE_FORM);
  const [pinTarget, setPinTarget] = useState(null); // staff row being reset
  const [pinValue, setPinValue] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [editing, setEditing] = useState(null); // staff row being edited
  const [editForm, setEditForm] = useState(null);
  const [showEditPassword, setShowEditPassword] = useState(false);

  // Cached (lib/queryClient.js): re-opening the tab shows the last list at
  // once and refreshes it in the background when stale.
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: queryKeys.staff(storeId),
    queryFn: () => apiClient.get(`/api/stores/${storeId}/staff`),
    enabled: Boolean(storeId),
  });
  const staff = listQuery.data ?? [];
  const loading = listQuery.isPending;
  // After a save: refresh the cached list.
  const load = () => queryClient.invalidateQueries({ queryKey: queryKeys.staff(storeId) });

  async function handleCreate(e) {
    e.preventDefault();
    const isCashier = createForm.role === 'CASHIER';
    try {
      await apiClient.post(`/api/stores/${storeId}/staff`, {
        ...createForm,
        // A cashier only ever logs in with a PIN at the till, never an
        // email/password in IMS -- the backend generates a placeholder.
        email: isCashier ? undefined : createForm.email,
        password: isCashier ? undefined : createForm.password,
        pin: createForm.pin || undefined,
      });
      setShowCreate(false);
      setCreateForm(CREATE_FORM);
      await load();
    } catch (err) {
      setError(err?.body?.error ?? 'Failed to create staff member.');
    }
  }

  // async function handleRoleChange(row, role) {
  //   try {
  //     await apiClient.patch(`/api/stores/${storeId}/staff/${row.userId}`, { role });
  //     await load();
  //   } catch {
  //     setError('Failed to update role.');
  //   }
  // }

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

  function openEdit(row) {
    setEditForm({ name: row.name, email: row.email ?? '', role: row.role, password: '', pin: '' });
    setShowEditPassword(false);
    setEditing(row);
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    try {
      await apiClient.patch(`/api/stores/${storeId}/staff/${editing.userId}`, {
        name: editForm.name,
        role: editForm.role,
        // A cashier may have no email on file yet; leave it alone unless the
        // admin actually typed one (e.g. to set one up ahead of a promotion).
        ...(editForm.email ? { email: editForm.email } : {}),
        ...(editForm.password ? { password: editForm.password } : {}),
        ...(editForm.pin ? { pin: editForm.pin } : {}),
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err?.body?.error ?? 'Failed to update staff member.');
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
          className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer"
        >
          Add staff
        </button>
      </div>

      {(error || listQuery.isError) && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || 'Failed to load staff.'}</p>}

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
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
                <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={6}>
                  Loading…
                </td>
              </tr>
            ) : staff.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={6}>
                  No staff yet.
                </td>
              </tr>
            ) : (
              staff.map((row) => (
                <tr key={row.userId} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{row.email ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{row.role}</td>
                  {/* <td className="px-4 py-2">
                    <select
                      value={row.role}
                      onChange={(e) => handleRoleChange(row, e.target.value)}
                      className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td> */}
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{row.hasPinSet ? 'Set' : 'Not set'}</td>
                  <td className="px-4 py-2">
                    <span className={row.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}>
                      {row.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right space-x-3">
                    <button onClick={() => openEdit(row)} className="text-[var(--accent)] font-medium mr-3 cursor-pointer">
                      Edit
                    </button>
                    {/* <button
                      onClick={() => {
                        setPinTarget(row);
                        setPinValue('');
                      }}
                      className="text-[var(--accent)] font-medium cursor-pointer"
                    >
                      Reset PIN
                    </button> */}
                    <button onClick={() => handleToggleActive(row)} className="text-red-600 dark:text-red-400 font-medium cursor-pointer">
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
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Role</label>
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value, pin: e.target.value === 'INVENTORY' ? '' : createForm.pin })}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm h-9"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Name</label>
              <input
                required
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            {createForm.role !== 'CASHIER' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Email</label>
                  <input
                    required
                    type="email"
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                    className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Initial password</label>
                  <div className="relative">
                    <input
                      required
                      minLength={8}
                      type={showPassword ? 'text' : 'password'}
                      value={createForm.password}
                      onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                      className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 pr-14 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </>
            )}
            {createForm.role !== 'INVENTORY' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  PIN {createForm.role === 'CASHIER' ? '(4 digits)' : '(optional, 4 digits)'}
                </label>
                <input
                  required={createForm.role === 'CASHIER'}
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  title="Exactly 4 digits"
                  maxLength={4}
                  value={createForm.pin}
                  onChange={(e) => setCreateForm({ ...createForm, pin: onlyDigits(e.target.value) })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="text-sm px-3 py-1.5 cursor-pointer">
                Cancel
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer">
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
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">New PIN (4 digits)</label>
              <input
                required
                inputMode="numeric"
                pattern="[0-9]{4}"
                title="Exactly 4 digits"
                maxLength={4}
                value={pinValue}
                onChange={(e) => setPinValue(onlyDigits(e.target.value))}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPinTarget(null)} className="text-sm px-3 py-1.5 cursor-pointer">
                Cancel
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer">
                Save PIN
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <form onSubmit={handleEditSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Role</label>
              <select
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value, pin: e.target.value === 'INVENTORY' ? '' : editForm.pin })}
                className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Name</label>
              <input
                required
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
              />
            </div>
            {editForm.role !== 'CASHIER' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Email</label>
                  <input
                    required
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    New password <span className="text-slate-400 dark:text-slate-500">(leave blank to keep the current one)</span>
                  </label>
                  <div className="relative">
                    <input
                      minLength={8}
                      type={showEditPassword ? 'text' : 'password'}
                      value={editForm.password}
                      onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                      className="w-full border border-[var(--border)] rounded-lg px-3 h-9 pr-14 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    >
                      {showEditPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </>
            )}
            
            {editForm.role !== 'INVENTORY' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  New PIN <span className="text-slate-400 dark:text-slate-500">(optional, leave blank to keep the current one)</span>
                </label>
                <input
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  title="Exactly 4 digits"
                  maxLength={4}
                  value={editForm.pin}
                  onChange={(e) => setEditForm({ ...editForm, pin: onlyDigits(e.target.value) })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="text-sm px-3 h-9 inline-flex items-center justify-center border border-transparent cursor-pointer">
                Cancel
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 h-9 inline-flex items-center justify-center border border-transparent cursor-pointer">
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
