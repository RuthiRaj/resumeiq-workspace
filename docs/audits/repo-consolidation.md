# Repository Consolidation Audit

Generated: 2026-10-25

## Branch Status Summary

| Branch | Purpose | Unique Commits | Status | Risks | Recommended Merge Order |
|--------|---------|----------------|--------|-------|-------------------------|
| `origin/master` | Main development line | — | **Merged** (tip: 1178e4f) | Includes PR #35 + PR #36 | Base |
| `origin/fix/load-error-clarity` | Error handling, sync indicator, dev status chip, print fix | 1 (`5b3fec9`) | **Needs work** | 3 pre-existing e2e test failures (ui-qa, workspace-audit); conflicts in 3 files with master | 1st (after resolving conflicts) |
| `origin/fix/resume-document-layout` | Resume document layout work | 0 (at merge-base 43bbcf3) | **Superseded/Empty** | No unique commits; already at merge-base with master | N/A |
| `chore/dev-experience` | Dev launcher, root endpoint, error pages, README, budget fix | 2 (`51078eb`, `91b916e`) | **Merged** (via PR #36 into master) | +7 KB gzip budget from global-error/not-found in landing bundle; Ctrl+C fix uses taskkill on Windows | Already merged |

## Detailed Analysis

### origin/fix/load-error-clarity
- **Tip**: 5b3fec9 (2026-10-25 15:50:18 +0530)
- **Merge-base with master**: d56cf1f
- **Ahead/Behind**: 1 ahead, 7 behind master
- **Unique commit**: `5b3fec9 fix(load-error-clarity): resolve pre-existing test failures and verify live stack`
- **Conflicts with master** (3 files):
  - `frontend/src/features/resume/export-actions.tsx` (export status height)
  - `frontend/tests/e2e-live/privacy.spec.ts` (PDF download vs page.pdf())
  - `frontend/tests/e2e/ui-qa.spec.ts` (error state assertions)
  - `frontend/tests/e2e/workspace-audit.spec.ts` (error state assertions)
- **Pre-existing test failures** (also fail on first parent of #35, 6844ea7):
  1. `ui-qa.spec.ts:344` — "the banner's one-click turn-off restores the app" — `getByText('Couldn't load your workspace')` not visible
  2. `ui-qa.spec.ts:484` — "route sweep at 768px" — axe violation: scrollable-region-focusable on `/history`
  3. `workspace-audit.spec.ts:212` — "surfaces a designed error state when the mock API fails" — `getByText('Couldn't load your workspace')` not visible
- **Load-error-clarity commits ancestry**:
  - `23c3331` ✅ ancestor of master, fix/load-error-clarity
  - `d56cf1f` ✅ ancestor of master, fix/load-error-clarity
  - `5b3fec9` ❌ NOT ancestor of master, ✅ ancestor of fix/load-error-clarity only

### origin/fix/resume-document-layout
- **Tip**: 43bbcf3 (2026-10-24 23:38:34 +0530)
- **Merge-base with master**: 43bbcf3 (same as tip)
- **Ahead/Behind**: 0 ahead, 9 behind master
- **Unique commits**: None — branch is exactly at merge-base
- **Status**: Superseded/empty — no work to merge

### chore/dev-experience (merged via PR #36)
- **Tip**: 91b916e
- **Merged into master**: 1178e4f
- **Changes**:
  - `scripts/dev.mjs` — Node.js dev launcher with prefixed logs, health waits, Ctrl+C cleanup (taskkill /T /F on Windows, process groups on POSIX)
  - Root `package.json` with `dev` / `dev:check` scripts
  - `scripts/dev.ps1` — PowerShell wrapper with auto-sync, -NoExit, .next retry
  - Backend GET `/` endpoint with `{"service":"ResumeIQ API","status":"ok","health":"/health"}` + `docs` only in development
  - Frontend `not-found.tsx` (server component) + `global-error.tsx` (minimal client component)
  - E2E tests for error pages (3 passing)
  - README "Run locally" + troubleshooting table
  - `.gitattributes` linguist-vendored for scripts/*.ps1
- **Budget impact**:
  - First parent of #35 (6844ea7): **197.4 KB gzip** (11 chunks, uses Next.js built-in global-error)
  - origin/master (with PR #36): **204.5 KB gzip** (12 chunks, +7.1 KB)
  - Extra chunks from chore/dev-experience:
    - `00dq8qo-ns3ep.js` (4.2 KB gzip) — global-error.tsx custom chunk
    - `21poqdgvjdll4.js` (3.2 KB gzip) — not-found.tsx entry (server component but has client entry)
  - **Manifest evidence**: On 6844ea7, landing page uses `[project]/node_modules/next/dist/client/components/builtin/global-error.js`. On master, `[project]/src/app/global-error.tsx` appears in `clientModules` with custom chunks. `not-found.tsx` is a server component but still generates a client entry chunk (`21poqdgvjdll4.js`).
  - **Cannot be avoided**: Next.js App Router mandates root-level `global-error.tsx` and `not-found.tsx` be included in every page's initial JS bundle for error boundary hydration. The custom global-error replaces the built-in one; not-found as server component still emits a client entry. Mitigation: minimal imports (no Button, no lucide-react), inline SVGs.

## Test Results Summary (on origin/master / 1178e4f)

### Backend (377 passed, 20 skipped)
- ✅ ruff check
- ✅ ruff format --check
- ✅ mypy app
- ✅ pytest (377 passed, 20 skipped - integration tests require Supabase)

### Frontend
- ✅ lint
- ✅ typecheck
- ✅ unit tests (265 passed)
- ⚠️ mock e2e (1 worker): **67 passed, 3 failed** (all 3 pre-existing from before PR #35)
  - `ui-qa.spec.ts:344` — simulated failures banner test
  - `ui-qa.spec.ts:484` — route sweep 768px axe violation
  - `workspace-audit.spec.ts:212` — error state test
- ✅ build
- ✅ budget: **204.5 KB gzip** (budget 215 KB)
- ✅ check:dev-excluded

### Live Tests
- ❌ `check_test_users.py` — requires Supabase config (missing in test env)
- ❌ `smoke_live.py` — requires RUN_SUPABASE_INTEGRATION=1 and credentials
- ❌ `e2e:live` — skipped (requires live backend)

## Recommended Merge Order

1. **origin/fix/load-error-clarity** → Resolve 3 file conflicts, fix/accept 3 pre-existing e2e failures, then merge
2. **origin/fix/resume-document-layout** → No action needed (empty)
3. **chore/dev-experience** → Already merged (PR #36)

## Cleanup

Stopped all test servers. Ports 3000, 3001, 8000 confirmed free.