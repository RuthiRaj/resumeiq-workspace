# Stack health audit — 2026-10-20

Branch: `audit/stack-health` (created from `master` at `dcbff66`; `master` equalled
`origin/master` when the audit started).
Scope: read-only audit of the Next.js frontend, the FastAPI backend and the
OpenAPI/Zod contract between them. No application code was changed. Two opt-in
audit instruments and this report were added:

- `backend/scripts/smoke_live.py` — live endpoint walker, gated by `RUN_LIVE_SMOKE=1`.
- `frontend/tests/e2e-live/stack-health.spec.ts` — live UI audit, gated by
  `RUN_LIVE_E2E=1` plus user A credentials. The existing live smoke was moved
  from `frontend/tests/live` to `frontend/tests/e2e-live` and
  `playwright.live.config.ts` now points there.

No `.env` file was opened, printed or copied. Only variable names, HTTP status
codes, counts and paths appear below; tokens, passwords and response bodies are
not included.

## Verdict

| Severity | Count |
| --- | ---: |
| Blocker | 0 |
| Major | 5 |
| Minor | 9 |
| **Total defects** | **14** |

All CI gates are green: ruff, ruff format, `mypy app`, 311 backend tests,
eslint, tsc, 142 unit tests and the production build. The live endpoint smoke
completed 45/45 expected calls. The live UI sweep covered 26 routes at 1280px and
360px with zero console errors, zero WCAG 2.0/2.1 A/AA violations from axe, zero
horizontal overflow and zero clipped actions. The defects are mostly
live-mode copy that still describes the mock build, plus two integration
behaviours (polling rate and session expiry).

## Environment and gates

| Item | Value |
| --- | --- |
| OS / shell | Windows, PowerShell |
| Python / uv | 3.14.0 / 0.10.9 |
| Node / npm | v24.11.1 / 11.17.0 |
| Next.js | 16.4.2 (Turbopack) |
| git | 2.53.0.windows.2 |
| Backend | `uv run uvicorn app.main:app --host 127.0.0.1 --port 8000`; `/health` → `200 {"status":"ok","version":"0.1.0"}` |
| Frontend | live mode (`NEXT_PUBLIC_API_MODE=live`, `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`), dev server on 3000 |
| Env check | `backend/scripts/check_env.py` exit 0: runtime Supabase URL/key set; test gate and user A (+ optional B) set; Groq and NVIDIA keys set; integration tests would run |

| Gate | Command | Result |
| --- | --- | --- |
| Backend lint | `uv run ruff check .` | pass, 108 files |
| Backend format | `uv run ruff format --check .` | pass, 108 files |
| Backend types | `uv run mypy app` | pass, 72 files |
| Backend types (tests) | `uv run mypy app tests` | **86 errors** (test-only typing debt; CI runs `mypy app`) |
| Backend tests | `uv run pytest` | **311 passed, 0 failed, 0 skipped** in 67.20s; 1 third-party deprecation warning |
| Frontend lint | `npm run lint` | exit 0 |
| Frontend types | `npm run typecheck` | exit 0 |
| Frontend unit tests | `npm run test` | **16 files, 142 tests passed** |
| Frontend build | `npm run build` | exit 0; 31 static/prefetched routes |

The Supabase integration gate was active during pytest, so the 311 tests include
the live integration tests (not skipped).

## Live runs

### Endpoint smoke (`backend/scripts/smoke_live.py`)

Final run: **45 calls, exit 0**. It walks `/health`, `/api/v1/me`, workspace
create/read/update/create/reorder/delete/restore, changelog, standard resume,
PDF and DOCX imports (upload, list, get, PATCH, confirm), targets
(create/list/get), consent lookup/insert, analysis start/poll/report, then
cleans up. The produced report had score 31, 4 requirements and ATS 81.
Cleanup removed 4 workspace items, 2 import sessions, 1 target and 1 consent
row. `change_log` and `workspace_versions` rows are append-only and remain by
design.

