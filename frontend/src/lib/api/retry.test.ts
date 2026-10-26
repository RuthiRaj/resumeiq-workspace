import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  shouldRetryOnColdStart,
  isRetryableError,
  nextRetryDelay,
  RETRYABLE_STATUS,
  RETRYABLE_CODES,
  MAX_RETRY_DURATION_MS,
} from "@/lib/api/retry";

describe("retry.ts cold-start policy", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Default to mock mode
    process.env.NEXT_PUBLIC_API_MODE = "mock";
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8000";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("shouldRetryOnColdStart", () => {
    it("returns false in mock mode", () => {
      process.env.NEXT_PUBLIC_API_MODE = "mock";
      expect(shouldRetryOnColdStart()).toBe(false);
    });

    it("returns false on localhost in live mode", () => {
      process.env.NEXT_PUBLIC_API_MODE = "live";
      process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8000";
      expect(shouldRetryOnColdStart()).toBe(false);
    });

    it("returns false on 127.0.0.1 in live mode", () => {
      process.env.NEXT_PUBLIC_API_MODE = "live";
      process.env.NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:8000";
      expect(shouldRetryOnColdStart()).toBe(false);
    });

    it("returns true for non-localhost in live mode", () => {
      process.env.NEXT_PUBLIC_API_MODE = "live";
      process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.com";
      expect(shouldRetryOnColdStart()).toBe(true);
    });

    it("returns true for Render domain in live mode", () => {
      process.env.NEXT_PUBLIC_API_MODE = "live";
      process.env.NEXT_PUBLIC_API_BASE_URL = "https://resumeiq-api.onrender.com";
      expect(shouldRetryOnColdStart()).toBe(true);
    });
  });

  describe("isRetryableError", () => {
    class TestError extends Error {
      constructor(public code?: string, public status?: number) {
        super("test");
        this.name = "TestError";
      }
    }

    it("returns true for network error code", () => {
      const error = new TestError("network", 0);
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for invalid_response error code", () => {
      const error = new TestError("invalid_response", 502);
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for status 502", () => {
      const error = new TestError(undefined, 502);
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for status 503", () => {
      const error = new TestError(undefined, 503);
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for status 504", () => {
      const error = new TestError(undefined, 504);
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns false for status 400", () => {
      const error = new TestError(undefined, 400);
      expect(isRetryableError(error)).toBe(false);
    });

    it("returns false for status 401", () => {
      const error = new TestError(undefined, 401);
      expect(isRetryableError(error)).toBe(false);
    });

    it("returns false for status 500", () => {
      const error = new TestError(undefined, 500);
      expect(isRetryableError(error)).toBe(false);
    });

    it("returns false for non-Error objects", () => {
      expect(isRetryableError("string")).toBe(false);
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError({})).toBe(false);
    });

    it("returns false for Error without code/status", () => {
      const error = new Error("generic");
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe("nextRetryDelay", () => {
    it("starts at ~1000ms for attempt 0", () => {
      const delay = nextRetryDelay(0);
      expect(delay).toBeGreaterThanOrEqual(750); // 1000 * 0.75
      expect(delay).toBeLessThanOrEqual(1250); // 1000 * 1.25
    });

    it("roughly doubles each attempt (exponential backoff, with jitter)", () => {
      const delay0 = nextRetryDelay(0);
      const delay1 = nextRetryDelay(1);
      const delay2 = nextRetryDelay(2);

      // With jitter, delay1 should be roughly 2x delay0, but allow variance
      expect(delay1).toBeGreaterThan(delay0 * 1.2);
      expect(delay2).toBeGreaterThan(delay1 * 1.2);
    });

    it("caps at MAX_DELAY_MS (10000ms)", () => {
      // Attempt 10 should be capped
      const delay = nextRetryDelay(10);
      expect(delay).toBeLessThanOrEqual(12500); // 10000 * 1.25
    });

    it("includes jitter (±25%)", () => {
      // Run multiple times to verify jitter exists
      const delays = new Set<number>();
      for (let i = 0; i < 20; i++) {
        delays.add(nextRetryDelay(0));
      }
      expect(delays.size).toBeGreaterThan(1); // Should have variation due to jitter
    });
  });

  describe("constants", () => {
    it("RETRYABLE_STATUS contains 502, 503, 504", () => {
      expect(RETRYABLE_STATUS.has(502)).toBe(true);
      expect(RETRYABLE_STATUS.has(503)).toBe(true);
      expect(RETRYABLE_STATUS.has(504)).toBe(true);
      expect(RETRYABLE_STATUS.has(500)).toBe(false);
      expect(RETRYABLE_STATUS.has(404)).toBe(false);
    });

    it("RETRYABLE_CODES contains network and invalid_response", () => {
      expect(RETRYABLE_CODES.has("network")).toBe(true);
      expect(RETRYABLE_CODES.has("invalid_response")).toBe(true);
      expect(RETRYABLE_CODES.has("other")).toBe(false);
    });

    it("MAX_RETRY_DURATION_MS is 75000", () => {
      expect(MAX_RETRY_DURATION_MS).toBe(75_000);
    });
  });

  describe("backoff stops after ~75s", () => {
    it("sum of delays for first N attempts exceeds 75s before attempt 20", () => {
      let total = 0;
      for (let i = 0; i < 20; i++) {
        total += nextRetryDelay(i);
        if (total >= MAX_RETRY_DURATION_MS) {
          expect(i).toBeLessThan(20);
          break;
        }
      }
      expect(total).toBeGreaterThanOrEqual(MAX_RETRY_DURATION_MS * 0.9); // Allow some variance
    });
  });
});