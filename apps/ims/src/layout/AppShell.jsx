import { useRef } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useHeadroom } from './useHeadroom';
import { useTheme } from '../hooks/useTheme';
import ThemeToggle from '../components/ThemeToggle.jsx';

const NAV_ITEMS = [
  { to: '/products', label: 'Products' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/staff', label: 'Staff' },
  { to: '/terminals', label: 'Terminals' },
  { to: '/transfers', label: 'Transfers' },
  { to: '/sales', label: 'Sales' },
  { to: '/reports', label: 'Reports' },
  { to: '/reconciliation', label: 'Reconciliation' },
  { to: '/settings', label: 'Settings' },
];

function navLinkClass({ isActive }) {
  return [
    'px-3 py-2 rounded-lg text-sm font-medium',
    isActive ? 'bg-[var(--accent-bg)] text-[var(--accent)]' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700',
  ].join(' ');
}

export default function AppShell() {
  const { user, stores, currentStoreId, setCurrentStoreId, logout } = useAuth();
  const headerRef = useRef(null);
  const { hidden, show } = useHeadroom(headerRef);
  const [theme, setTheme] = useTheme();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky, sliding out of view on scroll down and back on scroll up (issue #2). */}
      <header
        ref={headerRef}
        onFocus={show}
        className={`sticky top-0 z-40 border-b border-[var(--border)] bg-white dark:bg-slate-800 transition-transform duration-200 ease-out motion-reduce:transition-none ${
          hidden ? '-translate-y-full' : 'translate-y-0'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-3 gap-4">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-[var(--text-h)]">Mart System IMS</span>
            <nav className="flex gap-1">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} className={navLinkClass}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {stores.length > 1 && (
              <select
                value={currentStoreId ?? ''}
                onChange={(e) => setCurrentStoreId(e.target.value)}
                className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              >
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            )}
            <span className="text-sm text-slate-500 dark:text-slate-400">{user?.email}</span>
            <ThemeToggle theme={theme} onChange={setTheme} />
            <button
              onClick={logout}
              className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
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
          <p className="text-sm text-slate-500 dark:text-slate-400">No store access. Contact an administrator.</p>
        )}
      </main>
    </div>
  );
}
