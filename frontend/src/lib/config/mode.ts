/**
 * Deployment mode (I1).
 *
 * `mock` is the default: MSW serves `/api/v1` and the mock auth client keeps
 * every existing demo and test working. `live` talks to the FastAPI backend
 * and Supabase Auth.
 *
 * These are functions, not module constants, so tests can flip the mode with
 * `process.env` without re-importing the module. Next still inlines each
 * `process.env.NEXT_PUBLIC_*` member expression at build time.
 */

export type ApiMode = "mock" | "live";

export function apiMode(): ApiMode {
  return process.env.NEXT_PUBLIC_API_MODE === "live" ? "live" : "mock";
}

export function isLiveMode(): boolean {
  return apiMode() === "live";
}

/** FastAPI origin. Ignored in mock mode (MSW serves the relative path). */
export function apiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL;
  const base = raw && raw.trim().length > 0 ? raw.trim() : "http://localhost:8000";
  return base.replace(/\/+$/, "");
}

export function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
}

/**
 * Publishable key only (`sb_publishable_…` or the legacy anon key). A service
 * role key must never be shipped to the browser; the no-secrets test fails the
 * build if one appears under `frontend/src`.
 */
export function supabasePublishableKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
}

/**
 * What is missing for live mode, as env variable *names* only. Returns `null`
 * when mock mode (nothing is required) or when live mode is fully configured.
 * Never includes a value, so it is safe to render.
 */
export function liveConfigProblem(): string | null {
  if (!isLiveMode()) return null;
  const missing: string[] = [];
  if (!supabaseUrl()) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!supabasePublishableKey()) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (missing.length === 0) return null;
  return `Live mode needs ${missing.join(" and ")}. See frontend/README.md.`;
}
