import { defineConfig, devices } from "@playwright/test";

/**
 * Opt-in live E2E (I1). Not part of `npm run e2e`: that suite stays mock-only.
 *
 * `RUN_LIVE_E2E=1` starts the FastAPI backend (port 8000) and the Next dev
 * server in live mode (port 3000). The spec itself skips unless
 * LIVE_E2E_EMAIL / LIVE_E2E_PASSWORD are set, because a live run needs a real
 * Supabase account. Names only — values are never written here.
 */
const enabled = process.env.RUN_LIVE_E2E === "1";

const frontendEnv: Record<string, string> = {
  NEXT_PUBLIC_API_MODE: "live",
  NEXT_PUBLIC_API_BASE_URL:
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000",
};
// Only forward Supabase variables that are actually exported. Leaving them out
// lets Next read the git-ignored `frontend/.env.local` instead of overriding it
// with an empty string.
if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  frontendEnv.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
}
if (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  frontendEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

export default defineConfig({
  testDir: "./tests/live",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 180_000,
  use: {
    baseURL: process.env.LIVE_E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: enabled
    ? [
        {
          command: "uv run uvicorn app.main:app --port 8000",
          cwd: "../backend",
          url: "http://localhost:8000/health",
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: "npm run dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            ...frontendEnv,
          },
        },
      ]
    : undefined,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
