# ResumeIQ Workspace — AI Resume Analyzer

Your truth, in every resume. Keep one private Master Workspace of everything you can
truthfully claim, keep a standard resume automatically synchronized, and generate
tailored, evidence-based resumes — with job-match analysis, skill gaps, ATS readability
and an improvement roadmap — for every application. Never fabricated: every claim traces
to workspace evidence.

## Folder map

- `/frontend` — the Next.js App Router app (all UI, mocks, tests, configs).
- `/backend` — the FastAPI app (milestone B0+).
- `/docs` — `PRD.md` (source of truth) and `DECISIONS.md` (architecture records).
- `/.github` — CI workflows.
- `/scripts` — development launchers (`dev.mjs`, `dev.ps1`).
- `/AGENTS.md` — working agreement for coding agents.

## Run locally

### Quick start (recommended)

```sh
# From repository root
npm run dev
```

This starts both servers:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Health**: http://localhost:8000/health
- **API Docs (dev only)**: http://localhost:8000/docs

The launcher (`scripts/dev.mjs`) automatically:
1. Checks that ports 3000 and 8000 are free
2. Runs `uv sync --frozen` in `/backend` if `uv.lock` is newer than `.venv`
3. Runs `npm ci` in `/frontend` if `package-lock.json` is newer than `node_modules`
4. Starts both servers with prefixed, colorized output
5. Waits for `/health` and the frontend root to respond
6. Prints the localhost URLs
7. On any failure, prints the last 15 log lines and exits non-zero
8. Shuts down both servers cleanly on Ctrl+C

Logs are written to the git-ignored `.dev-logs/` folder.

### PowerShell wrapper

```powershell
# From repository root
.\scripts\dev.ps1
```

The PowerShell wrapper (`scripts/dev.ps1`) performs the same environment and port checks,
then delegates to the Node.js launcher. It opens each server in its own window with `-NoExit`
so windows stay open on error. If the frontend fails to start once, it deletes
`frontend/.next` and retries once.

### Check-only mode

```sh
npm run dev:check
# or
.\scripts\dev.ps1 -CheckOnly
```

Runs all pre-flight checks (environment variables, ports, tooling) without starting servers.

### Manual start (if needed)

**Backend:**
```sh
cd backend
uv sync --frozen
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level info
```

**Frontend:**
```sh
cd frontend
npm ci
npm run dev -- --hostname localhost --port 3000
```

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `404` at `http://localhost:8000/` | **Normal** — the API root returns JSON, not HTML. Use `/health` or `/docs` (dev only). | Visit `http://localhost:8000/health` or `http://localhost:8000/docs`. |
| `ERR_CONNECTION_REFUSED` / "refused to connect" | Server is not running or crashed. | Check the backend/frontend window for errors. Run `npm run dev:check` to verify setup. |
| `npm ci` / `uv sync` fails after pulling | Lock files updated but dependencies not reinstalled. | Run `npm run dev` (auto-syncs) or manually: `cd frontend && npm ci` and `cd backend && uv sync --frozen`. |
| Frontend shows stale/old code | Next.js cache (`.next`) is stale. | Delete `frontend/.next` and restart: `rm -rf frontend/.next` (or use the launcher which retries once). |
| `Port 3000` or `Port 8000` already in use | Previous server didn't shut down cleanly. | Kill the process on that port (`lsof -ti:3000 | xargs kill` / `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess` in PowerShell) then restart. |
| Backend fails to start | Missing required env vars (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`). | Check `backend/.env` exists and has the required keys. The launcher prints which vars are missing. |
| Frontend shows "Application error" | Unhandled error in a component. | Check the browser console and the frontend window logs. The global error page has a "Try again" button. |

## Other commands (run inside `/frontend`)

- `npm run build` — Production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript type checking
- `npm run test` — Vitest unit tests
- `npm run e2e` — Playwright E2E tests (mocked)
- `npm run e2e:live` — Playwright E2E tests (live backend)
- `npm run budget` — Landing page budget check
- `npm run check:dev-excluded` — Verify dev-only code is excluded from production build

## Current phase

Frontend and backend proceed in parallel in separate folders (`/frontend` and `/backend`).
Frontend work still uses MSW mocks only; never call the real backend or any real AI API yet from frontend code.
Backend code lives in `/backend` (FastAPI, see docs/PRD.md section 10).
The OpenAPI file at `docs/api/openapi.json` (exported from the backend) is the contract between them:
frontend Zod schemas and MSW handlers must match it.

The default branch is `master`. Never merge to it without review — work on feature
branches and open PRs.