Two runs inside one 60-second window produced
`GET /api/v1/targets/{id}/analysis/run → 429 rate_limited` after 34 calls. The
script now honours `Retry-After` (up to 60s) instead of failing; the underlying
default limit is still 60 requests/minute per IP (finding S-04).

### Live UI (`frontend/tests/e2e-live/stack-health.spec.ts`)

Run A — route sweeps and the existing live smoke:

- 4 tests, 3 passed, 1 failed in 7.1m.
- The failure was a selector bug in the new spec (`getByRole("button", { name:
  "Close" })` matched both the sheet footer button and the X button). It is an
  audit-instrument bug, not a product defect; fixed with `{ exact: true }` and
  re-run.
- 26 concrete routes × 2 widths. No console errors, no hydration *console*
  warnings, no axe violations (WCAG 2.0/2.1 A/AA), no horizontal overflow, no
  clipped actions.
- One hydration mismatch surfaced as a page error on `/workspace/skill` at
  360px (S-06).
- Two requests were cancelled during authenticated redirects
  (`GET /workspace failed`, `GET /onboarding failed`, no status). They are
  navigation cancellations, not failed API calls.
- `/resume` and `/targets/new` at 360px had 4 and 5 action-overlap pairs with
  the fixed bottom navigation (S-11).

Run B — action flow and `/targets/[id]`:

Run B — action flow and `/targets/[id]` (after fixing the spec, not the app):

- A first attempt failed on the reorder assertion: the account already had rows
  from earlier attempts, so \"first row in the section\" was the wrong check.
  The spec now asserts relative order (second above first). Audit-instrument
  bug, not a product defect.
