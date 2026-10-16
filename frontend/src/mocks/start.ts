/**
 * Dev-only mock API starter (PRD §8.3).
 *
 * A freshly registered Service Worker does NOT control the page that
 * registered it, so first-visit API calls would bypass MSW (404s) until a
 * reload. To keep auth + consent deterministic, reload once when no
 * controller is present. Subsequent visits are already controlled.
 */
let started = false;

export async function startMocks(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV !== "development") return false;
  if (started) return true;
  started = true;
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
}
