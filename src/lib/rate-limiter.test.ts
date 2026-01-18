import {
  RateLimits,
  RateLimitExceededError,
} from "./rate-limiter";

// Note: Full integration tests would require a test database.
// These tests verify the configuration and error class.

describe("rate-limiter", () => {
  describe("RateLimits configuration", () => {
    it("should have extraction limit config", () => {
      expect(RateLimits.extraction).toBeDefined();
      expect(RateLimits.extraction.maxRequests).toBeGreaterThan(0);
      expect(RateLimits.extraction.windowSeconds).toBe(60);
    });

    it("should have reprocess limit config", () => {
      expect(RateLimits.reprocess).toBeDefined();
      expect(RateLimits.reprocess.maxRequests).toBeGreaterThan(0);
      expect(RateLimits.reprocess.windowSeconds).toBe(3600);
    });

    it("should use default values when env vars not set", () => {
      // Default is 10 requests per minute for extraction
      expect(RateLimits.extraction.maxRequests).toBe(10);
      // Default is 5 reprocesses per hour
      expect(RateLimits.reprocess.maxRequests).toBe(5);
    });
  });

  describe("RateLimitExceededError", () => {
    it("should create error with correct properties", () => {
      const error = new RateLimitExceededError(
        "Rate limit exceeded",
        30,
        "/api/tenders/upload"
      );

      expect(error.name).toBe("RateLimitExceededError");
      expect(error.message).toBe("Rate limit exceeded");
      expect(error.retryAfter).toBe(30);
      expect(error.route).toBe("/api/tenders/upload");
    });

    it("should be instanceof Error", () => {
      const error = new RateLimitExceededError("test", 10, "/test");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RateLimitExceededError);
    });
  });
});