- The next attempt passed every action in 34.5s: add, edit with autosave
  (\"Saved at\"), reorder, delete, import a synthetic PDF, edit the imported
  title, confirm, create a target, accept consent, and run the analysis. The
  report rendered (\"Match score and factors\").
- Cleanup then deleted 0 rows because it counted before the section list
  rendered. After waiting for `workspace-list`, the final run passed in 33.2s
  (42.3s total) and deleted 8 workspace items.
- The created `/targets/[id]` was audited at 1280px and 360px: status 200,
  console=0, pageErrors=0, failed=0, hydration=0, axe=0, clipped=0,
  overlap=0, overflow=false (9.0s / 11.0s).
- The consent gate appeared again in the final run even though the previous run
  had already recorded a grant (two granted rows existed). That is the loading
  race in S-09, now reproduced against the live Data API.
- After the runs, a one-off Data API cleanup removed the test rows: 10
  workspace rows (including 2 soft-deleted), 2 import sessions, 2 targets and
  2 consent rows. Counts verified back at zero. `change_log` and
  `workspace_versions` rows are append-only and remain by design.


## Defects

Severity: **blocker** = stops a core flow or risks data; **major** = breaks or
misleads a core flow for a class of users; **minor** = cosmetic, dev-only or
self-healing. Sizes are XS (< 1h), S (half day), M (1–2 days).

| ID | Area | Symptom | Evidence (status/log lines only) | Severity | Suspected cause | Proposed fix | Size |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-01 | Frontend · auth copy | On `/signin`, live mode still tells the user passwords are mock-only and never leave the browser. The shared auth footer says Supabase Auth "replaces this layer at backend integration". | `frontend/src/app/signin/page.tsx:128` "Passwords are mock-only in this milestone and stay in your browser."; `frontend/src/features/auth/auth-card.tsx:46-49` footer rendered on signin/signup/forgot-password; OAuth buttons are correctly hidden in live mode. | Major | Mock-era copy was gated for OAuth buttons only; the hint and footer were never conditioned on `isLiveMode()`. | Gate both strings on `isLiveMode()`; live copy: password handled by Supabase Auth, session stored by Supabase. Add a copy test per mode. | XS |
| S-02 | Frontend · auth copy | `/forgot-password` says no email is actually sent, but live mode calls `resetPasswordForEmail`. | `frontend/src/app/forgot-password/page.tsx:42`; `frontend/src/lib/auth/supabase.ts:215-217` calls `supabase.auth.resetPasswordForEmail`; route sweep `/forgot-password` → 200. | Major | Same unconditional mock copy. | Mode-specific description; when live, state that Supabase sends the reset link and mention the redirect URL. | XS |
| S-03 | Frontend · imports | During live upload/extraction the page says "This is a simulated extractor in this build — no file leaves your browser", while the PDF is sent to FastAPI. | `frontend/src/features/imports/import-review.tsx:205-207`; smoke `POST /api/v1/imports` → 201 (PDF and DOCX); ADR-033 §8 claims live import copy says the server read the document. | Major | The stage-progress note was missed when the demo banner and sample tags were gated. | Use the existing `live` flag: "Your file is sent to the local extractor and only the extracted text is stored." | XS |
| S-04 | Frontend ↔ backend · analysis | The UI polls the analysis run every 300 ms, which is 200 requests/minute, while the backend allows 60 requests/minute per IP. A run longer than ~18s, a shared NAT, or two tabs will hit 429; the client has no 429 handling. | `frontend/src/features/targets/use-targets.ts:77-78` (`refetchInterval: 300`); `backend/app/core/config.py:48` (`rate_limit_per_minute: int = 60`); `backend/app/main.py:250`; observed smoke `GET /targets/{id}/analysis/run → 429 rate_limited` after 34 calls in an overlapping window. | Major | Poll interval chosen for the 5s mock run (ADR-023) was not revisited when the real backend acquired a per-IP limiter. | Poll at 1–2s (or use SSE/long-poll); exempt the run-status GET from the limiter; add `Retry-After` backoff on 429. | S |
| S-05 | Frontend · session | If the Supabase refresh fails, the API client sends no bearer token. Screens show the backend's raw 401 message ("Missing bearer token.") and never redirect to sign-in; the auth provider does not subscribe to auth-state changes. | `frontend/src/lib/auth/supabase.ts:141-147` returns `null` on refresh failure; `backend/app/api/deps.py:168` `missing_credentials`; `frontend/src/lib/auth/context.tsx:50,66-83` resolves once on mount; no `onAuthStateChange` anywhere in `frontend/src`; the only 401 branches are in the mock auth client (`lib/auth/client.ts:20,54`) and MSW handlers. | Major | Auth state is resolved once; 401 is treated as a generic API error. | Subscribe to `onAuthStateChange`; intercept 401 in the API client, clear the session and redirect to `/signin?next=…` with a "session expired" message. | S |
| S-06 | Frontend · app shell | Intermittent hydration mismatch: the server HTML contains the AuthGuard "Checking your session" skeleton, while the client hydrates the authenticated AppShell. React regenerates the tree. | Live audit, `/workspace/skill` @ 360px, pageErrors=1. Diff: client `className="flex min-h-screen bg-bg text-text"` + `<aside data-app-chrome>` vs server `className="flex flex-col gap-3 py-10" role="status" aria-label="Checking your session"`; stack `at AppShell (src/components/app-shell.tsx:303)`. 1 occurrence in 52 document loads. | Minor | The first client commit can already be `authenticated` (Supabase session read) while SSR always renders `status="loading"`; the auth status is not hydration-safe. | Render the guard on a post-mount flag (or `useSyncExternalStore` with a `loading` server snapshot) so the first client render matches SSR; add a live/mock regression test. | S |
| S-07 | Frontend · workspace error state | When the backend is down, the workspace error tells the user to "check the mock failure toggle in the dev bar" — a control that is hidden in live mode and does not exist there. | `frontend/src/features/workspace/workspace-dashboard.tsx:128`; `frontend/src/features/workspace/dev-bar.tsx:31-33` returns `null` in live mode. | Minor | Static mock-era error copy. | Live copy: check the connection / try again. Keep the dev-bar sentence only when `!isLiveMode()`. | XS |
| S-08 | Frontend · analysis | A failed run poll is silent: `runQuery.isError` is never rendered. The theatre keeps the last run and retries every 300 ms, with no "connection lost" state or backoff. | `frontend/src/features/targets/target-analysis.tsx:41-54,155-167` (no error branch); `frontend/src/features/targets/use-targets.ts:79` `retry: false`; 429 evidence in S-04. | Minor | Poll errors were assumed to be transient; the mock never failed a poll. | Show a non-blocking inline notice after N consecutive failures with a retry button; back off on 429. | S |
| S-09 | Frontend · consent / slow Supabase | The consent gate renders before the consent lookup resolves, and there is no loading or lookup-error state; a slow or unavailable Data API looks like "no consent". Auth and consent calls have no timeout, so a hung request leaves "Signing in…" or the gate waiting. | `frontend/src/features/targets/target-analysis.tsx:41,139`; `frontend/src/features/targets/target-form.tsx:77,121-123,317-338` (`showGate && !consentGranted` is true while the query is loading); `frontend/src/lib/privacy/live-consent.ts:48-66`; live run: a second target submission still showed the gate although a granted row existed from the previous run, and a second grant row was inserted; `frontend/src/lib/api/client.ts:131-158` has no `AbortSignal`; `frontend/src/app/signin/page.tsx` awaits `signIn` with no timeout. | Minor | No query-state branch for the gate; fetch has no deadline. | Render a skeleton/status while `consentQuery.isLoading`; show a retryable error when the lookup fails; add timeouts/AbortSignal for auth and consent. | S |
| S-10 | Frontend · privacy copy | The Privacy consent card says "No consent recorded yet — visit onboarding to record one", although the same card has the buttons to record it. | `frontend/src/app/(app)/privacy/privacy-content.tsx:85`, buttons at lines 88-99. | Minor | Copy written before the card gained its own controls. | "No consent recorded yet — use the buttons below." | XS |
| S-11 | Frontend · mobile layout | At 360px, the fixed bottom navigation overlays the only action on `/resume` ("Back to your workspace") and covers the job-description textarea at the fold on `/targets/new`. | Live audit: `/resume` `overlap=4` (`a(Back to your workspace) ∩ a(Workspace)`, `∩ a(Standard resume)`, plus the nested button); `/targets/new` `overlap=5` (`textarea[target-jd] ∩` each nav item). Shell: `frontend/src/components/app-shell.tsx:353` (`pb-20` on the column), `386-390` (`fixed … bottom-0 … md:hidden`). | Minor | The 80px column padding does not reserve space for the last control on short pages; the bottom nav is drawn over content at the current scroll position. | Add bottom padding to the page container (or `scroll-padding-bottom`) and verify the last control clears the nav at 360px; consider hiding the nav while a form field is focused. | XS |
| S-12 | Frontend · placeholder pages | Every placeholder wraps a `<button>` inside an `<a>` (`<Link><Button>`), which is invalid interactive nesting and produces two focus stops for one destination. | `frontend/src/components/placeholder-page.tsx:49-53` (used by `/resume`, `/history`, `/settings`); `frontend/src/app/(app)/privacy/privacy-content.tsx:95-99` uses the same pattern; the live audit recorded both `a(Back to your workspace)` and `button(Back to your workspace)`. | Minor | The component bypassed the existing `LinkButton` pattern. | Use `LinkButton` (or an anchor styled as a button) instead of `Link + Button`; add the pattern to the design-system lint/DX notes. | XS |
| S-13 | Frontend · targets (dev) | In a live `next dev` session, `/targets/new` offers "Load a sample posting (development fixtures)"; clicking it inserts fictional job descriptions into a real target. Production hides it (`NODE_ENV`), so this is dev-only. | `frontend/src/features/targets/target-form.tsx:196-208` (only `NODE_ENV === "development"`); route sweep `/targets/new` @ 360/1280 → 200. | Minor | Fixture control was not additionally gated on live mode. | Add `&& !isLiveMode()`, or label the fixtures as dev-only and keep them out of live QA runs. | XS |
| S-14 | Backend · typing | `mypy app tests` fails with 86 errors, all in test code. CI does not run this target, so it is invisible debt. | Command output: `mypy app tests` → 86 errors, exit 1; `mypy app` → success. | Minor | Test fixtures/helpers are not typed to the same level as the app. | Type the shared helpers and add `mypy app tests` to CI once the count is zero (or an explicit ignore list). | M |

### Notes on evidence

- S-04's 429 was reproduced by the live smoke, not by the UI sweep: the UI
  sweep pauses 65s before each pass and 4s between routes, deliberately keeping
  the limiter quiet so UI findings are not masked by 429s.
- S-06's diff is copied from the Next dev server's forwarded hydration error;
  the full entry is in `test-results/live-audit/routes-360.json`
  (git-ignored). It is a page error, not a console warning, which is why the
  per-route `hydration=0` counters do not show it.
- S-11 measures overlap at the initial scroll position. `pb-20` lets the page
  scroll, so this is not a hard block on long pages; on `/resume` the button is
  the page's only action and sits under the bar at 360px.

## Not built yet (not defects)

These are deliberate milestone gaps, documented in ADR-033 or the PRD; they are
listed so they are not confused with the defects above.

| Item | Evidence | Status |
| --- | --- | --- |
| Standard resume preview and saved-version history | `/resume` and `/history` render `PlaceholderPage` ("Coming in F5"); `GET /resume/standard` is consumed by the workspace sync indicator (`useSyncStatus`), but there is no preview/editor or version list | F5 |
| Settings and full privacy centre | `/settings` renders "Coming in F6"; `/privacy` has the live consent card and the F2 privacy slice, while export and account deletion are explicitly "still to come" | F6 |
| Tailored resume, version list, data export, account deletion | Backend OpenAPI has no `/targets/{id}/resume`, `/resumes`, `/privacy/export`, `DELETE /privacy/account`; client methods reject with `not_available_in_live_mode` (501) | Backend milestone |
| Consent endpoint | No OpenAPI route; live mode reads/writes `consent_records` through the Supabase Data API with the user's JWT (ADR-033 §6) | Accepted workaround |
| OAuth sign-in in live mode | Buttons are hidden when `isLiveMode()`; no provider configured | Not built |
| OCR for scanned PDFs | Import empty state says scanned pages need OCR, which is not part of this build | Not built |
| Skills-card confirm | One card becomes N skill items via `POST /workspace/items`, then PATCH confirmed; documented gap (ADR-033 §5) | Accepted gap |
| Billing / pricing / credits | Deliberately absent from the product | By design |
| Cleanup of append-only history | `change_log` and `workspace_versions` rows cannot be deleted by RLS; the smoke documents this | By design |

## Contract cross-check (OpenAPI ↔ Zod)

`docs/api/openapi.json` is OpenAPI 3.1.0 with **17 paths and 52 schemas**. The
frontend's live client validates every response body with a Zod schema
(`frontend/src/lib/api/client.ts`), so a shape mismatch would appear as an
`invalid_response` 502 or a screen error. The endpoint smoke and the live UI
flows exercised every response schema the UI consumes with no validation
failures.

| Check | Result |
| --- | --- |
| Paths the frontend calls in live mode | All exist: workspace CRUD/reorder/changelog, standard resume, imports (upload/list/get/PATCH/confirm), targets create/list/get, analysis start/run/report, `/me`, `/health` |
| Endpoints expected by client methods but absent from OpenAPI | Tailored resume, version history, privacy export/account deletion (501 by design); consent (Data API instead). No live UI calls them except consent |
| Envelope | Backend `{detail:{code,message}}` is parsed correctly; network failure becomes `ApiError(status 0, code "network")`; unparseable 2xx becomes 502 `invalid_response` |
| `AnalysisReport.aiUsed` | Backend sends it; frontend strips it by design (ADR-033 §4/§5) — accepted deviation |
| Optionality | Backend marks report collections and `ImportSession.items` optional; Zod supplies `.default([])`. Serialized backends always include them, so no failure path was observed |
| PATCH import values | Backend `ImportItemValues` fields are optional/defaulted; the frontend type requires them. The UI always sends full values; accepted |
| `TargetCreate.company` | Backend defaults to `""`; the frontend sends `""` when blank; compatible |
| Change-log `op` | Backend enum includes `restore`; the Zod enum includes it. The comment in `frontend/src/lib/schemas/workspace.ts:96-101` still claims the wire maps restore→edit — stale comment, no runtime mismatch |

## Mock-only surfaces in live mode

| Surface | Live behaviour | Finding |
| --- | --- | --- |
| Auth footer + sign-in password hint | Still claims mock-only credentials | S-01 |
| Forgot-password description | Still claims no email is sent | S-02 |
| Upload/extraction note | Still claims the file never leaves the browser | S-03 |
| Workspace error copy | Still points at the mock failure toggle | S-07 |
| Privacy empty-consent copy | Points to onboarding | S-10 |
| Target fixture picker | Visible in live **dev** builds | S-13 |
| Dev bar, simulated-failures banner, import demo banner/sample tags, sample-targets button, OAuth buttons | Correctly hidden in live mode | — |

## Error paths

| Path | Observed/expected behaviour | Verdict |
| --- | --- | --- |
| Backend down | `fetch` → `ApiError(status 0, "network")`; workspace/targets/import show `ErrorState` with retry; workspace copy is wrong (S-07) | Handled, copy defect |
| Expired/invalid token | Backend 401 `token_expired`/`missing_credentials`; client shows the raw message, no redirect; refresh failure returns `null` token | S-05 |
| Upload rejected (type/size/parse) | Backend 413 `import_file_too_large` (or `payload_too_large` at the body cap), 415 `import_file_type_unsupported`, 400 `import_file_rejected`, 422 `values_invalid`; the import page shows the server message and a retry | Handled |
| Analysis run fails | Theatre names the failed stage and code, offers retry; POST is the only re-run path | Handled |
| Report fetch fails | `ErrorState` with retry | Handled |
| 429 during analysis poll | No client handling; theatre can freeze on the last poll; retries at 300 ms | S-04, S-08 |
| Supabase slow/unreachable during consent | Gate renders before the lookup resolves; no lookup-loading/error state; no timeout | S-09 |
| Supabase slow during sign-in | Button stays in "Signing in…" with no deadline | S-09 |

## Residue and limits

- The test rows created by the live UI runs were removed after the audit with a
  one-off Data API cleanup (10 workspace rows including 2 soft-deleted, 2 import
  sessions, 2 targets, 2 consent rows; verified counts back at zero). Append-only
  `change_log` and `workspace_versions` rows remain by design. This is
  test-account data only.
- The action-test failures in Run A and the first Run B attempt were bugs in the
  audit instrument (a selector collision and a section-order assumption), not
  product defects; the fixed spec passed on the next attempts.
- The route sweep deliberately waits 65s before each pass and 4s per route to
  keep the per-IP rate limiter quiet, so it does not reproduce S-04; the smoke
  does.
- `gh` is not authenticated in this environment, so the branch was pushed with
  plain `git` and the PR was not opened automatically.
- No application code was modified. The only repo changes are the two opt-in
  audit instruments, the live config path update, the moved live smoke and this
  report.
