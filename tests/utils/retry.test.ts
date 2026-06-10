import { describe, it, expect, vi, afterEach } from "vitest";
import { withRetry } from "../../src/utils/retry.js";

/**
 * Tests for the exponential-backoff retry helper.
 *
 * Math.random is mocked to return 0 throughout, making the full-jitter
 * delay always 0 ms so tests run instantly without fake timers.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Helper: creates a function that fails N times then succeeds.
 * Each call increments a counter tracked in the returned object.
 */
function failNTimes(n: number, successValue = "ok") {
  let calls = 0;
  const fn = vi.fn(async () => {
    calls++;
    if (calls <= n) {
      throw new Error(`fail-${calls}`);
    }
    return successValue;
  });
  return { fn, getCalls: () => calls };
}

describe("withRetry", () => {
  describe("succeeds on first attempt", () => {
    it("returns the value without retrying", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const fn = vi.fn(async () => 42);
      const result = await withRetry(fn);
      expect(result).toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("passes through string values", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const fn = vi.fn(async () => "hello");
      await expect(withRetry(fn)).resolves.toBe("hello");
    });

    it("passes through object values", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const obj = { key: "value" };
      const fn = vi.fn(async () => obj);
      await expect(withRetry(fn)).resolves.toBe(obj);
    });
  });

  describe("retries on failure, succeeds on Nth attempt", () => {
    it("succeeds on second attempt after one failure", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { fn } = failNTimes(1, "recovered");
      const result = await withRetry(fn, { maxAttempts: 3 });
      expect(result).toBe("recovered");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("succeeds on third attempt after two failures", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { fn } = failNTimes(2, "third-time");
      const result = await withRetry(fn, { maxAttempts: 5 });
      expect(result).toBe("third-time");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("succeeds on the last allowed attempt", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { fn } = failNTimes(2, "just-in-time");
      const result = await withRetry(fn, { maxAttempts: 3 });
      expect(result).toBe("just-in-time");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("retries with default maxAttempts (3)", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { fn } = failNTimes(2, "default-retry");
      const result = await withRetry(fn);
      expect(result).toBe("default-retry");
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe("exhausts retries and throws", () => {
    it("throws the last error after all attempts fail", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const fn = vi.fn(async () => {
        throw new Error("persistent-failure");
      });
      await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow("persistent-failure");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("throws with default maxAttempts when all 3 attempts fail", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const fn = vi.fn(async () => {
        throw new Error("always-fails");
      });
      await expect(withRetry(fn)).rejects.toThrow("always-fails");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("preserves the original error object", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const originalError = new Error("original");
      originalError.cause = { detail: "root-cause" };
      const fn = vi.fn(async () => {
        throw originalError;
      });
      try {
        await withRetry(fn, { maxAttempts: 2 });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBe(originalError);
        expect((err as Error).cause).toEqual({ detail: "root-cause" });
      }
    });

    it("throws the last error, not the first", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        throw new Error(`error-${calls}`);
      });
      await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow("error-3");
    });
  });

  describe("respects max attempts", () => {
    it("maxAttempts: 1 means a single attempt with no retries", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const fn = vi.fn(async () => {
        throw new Error("immediate");
      });
      await expect(withRetry(fn, { maxAttempts: 1 })).rejects.toThrow("immediate");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("maxAttempts: 5 allows up to 5 calls", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const fn = vi.fn(async () => {
        throw new Error("fail");
      });
      await expect(withRetry(fn, { maxAttempts: 5 })).rejects.toThrow("fail");
      expect(fn).toHaveBeenCalledTimes(5);
    });

    it("maxAttempts: 2 with success on second call", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { fn } = failNTimes(1, "ok");
      const result = await withRetry(fn, { maxAttempts: 2 });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("isRetryable predicate", () => {
    it("stops retrying immediately when error is not retryable", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const fn = vi.fn(async () => {
        throw new Error("permanent");
      });
      await expect(
        withRetry(fn, {
          maxAttempts: 5,
          isRetryable: () => false,
        }),
      ).rejects.toThrow("permanent");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries only retryable errors, stops on non-retryable", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls <= 2) {
          throw new Error("transient");
        }
        throw new Error("permanent");
      });
      await expect(
        withRetry(fn, {
          maxAttempts: 10,
          isRetryable: (err) => (err as Error).message !== "permanent",
        }),
      ).rejects.toThrow("permanent");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("retries all errors when isRetryable is not provided (default)", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { fn } = failNTimes(2, "ok");
      const result = await withRetry(fn, { maxAttempts: 5 });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("receives the actual error object in the predicate", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const errors: unknown[] = [];
      const fn = vi.fn(async () => {
        throw new Error("inspect-me");
      });
      await expect(
        withRetry(fn, {
          maxAttempts: 2,
          isRetryable: (err) => {
            errors.push(err);
            return false;
          },
        }),
      ).rejects.toThrow("inspect-me");
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("inspect-me");
    });
  });

  describe("backoff timing", () => {
    it("delays between retries using exponential backoff with jitter", async () => {
      // Mock Math.random to return 0.5 for deterministic jitter.
      // computeDelay(attempt, initial=100, factor=2, max=10000):
      //   attempt 1: 100 * 2^0 = 100 → floor(0.5 * 100) = 50
      //   attempt 2: 100 * 2^1 = 200 → floor(0.5 * 200) = 100
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      const { fn } = failNTimes(2, "ok");
      const start = Date.now();
      const result = await withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        factor: 2,
        maxDelayMs: 10_000,
      });
      const elapsed = Date.now() - start;

      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
      // Total delay should be ~150ms (50 + 100), but we allow a generous range
      // since setTimeout is not perfectly precise.
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    it("caps delay at maxDelayMs", async () => {
      // Mock Math.random to return 0.99 for near-max jitter.
      // computeDelay(attempt=1, initial=1000, factor=10, max=500):
      //   1000 * 10^0 = 1000 → capped at 500 → floor(0.99 * 500) = 495
      vi.spyOn(Math, "random").mockReturnValue(0.99);

      const { fn } = failNTimes(1, "capped");
      const start = Date.now();
      await withRetry(fn, {
        maxAttempts: 2,
        initialDelayMs: 1_000,
        factor: 10,
        maxDelayMs: 500,
      });
      const elapsed = Date.now() - start;

      // Delay should be capped around 495ms, not 990ms
      expect(elapsed).toBeLessThan(900);
    });
  });

  describe("abort signal", () => {
    it("rejects when signal is already aborted before sleep starts", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const controller = new AbortController();
      controller.abort(new Error("aborted-early"));

      const fn = vi.fn(async () => {
        throw new Error("fail");
      });

      // The first call fails, then sleep checks the already-aborted signal
      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          signal: controller.signal,
        }),
      ).rejects.toThrow("aborted-early");
    });

    it("rejects when signal is aborted during a retry wait", async () => {
      // Use a high random value so the delay is large enough to abort during
      vi.spyOn(Math, "random").mockReturnValue(0.99);

      const controller = new AbortController();
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls === 1) {
          throw new Error("transient");
        }
        return "should-not-reach";
      });

      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 5_000,
        signal: controller.signal,
      });

      // Abort after a short delay to interrupt the sleep
      setTimeout(() => controller.abort(new Error("cancelled")), 50);

      await expect(promise).rejects.toThrow("cancelled");
      // The function should have been called only once (before the abort)
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
