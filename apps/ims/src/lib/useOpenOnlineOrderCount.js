import { useEffect, useState } from 'react';
import { apiClient } from './apiClient';

const POLL_MS = 30_000;

/**
 * How many online orders at `storeId` still need the counter's attention
 * (to pack or ready for pickup — not ones still awaiting KHQR payment), kept
 * fresh from any page so new orders get noticed. Null until first loaded.
 */
export function useOpenOnlineOrderCount(storeId) {
  const [result, setResult] = useState({ storeId: null, count: null });

  useEffect(() => {
    if (!storeId) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const orders = await apiClient.get(`/api/stores/${storeId}/online-orders`, { status: 'OPEN' });
        if (!cancelled) setResult({ storeId, count: orders.filter((o) => o.status !== 'AWAITING_PAYMENT').length });
      } catch {
        // Leave the last count; the next tick retries.
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [storeId]);

  return result.storeId === storeId ? result.count : null;
}
