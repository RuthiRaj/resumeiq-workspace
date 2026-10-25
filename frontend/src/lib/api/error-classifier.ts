/**
 * Error classification for user-facing messages and retry logic.
 * Used by ErrorState, SyncIndicator and the retry layer.
 */
import { ApiError } from "./client";

export type ErrorKind =
  | "network"
  | "session_expired"
  | "rate_limited"
  | "server_error"
  | "supabase_unavailable"
  | "unknown";

export interface ClassifiedError {
  kind: ErrorKind;
  userMessage: string;
  technicalMessage: string;
  retryAfterMs?: number;
  httpStatus?: number;
  errorCode?: string;
  requestId?: string;
  /** True for idempotent reads (GET) that are safe to auto-retry. */
  isIdempotentRead: boolean;
}

/**
 * FastAPI error codes that map to our error kinds.
 * The backend uses these codes in the `detail.code` field.
 */
const SERVER_ERROR_CODES = new Set([
  "internal_server_error",
  "database_error",
  "validation_error",
  "unhandled_exception",
]);

const SUPABASE_ERROR_CODES = new Set([
  "supabase_unavailable",
  "supabase_connection_failed",
  "supabase_auth_failed",
  "supabase_rls_error",
]);

const NETWORK_ERROR_CODES = new Set(["network", "timeout", "connection_refused"]);

/**
 * Classify an error into a user-facing kind with appropriate messaging.
 * @param error The caught error (ApiError, TypeError, Response, or unknown)
 * @param method HTTP method of the request (for idempotency check)
 * @param path Request path (for context)
 * @returns ClassifiedError with user message, retry info, and technical details
 */
export function classifyError(
  error: unknown,
  method: string = "GET",
  path: string = ""
): ClassifiedError {
  // Handle ApiError from our client
  if (error instanceof ApiError) {
    return classifyApiError(error, method);
  }

  // Handle native fetch errors (network failures)
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return {
      kind: "network",
      userMessage:
        "Can't reach the ResumeIQ server. Is it running? In development start it with scripts/dev.ps1",
      technicalMessage: error.message,
      isIdempotentRead: isIdempotentMethod(method),
    };
  }

  // Handle Response objects (non-throwing fetch errors)
  if (error instanceof Response) {
    return classifyResponseError(error, method);
  }

  // Unknown error
  return {
    kind: "unknown",
    userMessage: "An unexpected error occurred. Please try again.",
    technicalMessage: error instanceof Error ? error.message : String(error),
    isIdempotentRead: isIdempotentMethod(method),
  };
}

function classifyApiError(
  error: ApiError,
  method: string
): ClassifiedError {
  const isIdempotent = isIdempotentMethod(method);
  const status = error.status;
  const code = error.code;

  // 401 - Session expired
  if (status === 401) {
    return {
      kind: "session_expired",
      userMessage: "Your session has expired. Please sign in again.",
      technicalMessage: error.message,
      httpStatus: status,
      errorCode: code,
      requestId: getRequestId(error.responseHeaders),
      isIdempotentRead: false,
    };
  }

  // 429 - Rate limited
  if (status === 429) {
    return {
      kind: "rate_limited",
      userMessage: "Too many requests. Please wait a moment and try again.",
      technicalMessage: error.message,
      retryAfterMs: error.retryAfterMs,
      httpStatus: status,
      errorCode: code,
      requestId: getRequestId(error.responseHeaders),
      isIdempotentRead: isIdempotent,
    };
  }

  // 502, 503, 504 - Server errors that might be transient
  if (status >= 502 && status <= 504) {
    const isSupabase = code && SUPABASE_ERROR_CODES.has(code);
    return {
      kind: isSupabase ? "supabase_unavailable" : "server_error",
      userMessage:
        isSupabase
          ? "The database service is temporarily unavailable. Please try again in a moment."
          : "The server encountered an error. Please try again.",
      technicalMessage: error.message,
      httpStatus: status,
      errorCode: code,
      requestId: getRequestId(error.responseHeaders),
      isIdempotentRead: isIdempotent,
    };
  }

  // 500 - Server error
  if (status === 500) {
    const isSupabase = code && SUPABASE_ERROR_CODES.has(code);
    return {
      kind: isSupabase ? "supabase_unavailable" : "server_error",
      userMessage:
        isSupabase
          ? "The database service is temporarily unavailable. Please try again in a moment."
          : "The server encountered an error. Please try again.",
      technicalMessage: error.message,
      httpStatus: status,
      errorCode: code,
      requestId: getRequestId(error.responseHeaders),
      isIdempotentRead: isIdempotent,
    };
  }

  // Other 4xx/5xx with known codes
  if (code && SERVER_ERROR_CODES.has(code)) {
    return {
      kind: "server_error",
      userMessage: "The server encountered an error. Please try again.",
      technicalMessage: error.message,
      httpStatus: status,
      errorCode: code,
      requestId: getRequestId(error.responseHeaders),
      isIdempotentRead: isIdempotent,
    };
  }

  // Network-related codes
  if (code && NETWORK_ERROR_CODES.has(code)) {
    return {
      kind: "network",
      userMessage:
        "Can't reach the ResumeIQ server. Is it running? In development start it with scripts/dev.ps1",
      technicalMessage: error.message,
      httpStatus: status,
      errorCode: code,
      requestId: getRequestId(error.responseHeaders),
      isIdempotentRead: isIdempotent,
    };
  }

  // Default: treat as server error for 5xx, unknown for 4xx
  if (status >= 500) {
    return {
      kind: "server_error",
      userMessage: "The server encountered an error. Please try again.",
      technicalMessage: error.message,
      httpStatus: status,
      errorCode: code,
      requestId: getRequestId(error.responseHeaders),
      isIdempotentRead: isIdempotent,
    };
  }

  return {
    kind: "unknown",
    userMessage: error.message || "An unexpected error occurred. Please try again.",
    technicalMessage: error.message,
    httpStatus: status,
    errorCode: code,
    requestId: getRequestId(error.responseHeaders),
    isIdempotentRead: isIdempotent,
  };
}

