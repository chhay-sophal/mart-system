import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useOpenOnlineOrderCount } from '../lib/useOpenOnlineOrderCount';

const NAV_ITEMS = [
  { to: '/online-orders', label: 'Online orders' },
  { to: '/products', label: 'Products' },
  { to: '/staff', label: 'Staff' },
  { to: '/terminals', label: 'Terminals' },
  { to: '/transfers', label: 'Transfers' },
  { to: '/reports', label: 'Reports' },
  { to: '/reconciliation', label: 'Reconciliation' },
  { to: '/settings', label: 'Settings' },
];

function navLinkClass({ isActive }) {
  return [
    'px-3 py-2 rounded-lg text-sm font-medium',
    isActive ? 'bg-[var(--accent-bg)] text-[var(--accent)]' : 'text-slate-600 hover:bg-slate-100',
  ].join(' ');
}

export default function AppShell() {
  const { user, stores, currentStoreId, setCurrentStoreId, logout } = useAuth();
  const openOrders = useOpenOnlineOrderCount(currentStoreId);

  // Shows in the browser tab too, for a counter that keeps IMS in the background.
  useEffect(() => {
    document.title = openOrders ? `(${openOrders}) Mart System IMS` : 'Mart System IMS';
  }, [openOrders]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--border)] bg-white">
        <div className="flex items-center justify-between px-6 py-3 gap-4">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-[var(--text-h)]">Mart System IMS</span>
            <nav className="flex gap-1">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} className={navLinkClass}>
                  {item.label}
                  {item.to === '/online-orders' && openOrders > 0 && (
                    <span
                      className="ml-1.5 inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-[var(--accent)] text-white text-xs font-semibold"
                      aria-label={`${openOrders} open`}
                    >
                      {openOrders}
                    </span>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {stores.length > 1 && (
              <select
                value={currentStoreId ?? ''}
                onChange={(e) => setCurrentStoreId(e.target.value)}
                className="border border-[var(--border)] rounded-lg px-2 py-1 text-sm"
              >
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            )}
            <span className="text-sm text-slate-500">{user?.email}</span>
            <button
              onClick={logout}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6">
        {currentStoreId ? (
          <Outlet context={{ storeId: currentStoreId }} />
        ) : (
          <p className="text-sm text-slate-500">No store access. Contact an administrator.</p>
        )}
      </main>
    </div>
  );
}
