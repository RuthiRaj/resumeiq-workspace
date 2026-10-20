"use client";

import { useSyncExternalStore } from "react";

/** No external store: the value only changes from server snapshot to client. */
function subscribe() {
  return () => {};
}

/**
 * True only after the client has hydrated.
 *
 * Components whose first client render can differ from the server (a session
 * read from localStorage, `matchMedia`, the clock) use this to keep the
 * hydration render identical to the server HTML. `useSyncExternalStore` is the
 * supported way to do that: React renders the server snapshot during
 * hydration and re-renders with the client snapshot immediately after.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
