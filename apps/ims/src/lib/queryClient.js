import { QueryClient } from '@tanstack/react-query';

// IMS data cache. Re-opening a tab shows what was loaded before right away;
// once data is older than STALE_MS it's refreshed in the background (on
// mount or when the browser tab regains focus), so the screen stays current
// without re-downloading everything on every visit. Saves invalidate the
// affected keys (below) so edits always show immediately.
const STALE_MS = 30_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_MS,
      gcTime: 10 * 60_000, // drop unused data after 10 minutes
      refetchOnWindowFocus: true, // only refetches once stale
      retry: 1,
    },
  },
});

// One place for cache keys, so a page and the saves that change its data
// always agree. Everything per store includes the storeId, so switching
// stores never shows another store's data.
export const queryKeys = {
  products: (storeId, includeDeleted = false) => ['products', storeId, includeDeleted],
  suppliers: (storeId, includeDeleted = false) => ['suppliers', storeId, includeDeleted],
  staff: (storeId) => ['staff', storeId],
  terminals: (storeId) => ['terminals', storeId],
  transfers: () => ['transfers'],
  orders: (params) => ['orders', params],
  dailySummary: (params) => ['reports', 'daily-summary', params],
  negativeStock: () => ['reports', 'negative-stock'],
};
