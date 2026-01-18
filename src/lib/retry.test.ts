/**
 * Retry Utility Tests
 */

import { retry, RetryError, withRetry, RetryPresets } from "./retry";

describe("Retry Utility", () => {
  describe("retry function", () => {
    it("succeeds on first try", async () => {
      const fn = jest.fn().mockResolvedValue("success");
      
      const result = await retry(fn, { retries: 3 });
      
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries on failure and eventually succeeds", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("rate limit"))
        .mockRejectedValueOnce(new Error("rate limit"))
        .mockResolvedValue("success");
      
      const result = await retry(fn, {
        retries: 3,
        baseDelayMs: 10, // Short delay for tests
        isRetryable: () => true,
      });
      
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("throws RetryError after exhausting retries", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("persistent error"));
      
      await expect(
        retry(fn, { retries: 2, baseDelayMs: 10, isRetryable: () => true })
      ).rejects.toThrow(RetryError);
      
      expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it("throws immediately on non-retryable error", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("validation error"));
      
      await expect(
        retry(fn, {
          retries: 3,
          baseDelayMs: 10,
          isRetryable: (err) => {
            return err instanceof Error && err.message.includes("rate limit");
          },
        })
      ).rejects.toThrow("validation error");
      
      expect(fn).toHaveBeenCalledTimes(1); // No retries for non-retryable
    });

    it("calls onRetry callback", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("rate limit"))
        .mockResolvedValue("success");
      
      const onRetry = jest.fn();
      
      await retry(fn, {
        retries: 3,
        baseDelayMs: 10,
        isRetryable: () => true,
        onRetry,
      });
      
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    });
  });

  describe("withRetry wrapper", () => {
    it("wraps function with retry logic", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("rate limit"))
        .mockResolvedValue(42);
      
      const wrapped = withRetry(fn, { retries: 2, baseDelayMs: 10, isRetryable: () => true });
      
      const result = await wrapped();
      
      expect(result).toBe(42);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("passes arguments through", async () => {
      const fn = jest.fn((a: number, b: number) => Promise.resolve(a + b));
      
      const wrapped = withRetry(fn, { retries: 1 });
      
      const result = await wrapped(3, 4);
      
      expect(result).toBe(7);
      expect(fn).toHaveBeenCalledWith(3, 4);
    });
  });

  describe("RetryError", () => {
    it("contains attempt count and last error", async () => {
      const lastError = new Error("final failure");
      const fn = jest.fn().mockRejectedValue(lastError);
      
      try {
        await retry(fn, { retries: 2, baseDelayMs: 10, isRetryable: () => true });
        fail("Expected error");
      } catch (e) {
        if (e instanceof RetryError) {
          expect(e.attempts).toBe(3);
          expect(e.lastError).toBe(lastError);
        }
      }
    });
  });

  describe("RetryPresets", () => {
    it("has openai preset", () => {
      expect(RetryPresets.openai.retries).toBe(3);
      expect(RetryPresets.openai.baseDelayMs).toBe(1000);
    });

    it("has storage preset", () => {
      expect(RetryPresets.storage.retries).toBe(3);
    });

    it("has database preset", () => {
      expect(RetryPresets.database.retries).toBe(2);
    });

    it("has quick preset", () => {
      expect(RetryPresets.quick.retries).toBe(2);
      expect(RetryPresets.quick.baseDelayMs).toBe(100);
    });
  });
});
