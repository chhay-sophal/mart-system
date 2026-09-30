import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { readJson, writeJson } from '../lib/storage.js';

const STORAGE_KEY = 'storefront.cart';
const MAX_QTY = 99;
const CartContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}

/**
 * The cart only remembers product ids and quantities. Names, prices and
 * availability always come from the selected branch's live catalog, so a
 * price change or a branch switch is reflected instead of a stale snapshot.
 */
export function CartProvider({ children }) {
  const [lines, setLines] = useState(() => readJson(STORAGE_KEY, {}));

  const update = useCallback((fn) => {
    setLines((prev) => {
      const next = fn(prev);
      writeJson(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setQuantity = useCallback(
    (productId, qty) =>
      update((prev) => {
        const next = { ...prev };
        const clamped = Math.min(MAX_QTY, Math.max(0, Math.floor(qty)));
        if (clamped === 0) delete next[productId];
        else next[productId] = clamped;
        return next;
      }),
    [update],
  );

  const add = useCallback(
    (productId, qty = 1) => update((prev) => ({ ...prev, [productId]: Math.min(MAX_QTY, (prev[productId] ?? 0) + qty) })),
    [update],
  );

  const clear = useCallback(() => update(() => ({})), [update]);

  const value = useMemo(
    () => ({
      lines,
      count: Object.values(lines).reduce((sum, q) => sum + q, 0),
      add,
      setQuantity,
      remove: (productId) => setQuantity(productId, 0),
      clear,
    }),
    [lines, add, setQuantity, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
