import { Route, Routes } from 'react-router-dom';
import SiteLayout from './layout/SiteLayout.jsx';
import { BranchProvider } from './state/BranchContext.jsx';
import { CartProvider } from './state/CartContext.jsx';
import { EmptyState } from './components/Status.jsx';

export default function App() {
  return (
    <BranchProvider>
      <CartProvider>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route path="*" element={<EmptyState title="Page not found" />} />
          </Route>
        </Routes>
      </CartProvider>
    </BranchProvider>
  );
}
