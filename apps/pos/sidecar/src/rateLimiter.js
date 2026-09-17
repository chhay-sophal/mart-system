// In-memory sliding-window limiter with escalating lockouts — same shape as
// apps/backend/src/middleware/rateLimiter.ts's createSlidingWindowLimiter,
// ported here since the sidecar has no shared store to depend on (and only
// ever runs as one process on one terminal, so per-process state is fine).
function createSlidingWindowLimiter({ max, windowMs, lockoutStepsMs }) {
  const state = new Map();

  return {
    checkAllowed(key) {
      const s = state.get(key);
      const now = Date.now();
      if (s?.lockedUntil && s.lockedUntil > now) {
        return { allowed: false, retryAfterSec: Math.ceil((s.lockedUntil - now) / 1000) };
      }
      return { allowed: true };
    },

    recordFailure(key) {
      const now = Date.now();
      const s = state.get(key) ?? { failures: [], strikes: 0 };
      s.failures = s.failures.filter((t) => now - t < windowMs);
      s.failures.push(now);

      if (s.failures.length >= max) {
        const step = lockoutStepsMs[Math.min(s.strikes, lockoutStepsMs.length - 1)];
        s.lockedUntil = now + step;
        s.strikes += 1;
        s.failures = [];
      }

      state.set(key, s);
    },

    recordSuccess(key) {
      state.delete(key);
    },
  };
}

// Same thresholds as the backend's pinLoginLimiter: 5 failed attempts / 5 min
// -> 30s lockout, then 2min, then 5min for repeat offenders.
const pinUnlockLimiter = createSlidingWindowLimiter({
  max: 5,
  windowMs: 5 * 60_000,
  lockoutStepsMs: [30_000, 120_000, 300_000],
});

module.exports = { pinUnlockLimiter };
