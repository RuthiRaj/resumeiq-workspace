"use client";

import { useEffect, useState } from "react";
import { CircleAlert, RefreshCw, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { classifyError, type ErrorKind } from "@/lib/api/error-classifier";

/** Error state with a working retry, error classification, and details disclosure (PRD §7.7). */
export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  retrying = false,
  className,
  /** HTTP method of the failed request (for auto-retry eligibility). */
  method = "GET",
  /** The raw error from the query/mutation. */
  error: rawError,
  /** Maximum auto-retry attempts for eligible errors. */
  maxAutoRetries = 3,
  /** Base delay for exponential backoff (ms). */
  baseRetryDelay = 1000,
  /** Optional test ID for the root element. */
  testId,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  method?: string;
  error?: unknown;
  maxAutoRetries?: number;
  baseRetryDelay?: number;
  testId?: string;
}) {
  const [autoRetryCount, setAutoRetryCount] = useState(0);
  const [autoRetrying, setAutoRetrying] = useState(false);

  // Classify the error (pure function, safe to call during render)
  const classified = rawError ? classifyError(rawError, method) : null;
  const isIdempotentRead = classified?.isIdempotentRead ?? isIdempotentMethod(method);
  const canAutoRetry = isIdempotentRead && shouldAutoRetry(classified?.kind);
  const hasRetriesLeft = autoRetryCount < maxAutoRetries;

  // Auto-retry with exponential backoff
  useEffect(() => {
    if (canAutoRetry && hasRetriesLeft && !retrying && !autoRetrying && onRetry) {
      const delay = baseRetryDelay * Math.pow(2, autoRetryCount);
      const timeout = setTimeout(() => {
        setAutoRetrying(true);
        setAutoRetryCount((c) => c + 1);
        onRetry();
        // Reset autoRetrying after a tick to allow next retry cycle
        setTimeout(() => setAutoRetrying(false), 100);
      }, delay);
      return () => clearTimeout(timeout);
    }
  }, [canAutoRetry, hasRetriesLeft, retrying, autoRetrying, onRetry, autoRetryCount, baseRetryDelay]);

  // Determine the user-facing message
  const userMessage = classified?.userMessage ?? description ?? "An unexpected error occurred. Please try again.";
  const technicalMessage = classified?.technicalMessage;
  const httpStatus = classified?.httpStatus;
  const errorCode = classified?.errorCode;
  const requestId = classified?.requestId;
  const retryAfterMs = classified?.retryAfterMs;

  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn(
        "glass flex flex-col items-start gap-3 rounded-md border-l-2 border-evidence-missing p-4 sm:p-6",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <CircleAlert className="size-5 shrink-0 text-evidence-missing" aria-hidden="true" />
        <h2 className="text-sm font-medium text-text">{title}</h2>
      </div>
      <p className="max-w-prose text-sm leading-relaxed text-muted">{userMessage}</p>

      {/* Technical details disclosure */}
      {technicalMessage && (
        <details className="w-full max-w-prose" open={false}>
          <summary className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
            <span>Details</span>
            <ChevronDown className="size-3.5" />
          </summary>
          <div className="mt-2 text-xs font-mono text-muted bg-elevated/50 rounded-sm p-2 whitespace-pre-wrap break-all">
            {httpStatus && <div>Status: {httpStatus}</div>}
            {errorCode && <div>Code: {errorCode}</div>}
            {requestId && <div>Request ID: {requestId}</div>}
            {retryAfterMs && <div>Retry after: {Math.ceil(retryAfterMs / 1000)}s</div>}
            <div>Method: {method}</div>
            {technicalMessage && <div>Message: {technicalMessage}</div>}
          </div>
        </details>
      )}

      {/* Retry button */}
      {(onRetry || canAutoRetry) && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setAutoRetryCount(0);
            onRetry?.();
          }}
          disabled={retrying || autoRetrying}
          aria-busy={retrying || autoRetrying}
        >
          <RefreshCw className={cn("size-4", (retrying || autoRetrying) && "animate-spin")} aria-hidden="true" />
          {retrying
            ? "Retrying…"
            : autoRetrying
              ? `Retrying… (attempt ${autoRetryCount}/${maxAutoRetries})`
              : "Try again"}
        </Button>
      )}

      {/* Rate limit specific message */}
      {classified?.kind === "rate_limited" && retryAfterMs && !retrying && !autoRetrying && (
        <p className="text-xs text-evidence-related">
          Automatic retry in {Math.ceil(retryAfterMs / 1000)}s…
        </p>
      )}
    </div>
  );
}

function isIdempotentMethod(method: string): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function shouldAutoRetry(kind?: ErrorKind): boolean {
  return kind === "network" || kind === "server_error" || kind === "supabase_unavailable";
}