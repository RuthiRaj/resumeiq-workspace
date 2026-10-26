/**
 * Retry policy for production cold starts (Render free tier spins down after 15 min).
 * Only applies in live mode when the API base URL is not localhost.
 */

import { apiBaseUrl, isLiveMode } from "@/lib/config/mode";

/** Shape of the ApiError used by the client (duck-typed). */
interface ApiErrorLike {
  code?: string;
  status?: number;
}

/** Error codes that should trigger a retry. */
export const RETRYABLE_CODES = new Set<string>([
  "network",
  "invalid_response",
]);

/** HTTP status codes that should trigger a retry. */
export const RETRYABLE_STATUS = new Set([502, 503, 504]);

/** Maximum total time to spend retrying (ms). */
export const MAX_RETRY_DURATION_MS = 75_000;

/** Base delay between retries (ms). Exponential backoff with jitter. */
const BASE_DELAY_MS = 1_000;
/** Maximum delay between retries (ms). */
const MAX_DELAY_MS = 10_000;

/**
 * Determines if we should apply cold-start retry logic.
 * Only in live mode AND when the API base URL is not localhost.
 */
export function shouldRetryOnColdStart(): boolean {
  if (!isLiveMode()) return false;
  const base = apiBaseUrl();
  // Don't retry for localhost (local development)
  return !base.includes("localhost") && !base.includes("127.0.0.1");
}

/**
 * Calculates the next delay with exponential backoff and jitter.
 */
export function nextRetryDelay(attempt: number): number {
  const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  // Add jitter: ±25%
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}

/**
 * Checks if an error is retryable under cold-start policy.
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const e = error as ApiErrorLike;
  // Check for retryable code
  if (typeof e.code === "string" && RETRYABLE_CODES.has(e.code)) return true;
  // Check for retryable status
  if (typeof e.status === "number" && RETRYABLE_STATUS.has(e.status)) return true;
  return false;
}

/**
 * Sleep utility for retry delays.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}