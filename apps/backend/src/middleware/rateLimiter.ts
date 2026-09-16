import { tooManyRequests } from "../lib/httpError";

interface WindowState {
  failures: number[];
  lockedUntil?: number;
  strikes: number;
}

export interface SlidingWindowLimiterOptions {
  /** Failures allowed within `windowMs` before a lockout is triggered. */
  max: number;
  windowMs: number;
  /** Lockout duration escalates through this list on repeated triggers (last value repeats after). */
  lockoutStepsMs: number[];
}

/**
 * In-memory only — fine for a single Phase 1 backend process. If the backend
 * ever runs more than one instance this needs to move to a shared store
 * (Redis/Postgres-backed) so lockouts are consistent across processes.
 */
export function createSlidingWindowLimiter(options: SlidingWindowLimiterOptions) {
  const state = new Map<string, WindowState>();

  return {
    assertAllowed(key: string): void {
      const s = state.get(key);
      const now = Date.now();
      if (s?.lockedUntil && s.lockedUntil > now) {
        const retryAfterSec = Math.ceil((s.lockedUntil - now) / 1000);
        throw tooManyRequests(`Too many attempts. Try again in ${retryAfterSec}s.`);
      }
    },

    recordFailure(key: string): void {
      const now = Date.now();
      const s = state.get(key) ?? { failures: [], strikes: 0 };
      s.failures = s.failures.filter((t) => now - t < options.windowMs);
      s.failures.push(now);

      if (s.failures.length >= options.max) {
        const step = options.lockoutStepsMs[Math.min(s.strikes, options.lockoutStepsMs.length - 1)]!;
        s.lockedUntil = now + step;
        s.strikes += 1;
        s.failures = [];
      }

      state.set(key, s);
    },

    recordSuccess(key: string): void {
      state.delete(key);
    },
  };
}

/** Shared instance for cashier PIN login: 5 failed attempts / 5 min -> 30s, then 2min, then 5min lockouts. */
export const pinLoginLimiter = createSlidingWindowLimiter({
  max: 5,
  windowMs: 5 * 60_000,
  lockoutStepsMs: [30_000, 120_000, 300_000],
});
