import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import {
  classifyError,
  type ErrorKind,
} from "./error-classifier";

describe("classifyError", () => {
  function assertClassification(
    error: unknown,
    expectedKind: ErrorKind,
    expectedUserMessage: string,
    expectedIdempotent: boolean,
    method = "GET"
  ) {
    const result = classifyError(error, method);
    expect(result.kind).toBe(expectedKind);
    expect(result.userMessage).toBe(expectedUserMessage);
    expect(result.isIdempotentRead).toBe(expectedIdempotent);
  }

  it("classifies 401 as session_expired (not auto-retryable)", () => {
    const error = new ApiError("Unauthorized", 401, "/api/v1/test", "unauthorized");
    assertClassification(error, "session_expired", "Your session has expired. Please sign in again.", false);
  });

  it("classifies 429 as rate_limited with retry-after", () => {
    const headers = new Headers();
    headers.set("Retry-After", "60");
    const error = new ApiError("Too Many Requests", 429, "/api/v1/test", "rate_limited", 60000, headers);
    const result = classifyError(error, "GET");
    expect(result.kind).toBe("rate_limited");
    expect(result.userMessage).toBe("Too many requests. Please wait a moment and try again.");
    expect(result.retryAfterMs).toBe(60000);
    expect(result.isIdempotentRead).toBe(true);
  });

  it("classifies 500 as server_error", () => {
    const error = new ApiError("Internal Server Error", 500, "/api/v1/test", "internal_server_error");
    assertClassification(error, "server_error", "The server encountered an error. Please try again.", true);
  });

  it("classifies 502 as server_error for idempotent reads", () => {
    const error = new ApiError("Bad Gateway", 502, "/api/v1/test");
    const result = classifyError(error, "GET");
    expect(result.kind).toBe("server_error");
    expect(result.isIdempotentRead).toBe(true);
  });

  it("classifies 503 as server_error for idempotent reads", () => {
    const error = new ApiError("Service Unavailable", 503, "/api/v1/test");
    const result = classifyError(error, "GET");
    expect(result.kind).toBe("server_error");
    expect(result.isIdempotentRead).toBe(true);
  });

  it("classifies 504 as server_error for idempotent reads", () => {
    const error = new ApiError("Gateway Timeout", 504, "/api/v1/test");
    const result = classifyError(error, "GET");
    expect(result.kind).toBe("server_error");
    expect(result.isIdempotentRead).toBe(true);
  });

  it("classifies supabase_unavailable error code", () => {
    const error = new ApiError("Database unavailable", 500, "/api/v1/test", "supabase_unavailable");
    const result = classifyError(error, "GET");
    expect(result.kind).toBe("supabase_unavailable");
    expect(result.userMessage).toContain("database service is temporarily unavailable");
  });

  it("classifies network errors (TypeError)", () => {
    const error = new TypeError("Failed to fetch");
    const result = classifyError(error, "GET");
    expect(result.kind).toBe("network");
    expect(result.userMessage).toContain("Can't reach the ResumeIQ server");
    expect(result.isIdempotentRead).toBe(true);
  });

  it("classifies non-idempotent POST as not auto-retryable", () => {
    const error = new TypeError("Failed to fetch");
    const result = classifyError(error, "POST");
    expect(result.isIdempotentRead).toBe(false);
  });

  it("classifies unknown errors", () => {
    const error = new Error("Something weird happened");
    const result = classifyError(error, "GET");
    expect(result.kind).toBe("unknown");
    expect(result.userMessage).toContain("unexpected error");
  });

  it("extracts request ID from headers", () => {
    const headers = new Headers();
    headers.set("X-Request-ID", "req-123");
    const error = new ApiError("Error", 500, "/api/v1/test", "internal_server_error", undefined, headers);
    const result = classifyError(error, "GET");
    expect(result.requestId).toBe("req-123");
  });

  it("ignores path parameter (no longer used)", () => {
    const error = new ApiError("Error", 500, "/api/v1/test?token=secret", "internal_server_error");
    const result = classifyError(error, "GET");
    // The classified error should not include the path
    expect(result.userMessage).toBe("The server encountered an error. Please try again.");
  });
});