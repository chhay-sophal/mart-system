import { useAuth } from '../auth/AuthContext.jsx';

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

// Read-only: every store the signed-in user has a role at (or every store,
// for a super admin) -- already loaded once at the app level by AuthContext
// (the same list the header's store switcher uses), so this just renders it.
export default function StoresPage() {
  const { stores } = useAuth();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">Stores</h1>
        <span className="text-sm text-slate-500 dark:text-slate-400">{stores.length} store{stores.length === 1 ? '' : 's'}</span>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Address</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Timezone</th>
                <th className="px-4 py-2 font-medium">Your role</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Created</th>
              </tr>
            </thead>
            <tbody>
              {stores.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-400 dark:text-slate-500" colSpan={8}>
                    No store access. Contact an administrator.
                  </td>
                </tr>
              ) : (
                stores.map((store) => (
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
