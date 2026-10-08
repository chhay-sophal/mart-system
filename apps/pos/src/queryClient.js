import { QueryClient } from '@tanstack/react-query';

// Cache for the POS screens that fetch store-wide data over the network
// (Sales History, Daily Summary -- through the sidecar to the backend), same
// approach as IMS: re-opening a screen shows what was loaded before right
// away and refreshes it in the background once older than FRESH_MS.
// Completed sales, voids and resyncs invalidate the keys below so the
// screens always show them immediately.
//
// A local-only ("offline") response is cached the same as a store-wide one --
// the sidecar itself now refreshes its own store-wide cache in the background
// (storeReports.js) regardless of whether the frontend asks again, so a tight
// frontend staleTime here would only add extra, redundant sidecar requests
// without getting fresher data any sooner.
const FRESH_MS = 30_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FRESH_MS,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true, // only refetches once stale
      retry: 1,
    },
  },
});

export const queryKeys = {
  orders: (period) => ['orders', period],
  dailySummary: (day) => ['summary', day],
  // The branch catalog (Products tab). Changes only when sync pulls from IMS,
  // so the 30s freshness is plenty.
  products: () => ['products'],
  // Draft carts set aside on this register (issue #1).
  drafts: () => ['drafts'],
};

/** After a sale, void or resync: anything showing sales is out of date. */
export const invalidateSales = () =>
  Promise.all([['orders'], ['summary']].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
