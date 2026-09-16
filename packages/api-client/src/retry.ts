export interface RetryOptions {
  /** Max attempts including the first call. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Called before each retry sleep — useful for logging/telemetry. */
  onRetry?: (attempt: number, error: unknown) => void;
  /** Return false to stop retrying immediately (e.g. a non-retryable 4xx). */
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULTS: Required<Omit<RetryOptions, "onRetry" | "shouldRetry">> = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter. Built for the POS sync-push loop, where a
 * failed attempt must be retried without ever blocking or losing the outbox
 * event — the caller re-invokes this on its own schedule if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (options.shouldRetry && !options.shouldRetry(error)) {
        throw error;
      }
      if (attempt === maxAttempts) {
        break;
      }
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jitter = Math.random() * backoff * 0.25;
      options.onRetry?.(attempt, error);
      await sleep(backoff + jitter);
    }
  }

  throw lastError;
}
