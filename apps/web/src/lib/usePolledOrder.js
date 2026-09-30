import { useEffect, useState } from 'react';
import { api } from './api.js';

// How often to re-check an order, by status. Awaiting payment is fast (the
// shopper is staring at a QR); being packed is slow; finished orders stop.
const POLL_MS = {
  AWAITING_PAYMENT: 3_000,
  CONFIRMED: 20_000,
  READY: 20_000,
};

/**
 * Loads an order by its secret token and keeps it fresh. Unlike useResource,
 * a refresh keeps showing the previous state instead of flashing "loading".
 */
export function usePolledOrder(token) {
  const [state, setState] = useState({ token: null, order: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let timer;
    const load = async () => {
      try {
        const order = await api.getOrder(token);
        if (cancelled) return;
        setState({ token, order, error: null });
        const delay = POLL_MS[order.status];
        if (delay) timer = setTimeout(load, delay);
      } catch (error) {
        if (cancelled) return;
        // A 404 is final; anything else (offline, a blip) keeps the last state and retries.
        setState((prev) => ({ token, order: prev.token === token ? prev.order : null, error }));
        if (error.status !== 404) timer = setTimeout(load, 5_000);
      }
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token]);

  const current = state.token === token;
  return {
    order: current ? state.order : null,
    error: current ? state.error : null,
    loading: !current,
  };
}
