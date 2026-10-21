"use client";

import { useEffect, useState } from "react";
import { isLiveMode } from "@/lib/config/mode";

/** Live mode talks to the real API, so MSW must stay out of the way (I1). */
export const MOCKS_REQUIRED = process.env.NODE_ENV === "development" && !isLiveMode();

/**
 * Starts the browser mock worker (when required) and reports when it is ready.
 *
 * Screens can render their server HTML immediately and only enable
 * interactions once this is true; nothing must fire an API call early (a
 * passthrough 404 would look like an empty session, see ADR-014).
 */
export function useMockBackendReady(): boolean {
  const [ready, setReady] = useState(!MOCKS_REQUIRED);

  useEffect(() => {
    if (!MOCKS_REQUIRED) return;
    let cancelled = false;
    void import("@/mocks/start")
      .then(({ startMocks }) => startMocks())
      .catch(() => false)
      .then(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
