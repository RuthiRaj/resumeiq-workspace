# ResumeIQ Workspace — frontend

Next.js App Router + React + TypeScript (strict) app for the AI Resume Analyzer
Workspace. See `/docs/PRD.md` (repo root) — it is the source of truth — and
`/AGENTS.md` for the working agreement.

## Develop

```sh
npm install
npm run dev        # http://localhost:3000
```

Mock mode is the default: MSW serves `/api/v1` and the mock auth client runs, so
no backend or Supabase project is needed for normal UI work.

## Always open http://localhost:3000

Use `http://localhost:3000`, not a LAN address such as
`http://192.168.1.20:3000`, for normal development. Next.js only serves its
development assets (`/_next/...`, HMR, the React runtime) to `localhost` and to
the hostname the dev server was started with. Opening the same server through a
different IP makes those requests fail, so the page shows its server HTML but
never hydrates: buttons stay inert, the auth forms stay in their safe
pre-hydration state, and the app looks broken.

The auth forms are deliberately safe when that happens: every form with an
email or password field uses `method="post"` with a non-submitting action, and
its submit button is disabled until hydration, so a broken page cannot send
credentials as URL query parameters. Auth URLs that arrive with
credential-looking parameters are redirected to a scrubbed URL by
`src/proxy.ts` before the route renders, and `CredentialQueryGuard` repeats the
cleanup with `history.replaceState` for client-side navigations.

Nothing in the app logs request URLs, and the Playwright auth-URL test asserts
that the browser console and follow-up requests never see the secret. The
`next dev` terminal still prints the raw request line before the proxy runs
(server-side, local-only); in production, redact query strings on auth paths in
the reverse-proxy access log.

### Testing from a phone on the same network

Phones can only reach the dev server at your machine's LAN IP, which is exactly
the origin Next.js blocks by default. If you need that, opt in **locally** with
`allowedDevOrigins` in `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  // ...existing options
  allowedDevOrigins: ["192.168.1.20"],
};
```

Use only the hostname: no `https://`, no port, no path. The dev server already
allows `localhost` and the hostname it was started with. Wildcards are limited
to whole labels (`*.local-origin.dev`, `**.local-origin.dev`), and `**` is only
valid at the start. Restart `npm run dev` after changing the file.

This setting is intentionally **not enabled by default**: it lets other origins
request development-only assets and endpoints, so keep it to your own LAN IP,
do not commit it, and remove it when you are done. See the Next.js
`allowedDevOrigins` reference for the full matching rules.

## Live mode (I1)

Live mode talks to the FastAPI backend on **port 8000** and Supabase Auth. It is
opt-in; mock mode and all existing tests are unchanged.

1. Start the backend (see `backend/README.md`):

   ```sh
   cd backend
   uv sync
   uv run uvicorn app.main:app --reload --port 8000
   ```

2. Create `frontend/.env.local` (git-ignored) with these **names** only — never
   commit values, and never use a secret or `service_role` key in the frontend:

   | Variable | Purpose |
   |---|---|
   | `NEXT_PUBLIC_API_MODE` | set to `live` (anything else, including unset, means mock) |
   | `NEXT_PUBLIC_API_BASE_URL` | backend origin, `http://localhost:8000` |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **publishable** key (`sb_publishable_…` or legacy anon) |

   `frontend/.env.example` documents the same names.

3. Start the frontend:

   ```sh
   cd frontend
   npm run dev        # http://localhost:3000
   ```

4. CORS: the backend allows `http://localhost:3000` by default. If you override
   it, `CORS_ORIGINS` must contain that exact origin (comma-separated, no
   wildcard).

What changes in live mode:

- Sign up / sign in / sign out / password reset / session refresh use Supabase
  Auth; the access token is sent as `Authorization: Bearer …` to the API.
- Workspace, change log, items, restore, reorder, standard resume, imports,
  targets, analysis runs and reports call FastAPI. Every response is validated
  with the Zod schemas in `src/lib/schemas`.
- Mock-only surfaces are hidden: the workspace dev bar, simulated failures, the
  sample-targets button, the "Sample" import tags and the simulated-demo banner.
  OAuth buttons are hidden too (not configured for live yet).
- Tailored resumes, history, data export and account deletion are not in the
  backend yet; those calls fail with a clear "not available in live mode" error
  instead of silently pretending to work. AI-processing consent is written
  directly to `consent_records` under RLS.

### Opt-in live E2E

The Playwright suite (`npm run e2e`) stays mock-only. A separate smoke test
exists for live mode and is skipped unless you opt in:

```sh
# The gate and user A credentials come from backend/.env.test (git-ignored):
#   RUN_LIVE_E2E=1
#   SUPABASE_TEST_EMAIL_A / SUPABASE_TEST_PASSWORD_A
npm run e2e:live
```

Exported `RUN_LIVE_E2E`, `LIVE_E2E_EMAIL` and `LIVE_E2E_PASSWORD` still override
the file (useful in CI). It starts the backend (8000) and the live dev server
(3000) itself; the spec signs in with Supabase and loads the workspace from
FastAPI. Nothing has to be typed into the terminal, and no value is printed.

## Verify

```sh
npm run lint
npm run typecheck
npm run test       # Vitest
npm run e2e        # Playwright (installs browsers on first run)
npm run build
npm run budget     # "/" initial-JS gzip budget check (ADR-005)
```

Key routes: `/` (cinematic landing), `/design-system` (tokens + components),
`/workspace`, `/resume`, `/targets`, `/history`, `/privacy`, `/settings`.
