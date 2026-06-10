/**
 * Exponential backoff retry helper.
 *
 * `withRetry` wraps an async operation and retries it with exponentially
 * growing delays, jittered to avoid thundering-herd patterns when many
 * clients fail simultaneously (e.g. during a provider rate-limit window).
 *
 * The caller is responsible for deciding **what** to retry: pass an
 * `isRetryable` predicate that inspects the error and returns `true` for
 * transient failures (network errors, 429s, 5xx) and `false` for permanent
 * ones (auth errors, malformed requests).
 */

/** Options accepted by {@link withRetry}. */
export interface RetryOptions {
  /** Maximum number of attempts including the first call. Default: 3. */
  maxAttempts?: number;
  /** Delay before the second attempt in milliseconds. Default: 200. */
  initialDelayMs?: number;
  /** Upper bound on the delay between attempts. Default: 10_000. */
  maxDelayMs?: number;
  /** Geometric backoff factor. Default: 2. */
  factor?: number;
  /**
   * Predicate deciding whether an error is worth retrying. Default: retry
   * every error.
   */
  isRetryable?: (error: unknown) => boolean;
  /** Optional abort signal — when triggered, a pending wait is interrupted. */
  signal?: AbortSignal;
}

const DEFAULT_OPTS: Required<Omit<RetryOptions, "signal">> = {
  maxAttempts: 3,
  initialDelayMs: 200,
  maxDelayMs: 10_000,
  factor: 2,
  isRetryable: () => true,
};

/**
 * Run an async operation with exponential-backoff retry.
 *
 * @param fn - the operation to execute. May return any value.
 * @param opts - retry policy.
 * @returns the resolved value of `fn` on success.
 * @throws the last error if all attempts fail or an error is not retryable.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const cfg = { ...DEFAULT_OPTS, ...opts };
  let lastError: unknown;

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= cfg.maxAttempts || !cfg.isRetryable(err)) {
        throw err;
      }
      const delay = computeDelay(attempt, cfg.initialDelayMs, cfg.factor, cfg.maxDelayMs);
      await sleep(delay, opts.signal);
    }
  }

  // Unreachable: the loop either returns or throws. The throw below silences
  // TypeScript's control-flow analysis for the implicit fall-through.
  throw lastError;
}

/** Compute the delay before attempt N (1-indexed) with full-jitter. */
function computeDelay(attempt: number, initial: number, factor: number, max: number): number {
  const expDelay = initial * Math.pow(factor, attempt - 1);
  const capped = Math.min(expDelay, max);
  // Full jitter: random number between 0 and the capped delay.
  return Math.floor(Math.random() * capped);
}

/**
 * Promise-based sleep with optional abort signal.
 *
 * If the signal aborts during the wait, the returned promise rejects with
 * the signal's reason (or a generic `AbortError` if none is set).
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