function classifyResponseError(
  response: Response,
  method: string
): ClassifiedError {
  const isIdempotent = isIdempotentMethod(method);
  const status = response.status;

  // Try to get request ID from headers
  const requestId = response.headers.get("x-request-id") ?? undefined;

  if (status === 401) {
    return {
      kind: "session_expired",
      userMessage: "Your session has expired. Please sign in again.",
      technicalMessage: "HTTP 401 Unauthorized",
      httpStatus: status,
      requestId,
      isIdempotentRead: false,
    };
  }

  if (status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    return {
      kind: "rate_limited",
      userMessage: "Too many requests. Please wait a moment and try again.",
      technicalMessage: "HTTP 429 Too Many Requests",
      retryAfterMs: retryAfter ? parseRetryAfterMs(retryAfter) : undefined,
      httpStatus: status,
      requestId,
      isIdempotentRead: isIdempotent,
    };
  }

  if (status >= 502 && status <= 504) {
    return {
      kind: "server_error",
      userMessage: "The server encountered an error. Please try again.",
      technicalMessage: `HTTP ${status} ${response.statusText}`,
      httpStatus: status,
      requestId,
      isIdempotentRead: isIdempotent,
    };
  }

  if (status === 500) {
    return {
      kind: "server_error",
      userMessage: "The server encountered an error. Please try again.",
      technicalMessage: "HTTP 500 Internal Server Error",
      httpStatus: status,
      requestId,
      isIdempotentRead: isIdempotent,
    };
  }

  if (status === 0 || status >= 500) {
    return {
      kind: "network",
      userMessage:
        "Can't reach the ResumeIQ server. Is it running? In development start it with scripts/dev.ps1",
      technicalMessage: `HTTP ${status} ${response.statusText}`,
      httpStatus: status,
      requestId,
      isIdempotentRead: isIdempotent,
    };
  }

  return {
    kind: "unknown",
    userMessage: "An unexpected error occurred. Please try again.",
    technicalMessage: `HTTP ${status} ${response.statusText}`,
    httpStatus: status,
    requestId,
    isIdempotentRead: isIdempotent,
  };
}

function isIdempotentMethod(method: string): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function getRequestId(headers?: Headers): string | undefined {
  if (!headers) return undefined;
  return headers.get("x-request-id") ?? headers.get("X-Request-ID") ?? undefined;
}

function parseRetryAfterMs(value: string): number | undefined {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
  }
  const at = Date.parse(value);
  if (!Number.isNaN(at)) {
    return Math.max(0, Math.min(at - Date.now(), 24 * 60 * 60 * 1000));
  }
  return undefined;
}