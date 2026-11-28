import { useCallback, useEffect, useRef, useState } from 'react';

// Watches every KHQR this register shows until it's paid or expired, and
// reports each payment exactly once -- while spending as few Bakong status
// checks as possible, since Bakong limits them:
//
// - Cashiers check the payment once the customer shows it on their phone:
//   Check payment does one check, right away (checkNow). There are no
//   automatic checks in between.
// - Every QR still gets one final check after it expires, so a payment that
//   wasn't checked (made after switching to Cash, or after a too-early
//   Check payment) is still caught: the sale completes, or it's flagged.
// - A payment Bakong records differently from its QR (wrong amount or
//   currency, a 409) is a definite answer, not a passing error: the QR stops
//   being watched and onMismatch is told, final check included.
// - One check at a time: a slow answer can never overlap another (overlapping
//   "paid" answers once saved one payment as two sales).

const TICK_MS = 1000;
// The backend calls an unpaid QR EXPIRED two minutes after expiry; the final
// check of an off-screen QR comes just after that, so it gets a definite answer.
const FINAL_CHECK_AFTER_EXPIRY_MS = 2.5 * 60 * 1000;
// If the backend can't be reached at all, stop a little after that.
const GIVE_UP_AFTER_EXPIRY_MS = 4 * 60 * 1000;
const DEFAULT_LIFETIME_MS = 5 * 60 * 1000;

// Never empty: an empty message would read as "no error".
const errorText = (err) => err?.body?.error || err?.message || 'Unknown error';

/**
 * The watcher itself, without React (so it can be tested on its own).
 * handlers(): the current { onPaid, onExpired, onMismatch }; onPaid(qr) is
 * awaited before the next check, so saving the sale finishes first;
 * onMismatch(qr, message) when Bakong's record doesn't match the QR.
 * setError(md5, message | null): a QR's last check failed, or recovered.
 * setChecking(md5, boolean): a check of that QR is running.
 */
export function createKhqrWatcher({
  client,
  handlers,
  setError,
  setChecking = () => {},
  tickMs = TICK_MS,
  finalCheckAfterExpiryMs = FINAL_CHECK_AFTER_EXPIRY_MS,
  now = Date.now,
}) {
  const watches = new Map();
  let stopped = false;
  let timer = null;

  const finish = (qr, status) => {
    watches.delete(qr.md5_hash);
    setError(qr.md5_hash, null);
    for (const resolve of qr.waiters.splice(0)) resolve(status);
  };

  // Still pending: the next automatic check is the final one, after expiry
  // (a failed final check is retried a minute later, until GIVE_UP).
  const schedule = (qr) => {
    qr.nextCheckAt = Math.max(now() + 60 * 1000, qr.expiresAt + finalCheckAfterExpiryMs);
  };

  const check = async (qr) => {
    const manual = qr.manual;
    qr.manual = false;
    if (!manual && now() > qr.expiresAt + GIVE_UP_AFTER_EXPIRY_MS) {
      finish(qr, 'EXPIRED');
      handlers().onExpired?.(qr);
      return;
    }
    setChecking(qr.md5_hash, true);
    try {
      const path = `/api/payments/check-status/${encodeURIComponent(qr.md5_hash)}${manual ? '?manual=1' : ''}`;
      const { status } = await client.get(path);
      setError(qr.md5_hash, null);
      if (status === 'PAID') {
        finish(qr, 'PAID');
        await handlers().onPaid?.(qr);
      } else if (status === 'EXPIRED') {
        finish(qr, 'EXPIRED');
        handlers().onExpired?.(qr);
      } else {
        schedule(qr);
        for (const resolve of qr.waiters.splice(0)) resolve('PENDING');
      }
    } catch (err) {
      if (err?.status === 409) {
        finish(qr, 'MISMATCH');
        handlers().onMismatch?.(qr, errorText(err));
        return;
      }
      setError(qr.md5_hash, errorText(err));
      schedule(qr);
      for (const resolve of qr.waiters.splice(0)) resolve('ERROR');
    } finally {
      setChecking(qr.md5_hash, false);
    }
  };

  const tick = async () => {
    // Manual checks first, then whatever is due, one at a time.
    const due = [...watches.values()]
      .filter((qr) => qr.manual || qr.nextCheckAt <= now())
      .sort((a, b) => Number(b.manual) - Number(a.manual));
    for (const qr of due) {
      if (stopped) return;
      if (watches.has(qr.md5_hash)) await check(qr);
    }
    if (!stopped) timer = setTimeout(tick, tickMs);
  };
  timer = setTimeout(tick, tickMs);

  return {
    watch(qr) {
      const expiresAt = Date.parse(qr.expires_at) || now() + DEFAULT_LIFETIME_MS;
      watches.set(qr.md5_hash, { ...qr, expiresAt, nextCheckAt: expiresAt + finalCheckAfterExpiryMs, manual: false, waiters: [] });
    },
    /** Stop watching this QR (its payment was settled another way). */
    unwatch(md5) {
      const qr = watches.get(md5);
      if (qr) finish(qr, null);
    },
    /** Check this QR right away; resolves to PAID / PENDING / EXPIRED / MISMATCH / ERROR (null if not watched). */
    checkNow(md5) {
      const qr = watches.get(md5);
      if (!qr) return Promise.resolve(null);
      qr.manual = true;
      return new Promise((resolve) => qr.waiters.push(resolve));
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/**
 * watch(qr): start watching a QR ({ md5_hash, amount, currency, expires_at }).
 * checkNow(md5): Check payment. unwatch(md5): settled another way.
 * onPaid / onExpired / onMismatch: see createKhqrWatcher; the latest ones are
 * always used, since they read the current cart and total.
 * checkErrors / checking: { [md5_hash]: message } and { [md5_hash]: true }.
 */
export function useKhqrWatcher(client, { onPaid, onExpired, onMismatch }) {
  const handlers = useRef({ onPaid, onExpired, onMismatch });
  const watcher = useRef(null);
  const [checkErrors, setCheckErrors] = useState({});
  const [checking, setCheckingState] = useState({});

  useEffect(() => {
    handlers.current = { onPaid, onExpired, onMismatch };
  });

  useEffect(() => {
    const keyed = (setter) => (md5, value) =>
      setter((prev) => {
        if ((prev[md5] ?? null) === (value || null)) return prev;
        const next = { ...prev };
        if (!value) delete next[md5];
        else next[md5] = value;
        return next;
      });
    watcher.current = createKhqrWatcher({
      client,
      handlers: () => handlers.current,
      setError: keyed(setCheckErrors),
      setChecking: keyed(setCheckingState),
    });
    return () => watcher.current.stop();
  }, [client]);

  const watch = useCallback((qr) => watcher.current?.watch(qr), []);
  const checkNow = useCallback((md5) => watcher.current?.checkNow(md5) ?? Promise.resolve(null), []);
  const unwatch = useCallback((md5) => watcher.current?.unwatch(md5), []);
  return { watch, checkNow, unwatch, checkErrors, checking };
}
