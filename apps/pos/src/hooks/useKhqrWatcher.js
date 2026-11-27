import { useCallback, useEffect, useRef, useState } from 'react';

// Watches every KHQR this register shows until it's paid or truly expired,
// and reports each payment exactly once.
//
// - One check at a time: the next round only starts after the previous one
//   finished, so a slow answer can never overlap a fresh one (overlapping
//   "paid" answers used to save one payment as two sales).
// - A QR stays watched after it's replaced on screen (new total, refresh
//   before expiry) or the cashier switches method: it remains payable until
//   it expires, and a payment to it must not go unnoticed.
// - A QR whose checks keep failing gets an error the panel can show, instead
//   of "waiting for payment" forever.

const POLL_MS = 3000;
// Failed checks in a row before the cashier is told.
const FAILURES_BEFORE_ERROR = 3;
// The backend reports EXPIRED two minutes after expiry; if it can't be
// reached at all, stop on this side a little after that.
const GIVE_UP_AFTER_EXPIRY_MS = 3 * 60 * 1000;
const DEFAULT_LIFETIME_MS = 5 * 60 * 1000;

const errorText = (err) => err?.body?.error || err?.message || '';

/**
 * The watcher itself, without React (so it can be tested on its own).
 * handlers(): the current { onPaid, onExpired }; onPaid(qr) is awaited
 * before the next check, so saving the sale finishes first.
 * setError(md5, message | null): a QR's checks keep failing, or recovered.
 */
export function createKhqrWatcher({ client, handlers, setError, pollMs = POLL_MS, now = Date.now }) {
  const watches = new Map();
  let stopped = false;
  let timer = null;

  const check = async (qr) => {
    if (now() > qr.expiresAt + GIVE_UP_AFTER_EXPIRY_MS) {
      watches.delete(qr.md5_hash);
      setError(qr.md5_hash, null);
      handlers().onExpired?.(qr);
      return;
    }
    try {
      const { status } = await client.get(`/api/payments/check-status/${encodeURIComponent(qr.md5_hash)}`);
      qr.failures = 0;
      setError(qr.md5_hash, null);
      if (status === 'PAID') {
        watches.delete(qr.md5_hash);
        await handlers().onPaid?.(qr);
      } else if (status === 'EXPIRED') {
        watches.delete(qr.md5_hash);
        handlers().onExpired?.(qr);
      }
    } catch (err) {
      qr.failures += 1;
      if (qr.failures >= FAILURES_BEFORE_ERROR) setError(qr.md5_hash, errorText(err));
    }
  };

  const round = async () => {
    for (const qr of [...watches.values()]) {
      if (stopped) return;
      await check(qr);
    }
    if (!stopped) timer = setTimeout(round, pollMs);
  };
  timer = setTimeout(round, pollMs);

  return {
    watch(qr) {
      const expiresAt = Date.parse(qr.expires_at) || now() + DEFAULT_LIFETIME_MS;
      watches.set(qr.md5_hash, { ...qr, expiresAt, failures: 0 });
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/**
 * watch(qr): start watching a QR ({ md5_hash, amount, currency, expires_at }).
 * onPaid(qr) / onExpired(qr): see createKhqrWatcher; the latest ones are
 * always used, since they read the current cart and total.
 * checkErrors: { [md5_hash]: message } for QRs whose checks keep failing.
 */
export function useKhqrWatcher(client, { onPaid, onExpired }) {
  const handlers = useRef({ onPaid, onExpired });
  const watcher = useRef(null);
  const [checkErrors, setCheckErrors] = useState({});

  useEffect(() => {
    handlers.current = { onPaid, onExpired };
  });

  useEffect(() => {
    const setError = (md5, message) =>
      setCheckErrors((prev) => {
        if ((prev[md5] ?? null) === message) return prev;
        const next = { ...prev };
        if (message === null) delete next[md5];
        else next[md5] = message;
        return next;
      });
    watcher.current = createKhqrWatcher({ client, handlers: () => handlers.current, setError });
    return () => watcher.current.stop();
  }, [client]);

  const watch = useCallback((qr) => watcher.current?.watch(qr), []);
  return { watch, checkErrors };
}
