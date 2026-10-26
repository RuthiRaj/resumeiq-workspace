"use client";

import { useState, useCallback, useEffect } from "react";
import { shouldRetryOnColdStart, MAX_RETRY_DURATION_MS } from "./retry";
import { onColdStart } from "./cold-start-events";

/**
 * Hook to track cold-start retry state for the "server is waking up" UI.
 * Only active in live mode when the API base URL is not localhost.
 */
export function useColdStartState() {
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [wakeUpStartTime, setWakeUpStartTime] = useState<number | null>(null);

  useEffect(() => {
    if (!shouldRetryOnColdStart()) return;
    const offRetry = onColdStart("retry", () => {
      setIsWakingUp(true);
      if (wakeUpStartTime === null) {
        setWakeUpStartTime(Date.now());
      }
    });
    const offSuccess = onColdStart("success", () => {
      setIsWakingUp(false);
      setWakeUpStartTime(null);
    });
    const offExhausted = onColdStart("exhausted", () => {
      setIsWakingUp(false);
      setWakeUpStartTime(null);
    });
    return () => {
      offRetry();
      offSuccess();
      offExhausted();
    };
  }, [wakeUpStartTime]);

  // Compute elapsed time for UI
  const elapsedMs = wakeUpStartTime ? Date.now() - wakeUpStartTime : 0;
  const remainingMs = Math.max(0, MAX_RETRY_DURATION_MS - elapsedMs);
  const isExhausted = isWakingUp && remainingMs <= 0;

  return {
    isWakingUp,
    isExhausted,
    elapsedMs,
    remainingMs,
  };
}

/**
 * Hook to track "run lost on restart" state.
 * When a long-running operation (like analysis) is interrupted by a cold start,
 * the server may lose the run state. This hook tracks that condition.
 */
export function useRunLostState() {
  const [isRunLost, setIsRunLost] = useState(false);

  const markRunLost = useCallback(() => {
    setIsRunLost(true);
  }, []);

  const clearRunLost = useCallback(() => {
    setIsRunLost(false);
  }, []);

  return {
    isRunLost,
    markRunLost,
    clearRunLost,
  };
}

/**
 * Combined hook for cold-start aware components.
 */
export function useApiResilience() {
  const coldStart = useColdStartState();
  const runLost = useRunLostState();

  return {
    ...coldStart,
    ...runLost,
    // True if either cold start is happening or run was lost
    isRecovering: coldStart.isWakingUp || runLost.isRunLost,
  };
}