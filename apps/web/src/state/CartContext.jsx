import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { readJson, writeJson } from '../lib/storage.js';

const STORAGE_KEY = 'storefront.cart';
const NAMES_KEY = 'storefront.cartNames';
const MAX_QTY = 99;
const CartContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}

/** useState mirrored into localStorage under `key`. */
function usePersisted(key, initial) {
  const [value, setValue] = useState(() => readJson(key, initial));
  const update = useCallback(
    (fn) =>
      setValue((prev) => {
        const next = fn(prev);
        writeJson(key, next);
        return next;
      }),
    [key],
  );
  return [value, update];
}

const without = (obj, key) => {
  const next = { ...obj };
  delete next[key];
  return next;
};

/**
 * The cart only remembers product ids and quantities. Prices and
 * availability always come from the selected branch's live catalog, so a
 * price change or a branch switch is reflected instead of a stale snapshot.
 * The name seen when adding is kept too, purely as a label for an item the
 * current branch doesn't sell (and so can't name).
 */
export function CartProvider({ children }) {
  const [lines, updateLines] = usePersisted(STORAGE_KEY, {});
  const [names, updateNames] = usePersisted(NAMES_KEY, {});

  const setQuantity = useCallback(
    (productId, qty) => {
      const clamped = Math.min(MAX_QTY, Math.max(0, Math.floor(qty)));
      if (clamped === 0) {
        updateLines((prev) => without(prev, productId));
        updateNames((prev) => without(prev, productId));
      } else {
        updateLines((prev) => ({ ...prev, [productId]: clamped }));
      }
    },
    [updateLines, updateNames],
  );

  const add = useCallback(
    (product, qty = 1) => {
      updateNames((prev) => ({ ...prev, [product.id]: product.name }));
      updateLines((prev) => ({ ...prev, [product.id]: Math.min(MAX_QTY, (prev[product.id] ?? 0) + qty) }));
    },
    [updateLines, updateNames],
  );

  const clear = useCallback(() => {
    updateLines(() => ({}));
    updateNames(() => ({}));
  }, [updateLines, updateNames]);

  const value = useMemo(
    () => ({
      lines,
      names,
      count: Object.values(lines).reduce((sum, q) => sum + q, 0),
      add,
      setQuantity,
      remove: (productId) => setQuantity(productId, 0),
      clear,
    }),
    [lines, names, add, setQuantity, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
