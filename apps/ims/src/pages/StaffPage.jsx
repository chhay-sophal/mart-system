import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useColumnFilter } from '../hooks/useColumnFilter';
import Modal from '../components/Modal.jsx';
import FilterableHeader, { filterInput } from '../components/FilterableHeader.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt } from '../i18n/translate';

const ROLES = ['CASHIER', 'INVENTORY', 'ADMIN'];
// Staff PINs are exactly 4 digits (the POS lock screen has four places).
const onlyDigits = (value) => value.replace(/[^0-9]/g, '').slice(0, 4);

const CREATE_FORM = { email: '', name: '', password: '', role: 'CASHIER', pin: '' };

const PIN_FILTERS = ['all', 'set', 'unset'];

const STATUS_FILTERS = ['all', 'active', 'inactive'];

const EMPTY_FILTERS = {
  name: '',
  email: '',
  role: 'all', // all | CASHIER | INVENTORY | ADMIN
  pin: 'all', // all | set | unset
  status: 'all', // all | active | inactive
};

const norm = (value) => String(value ?? '').trim().toLowerCase();

function matchesPin(row, mode) {
  if (mode === 'all') return true;
  return mode === 'set' ? row.hasPinSet : !row.hasPinSet;
}

function matchesStatus(row, mode) {
  if (mode === 'all') return true;
  return mode === 'active' ? row.isActive : !row.isActive;
}

function filterStaff(staff, f) {
  const name = norm(f.name);
  const email = norm(f.email);
  return staff.filter((row) => {
    if (name && !norm(row.name).includes(name)) return false;
    if (email && !norm(row.email).includes(email)) return false;
    if (f.role !== 'all' && row.role !== f.role) return false;
    if (!matchesPin(row, f.pin)) return false;
    return matchesStatus(row, f.status);
  });
}

const COMPARE = {
  name: (a, b) => a.name.localeCompare(b.name),
  email: (a, b) => (a.email ?? '').localeCompare(b.email ?? ''),
  role: (a, b) => a.role.localeCompare(b.role),
  pin: (a, b) => Number(a.hasPinSet) - Number(b.hasPinSet),
  status: (a, b) => Number(a.isActive) - Number(b.isActive),
};

function sortStaff(staff, { col, dir }) {
  const compare = COMPARE[col];
  if (!compare) return staff;
  const sign = dir === 'desc' ? -1 : 1;
  // Ties fall back to name, so the order is stable and predictable.
  return [...staff].sort((a, b) => sign * compare(a, b) || COMPARE.name(a, b));
}

const activeFilterCount = (f) => Object.entries(EMPTY_FILTERS).filter(([key, empty]) => f[key] !== empty).length;

export default function StaffPage() {
  const { storeId } = useOutletContext();
  const { t } = useLocale();
  const roleLabel = (role) => t.staff.roles[role] ?? role;
  const pinFilterLabel = { all: t.common.all, set: t.staff.pinSet, unset: t.staff.pinNotSet };
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(CREATE_FORM);
  const [pinTarget, setPinTarget] = useState(null); // staff row being reset
  const [pinValue, setPinValue] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [editing, setEditing] = useState(null); // staff row being edited
  const [editForm, setEditForm] = useState(null);
  const [showEditPassword, setShowEditPassword] = useState(false);
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
    queryKey: queryKeys.staff(storeId),
    queryFn: () => apiClient.get(`/api/stores/${storeId}/staff`),
    enabled: Boolean(storeId),
  });
  const staff = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const loading = listQuery.isPending;
  const visible = useMemo(() => sortStaff(filterStaff(staff, filters), sort), [staff, filters, sort]);
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
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {visible.length === staff.length
              ? fmt(t.staff.count, { count: staff.length })
              : fmt(t.staff.countFiltered, { shown: visible.length, total: staff.length })}
          </span>
          {filterCount > 0 && (
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-sm text-[var(--accent)] font-medium cursor-pointer">
              {fmt(t.staff.clearFilters, { count: filterCount })}
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

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
            <tr>
              <FilterableHeader
                col="name" label={t.common.name} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'name'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.name !== EMPTY_FILTERS.name}
              >
                <input
                  value={filters.name}
                  onChange={(e) => setFilter('name', e.target.value)}
                  placeholder={t.staff.filterName}
                  className={filterInput}
                  autoFocus
                />
              </FilterableHeader>
              <FilterableHeader
                col="email" label={t.staff.email} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'email'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.email !== EMPTY_FILTERS.email}
              >
                <input
                  value={filters.email}
                  onChange={(e) => setFilter('email', e.target.value)}
                  placeholder={t.staff.contains}
                  className={filterInput}
                />
              </FilterableHeader>
              <FilterableHeader
                col="role" label={t.staff.role} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'role'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.role !== EMPTY_FILTERS.role}
              >
                <select value={filters.role} onChange={(e) => setFilter('role', e.target.value)} className={filterInput}>
                  <option value="all">{t.common.all}</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{roleLabel(r)}</option>
                  ))}
                </select>
              </FilterableHeader>
              <FilterableHeader
                col="pin" label={t.staff.pin} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'pin'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.pin !== EMPTY_FILTERS.pin}
              >
                <select value={filters.pin} onChange={(e) => setFilter('pin', e.target.value)} className={filterInput}>
                  {PIN_FILTERS.map((value) => (
                    <option key={value} value={value}>{pinFilterLabel[value]}</option>
                  ))}
                </select>
              </FilterableHeader>
              <FilterableHeader
                col="status" label={t.common.status} sort={sort} onSort={toggleSort}
                isOpen={openFilterCol === 'status'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                hasActiveFilter={filters.status !== EMPTY_FILTERS.status}
              >
                <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={filterInput}>
                  {STATUS_FILTERS.map((value) => (
                    <option key={value} value={value}>{t.common[value]}</option>
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
                  {t.common.loading}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={6}>
                  {staff.length === 0 ? t.staff.empty : t.staff.noMatch}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.userId} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{row.email ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{roleLabel(row.role)}</td>
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
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{row.hasPinSet ? t.staff.pinSet : t.staff.pinNotSet}</td>
                  <td className="px-4 py-2">
                    <span className={row.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}>
                      {row.isActive ? t.common.active : t.common.inactive}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right space-x-3">
                    <button onClick={() => openEdit(row)} className="text-[var(--accent)] font-medium mr-3 cursor-pointer">
                      {t.common.edit}
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
                      {row.isActive ? t.staff.deactivate : t.staff.reactivate}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.staff.email}</label>
                  <input
                    required
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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.staff.email}</label>
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
