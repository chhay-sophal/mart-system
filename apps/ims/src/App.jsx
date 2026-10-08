import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import LoginPage from './auth/LoginPage.jsx';
import AppShell from './layout/AppShell.jsx';
import ProductsPage from './pages/ProductsPage.jsx';
import StoresPage from './pages/StoresPage.jsx';
import SuppliersPage from './pages/SuppliersPage.jsx';
import StaffPage from './pages/StaffPage.jsx';
import TerminalsPage from './pages/TerminalsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ReconciliationPage from './pages/ReconciliationPage.jsx';
import TransfersPage from './pages/TransfersPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SalesHistoryPage from './pages/SalesHistoryPage.jsx';

export default function App() {
  const { status, stores, currentStoreId } = useAuth();
  const isAdmin = stores.find((s) => s.id === currentStoreId)?.role === 'ADMIN';

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>
    );
  }

  if (status === 'anonymous') {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/stores" element={<StoresPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/terminals" element={<TerminalsPage />} />
        <Route path="/reconciliation" element={<ReconciliationPage />} />
        <Route path="/transfers" element={<TransfersPage />} />
        <Route path="/sales" element={<SalesHistoryPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={isAdmin ? <SettingsPage /> : <Navigate to="/products" replace />} />
        <Route path="*" element={<Navigate to="/products" replace />} />
      </Route>
    </Routes>
  );
}
