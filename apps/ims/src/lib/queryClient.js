import { QueryClient } from '@tanstack/react-query';
import { todayStr } from './dateRange';

// IMS data cache, shared by every page (and, via lib/tabSync.js, by every
// open IMS tab). Re-opening a page shows what was loaded before right away;
// once data is older than its staleTime it's refreshed in the background (on
// mount or when the browser tab regains focus), so the screen stays current
// without re-downloading everything on every visit. Saves invalidate the
// affected keys (below) so edits always show immediately.
//
// How long data counts as fresh depends on how it changes:
// - LIVE: products (stock moves with every POS sale) and any sales/report
//   range that includes today.
// - REFERENCE: settings, categories, suppliers, staff, registers, stores --
//   edited rarely, and edits made here invalidate them at once; another
//   device's edit shows within a few minutes.
// - CLOSED_RANGE: sales/reports for a range that has already ended: only a
//   void changes them (voids made here invalidate them at once).
const LIVE_MS = 30_000;
const REFERENCE_MS = 5 * 60_000;
const CLOSED_RANGE_MS = 10 * 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: LIVE_MS,
      gcTime: 10 * 60_000, // drop unused data after 10 minutes
      refetchOnWindowFocus: true, // only refetches once stale
      retry: 1,
    },
  },
});

for (const prefix of [['stores'], ['store'], ['store-settings'], ['bakong-credential'], ['categories'], ['suppliers'], ['staff'], ['terminals']]) {
  queryClient.setQueryDefaults(prefix, { staleTime: REFERENCE_MS });
}

// Keys like ['orders', { dateTo, ... }]: an empty dateTo means open-ended.
const rangeHasEnded = (query) => {
  const dateTo = query.queryKey.at(-1)?.dateTo;
  return Boolean(dateTo) && dateTo < todayStr();
};
for (const prefix of [['orders'], ['reports', 'daily-summary']]) {
  queryClient.setQueryDefaults(prefix, { staleTime: (query) => (rangeHasEnded(query) ? CLOSED_RANGE_MS : LIVE_MS) });
}

// One place for cache keys, so a page and the saves that change its data
// always agree. Everything per store includes the storeId, so switching
// stores never shows another store's data. Suppliers and categories are
// global (the storeId in their URL only checks access), so they're one list
// each -- archived ones included, which pages filter out as needed -- rather
// than a copy per store and per "show archived".
export const queryKeys = {
  stores: () => ['stores'],
  products: (storeId, includeDeleted = false) => ['products', storeId, includeDeleted],
  suppliers: () => ['suppliers'],
  categories: () => ['categories'],
  staff: (storeId) => ['staff', storeId],
  storeSettings: (storeId) => ['store-settings', storeId],
  store: (storeId) => ['store', storeId],
  bakongCredential: (storeId) => ['bakong-credential', storeId],
  terminals: (storeId) => ['terminals', storeId],
  transfers: () => ['transfers'],
  orders: (params) => ['orders', params],
  dailySummary: (params) => ['reports', 'daily-summary', params],
  negativeStock: () => ['reports', 'negative-stock'],
};
