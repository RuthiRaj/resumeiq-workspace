/**
 * Dev-only mock API starter (PRD §8.3).
 *
 * A freshly registered Service Worker does NOT control the page that
 * registered it, so first-visit API calls would bypass MSW (404s) until a
 * reload. To keep auth + consent deterministic, reload once when no
 * controller is present. Subsequent visits are already controlled.
 *
 * `startMocks` memoizes the in-flight promise: React StrictMode runs mount
 * effects twice, and a bare "already started" boolean made the second call
 * resolve *before* the worker was intercepting. That let protected screens
 * fire `getSession()` early, receive a passthrough 404, bounce through
 * `/signin` and tear down client state (see ADR-014). Every caller must wait
 * on the same promise, which only settles once the worker is actually ready.
 */
import { isLiveMode } from "@/lib/config/mode";

let pending: Promise<boolean> | null = null;

export function startMocks(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (process.env.NODE_ENV !== "development") return Promise.resolve(false);
  if (isLiveMode()) return Promise.resolve(false);
  if (!pending) {
    pending = (async () => {
      try {
        const { worker } = await import("./browser");
        // MSW v3: start() takes no options (see ADR-002) — call it bare.
        await worker.start();
        if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
          window.location.reload();
          return false;
        }
        return true;
      } catch {
        // Mock worker is optional; the app renders honest error states without it.
        return false;
      }
    })();
  }
  return pending;
}
