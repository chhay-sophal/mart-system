import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useDataTable } from '../hooks/useDataTable';
import Modal from '../components/Modal.jsx';
import DataTable from '../components/DataTable.jsx';
import FilterButton from '../components/FilterButton.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt } from '../i18n/translate';

const ROLES = ['CASHIER', 'INVENTORY', 'ADMIN'];
// Staff PINs are exactly 4 digits (the POS lock screen has four places).
const onlyDigits = (value) => value.replace(/[^0-9]/g, '').slice(0, 4);
// Mirrors the backend's usernameSchema; usernames are case-insensitive and stored lowercase.
const USERNAME_PATTERN = '[a-z0-9._@\\-]{3,50}';
const toUsername = (value) => value.toLowerCase().replace(/\s/g, '');

const CREATE_FORM = { username: '', email: '', name: '', password: '', role: 'CASHIER', pin: '' };

export default function StaffPage() {
  const { storeId } = useOutletContext();
  const { t } = useLocale();
  const roleLabel = (role) => t.staff.roles[role] ?? role;
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
  const staff = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const loading = listQuery.isPending;
  const muted = 'text-slate-500 dark:text-slate-400';
  const table = useDataTable({
    rows: staff,
    initialSort: { col: 'name', dir: 'asc' },
    columns: [
      { key: 'name', label: t.common.name, sortValue: (r) => r.name, filter: { type: 'text', placeholder: t.staff.filterName } },
      {
        key: 'username', label: t.staff.username, cellClassName: muted, render: (r) => r.username ?? '—',
        sortValue: (r) => r.username, filter: { type: 'text', placeholder: t.staff.contains },
      },
      {
        key: 'email', label: t.staff.email, cellClassName: muted, render: (r) => r.email ?? '—',
        sortValue: (r) => r.email, filter: { type: 'text', placeholder: t.staff.contains },
      },
      {
        key: 'role', label: t.staff.role, cellClassName: muted, render: (r) => roleLabel(r.role), sortValue: (r) => r.role,
        filter: { type: 'select', options: ROLES.map((r) => ({ value: r, label: roleLabel(r) })) },
      },
      {
        key: 'pin', label: t.staff.pin, cellClassName: muted, render: (r) => (r.hasPinSet ? t.staff.pinSet : t.staff.pinNotSet),
        sortValue: (r) => r.hasPinSet,
        filter: {
          type: 'select', value: (r) => (r.hasPinSet ? 'set' : 'unset'),
          options: [{ value: 'set', label: t.staff.pinSet }, { value: 'unset', label: t.staff.pinNotSet }],
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
            <button onClick={() => openEdit(r)} className="text-[var(--accent)] font-medium mr-3 cursor-pointer">
              {t.common.edit}
            </button>
            <button onClick={() => handleToggleActive(r)} className="text-red-600 dark:text-red-400 font-medium cursor-pointer">
              {r.isActive ? t.staff.deactivate : t.staff.reactivate}
            </button>
          </>
        ),
      },
    ],
  });
  // After a save: refresh the cached list.
  const load = () => queryClient.invalidateQueries({ queryKey: queryKeys.staff(storeId) });

  async function handleCreate(e) {
    e.preventDefault();
    const isCashier = createForm.role === 'CASHIER';
    try {
      await apiClient.post(`/api/stores/${storeId}/staff`, {
        ...createForm,
        // A cashier only ever logs in with a PIN at the till, never a
        // username/password in IMS -- the backend generates a placeholder.
        username: isCashier ? undefined : createForm.username,
        email: isCashier || !createForm.email ? undefined : createForm.email,
        password: isCashier ? undefined : createForm.password,
        pin: createForm.pin || undefined,
      });
      setShowCreate(false);
      setCreateForm(CREATE_FORM);
      await load();
    } catch (err) {
      setError(err?.body?.error ?? t.staff.createFailed);
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
      setError(t.staff.statusFailed);
    }
  }

  function openEdit(row) {
    setEditForm({ name: row.name, username: row.username ?? '', email: row.email ?? '', role: row.role, password: '', pin: '' });
    setShowEditPassword(false);
    setEditing(row);
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    try {
      await apiClient.patch(`/api/stores/${storeId}/staff/${editing.userId}`, {
        name: editForm.name,
        role: editForm.role,
        // A cashier may have no username/email on file yet; leave them alone
        // unless the admin actually typed one (e.g. ahead of a promotion).
        ...(editForm.username ? { username: editForm.username } : {}),
        ...(editForm.email ? { email: editForm.email } : {}),
        ...(editForm.password ? { password: editForm.password } : {}),
        ...(editForm.pin ? { pin: editForm.pin } : {}),
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err?.body?.error ?? t.staff.updateFailed);
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
      setError(err?.body?.error ?? t.staff.resetPinFailed);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">{t.staff.title}</h1>
        <div className="flex items-center gap-3">
          <FilterButton table={table} />
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {table.visible.length === staff.length
              ? fmt(t.staff.count, { count: staff.length })
              : fmt(t.staff.countFiltered, { shown: table.visible.length, total: staff.length })}
          </span>
          {table.filterCount > 0 && (
            <button onClick={table.clearFilters} className="text-sm text-[var(--accent)] font-medium cursor-pointer">
              {fmt(t.staff.clearFilters, { count: table.filterCount })}
            </button>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer"
          >
            {t.staff.addStaff}
          </button>
        </div>
      </div>

      {(error || listQuery.isError) && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error || t.staff.loadFailed}</p>}

      <DataTable
        table={table}
        rowKey={(r) => r.userId}
        loading={loading}
        emptyText={t.staff.empty}
        noMatchText={t.staff.noMatch}
      />

      {showCreate && (
        <Modal title={t.staff.addStaff} onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.staff.role}</label>
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value, pin: e.target.value === 'INVENTORY' ? '' : createForm.pin })}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm h-9"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.common.name}</label>
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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.staff.username}</label>
                  <input
                    required
                    autoCapitalize="none"
                    spellCheck={false}
                    pattern={USERNAME_PATTERN}
                    title={t.staff.usernameTitle}
                    value={createForm.username}
                    onChange={(e) => setCreateForm({ ...createForm, username: toUsername(e.target.value) })}
                    className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.staff.emailOptional}</label>
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                    className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.staff.initialPassword}</label>
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
                      {showPassword ? t.common.hide : t.common.show}
                    </button>
                  </div>
                </div>
              </>
            )}
            {createForm.role !== 'INVENTORY' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  {createForm.role === 'CASHIER' ? t.staff.pinRequired : t.staff.pinOptional}
                </label>
                <input
                  required={createForm.role === 'CASHIER'}
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  title={t.staff.pinTitle}
                  maxLength={4}
                  value={createForm.pin}
                  onChange={(e) => setCreateForm({ ...createForm, pin: onlyDigits(e.target.value) })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="text-sm px-3 py-1.5 cursor-pointer">
                {t.common.cancel}
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer">
                {t.common.create}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pinTarget && (
        <Modal title={fmt(t.staff.resetPinTitle, { name: pinTarget.name })} onClose={() => setPinTarget(null)}>
          <form onSubmit={handleResetPin} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.staff.newPin4}</label>
              <input
                required
                inputMode="numeric"
                pattern="[0-9]{4}"
                title={t.staff.pinTitle}
                maxLength={4}
                value={pinValue}
                onChange={(e) => setPinValue(onlyDigits(e.target.value))}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPinTarget(null)} className="text-sm px-3 py-1.5 cursor-pointer">
                {t.common.cancel}
              </button>
              <button type="submit" className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 cursor-pointer">
                {t.staff.savePin}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title={fmt(t.staff.editTitle, { name: editing.name })} onClose={() => setEditing(null)}>
          <form onSubmit={handleEditSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.staff.role}</label>
              <select
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value, pin: e.target.value === 'INVENTORY' ? '' : editForm.pin })}
                className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.common.name}</label>
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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.staff.username}</label>
                  <input
                    required
                    autoCapitalize="none"
                    spellCheck={false}
                    pattern={USERNAME_PATTERN}
                    title={t.staff.usernameTitle}
                    value={editForm.username}
                    onChange={(e) => setEditForm({ ...editForm, username: toUsername(e.target.value) })}
                    className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.staff.emailOptional}</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    {t.staff.newPassword} <span className="text-slate-400 dark:text-slate-500">{t.staff.keepCurrent}</span>
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
                      {showEditPassword ? t.common.hide : t.common.show}
                    </button>
                  </div>
                </div>
              </>
            )}
            
            {editForm.role !== 'INVENTORY' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  {t.staff.newPin} <span className="text-slate-400 dark:text-slate-500">{t.staff.newPinHint}</span>
                </label>
                <input
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  title={t.staff.pinTitle}
                  maxLength={4}
                  value={editForm.pin}
                  onChange={(e) => setEditForm({ ...editForm, pin: onlyDigits(e.target.value) })}
                  className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
            )}
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
