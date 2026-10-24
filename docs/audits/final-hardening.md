# Final hardening audit — ResumeIQ stack

- **Date:** 2026-10-24
- **Branch:** `audit/final-hardening`, branched from `master` at `c23f478`
- **Scope:** final hardening audit of the merged F0–F6 stack: every OpenAPI
  operation against a live backend, the full route set in a live browser at
  360 px and 1280 px, security/privacy review, secret scan, dependency audit,
  and the full quality gates.
- **Mode:** audit only. No application code was changed. The only additions are
  opt-in audit instruments (`backend/scripts/smoke_live.py` extension,
  `backend/scripts/security_probe.py`, `scripts/scan_secrets.py`,
  `frontend/tests/e2e-live/stack-health.spec.ts` extension) and this report.
- **Environment:** frontend in live mode on `http://localhost:3000`, backend on
  `http://127.0.0.1:8000`, dedicated backend on `http://127.0.0.1:8010` for
  the security/rate-limit and privacy log-capture runs. The real Supabase
  project and real AI providers were used through the existing test user A
  (and user B for the isolation check). No `.env` file was read or printed;
  only variable names/statuses from `check_env.py` were used.

## Verdict

**Conditional pass.** One major live defect blocks the F6 PDF export in the
browser: the backend CORS policy does not expose the `X-Export-*` response
headers, so the browser cannot read the server's extraction check and the UI
refuses every live export. The server generates and verifies the PDF correctly
(`X-Export-Text-Check: passed`). The fix is small and local (add
`expose_headers` to `CORSMiddleware`). No authentication, cross-user, RLS,
secret or privacy blocker was found.

| Area | Result |
| --- | --- |
| OpenAPI contract / auth on every operation | **Pass** — 33 paths, 38 protected operations, all 401 without a token |
| Live endpoint walk | **Pass** — 78-call account-deletion run and 88-call privacy run, both exit 0 |
| Cross-user isolation | **Pass** — B cannot list, read, delete or export A's resume |
| Browser route sweep | **Pass** — 28 routes × 2 widths, 5/5 tests, all counters zero |
| Live PDF export in the browser | **Fail** — CORS hides `X-Export-*`; UI refuses the download |
| Security headers / size limits / rate limiting | **Pass with minor hardening** |
| RLS on public tables | **Pass** — 18/18 enabled |
| Privacy of logs, PDF and uploads | **Pass with one minor logging finding** |
| Secret scan (tree + history) | **Pass** — no high-confidence secret patterns |
| Dependency audit | **At risk** — 15 advisory entries / 8 unique IDs in 3 Python packages; 0 npm production vulnerabilities |
| Quality gates | **Pass** — ruff, mypy, pytest, lint, 253 frontend tests, production build |

## 1. Endpoint coverage

`docs/api/openapi.json` contains **33 paths** and **38 operations that require
authentication**. The probe enumerated the running server's own
`/openapi.json` so it covered the mounted surface, not just the exported file.

- `GET /health` is public and returns 200.
- `/docs`, `/redoc` and `/openapi.json` are also public and return 200. This is
  useful locally and a minor production-hardening item (disable or protect
  them in production).
- Every one of the **38 protected operations** returned **401
  `missing_credentials`** without an `Authorization` header. No operation
  leaked data or a different status before the auth dependency ran.
- An invalid bearer token returned **401 `malformed_token`**; valid tokens for
  test users A and B resolved to different identities.

The live smoke (`backend/scripts/smoke_live.py`) walks every operation group in
order, including the B5/B6 additions that the earlier audit did not cover:

- workspace create/get/edit/reorder/soft-delete/restore/changelog;
- standard resume read; PDF export; refusal to delete the standard resume
  (`409 resume_not_tailored`);
- PDF and DOCX imports: create, list, get, edit extracted item, confirm;
- target create/list/get; analysis start, poll, report;
- capabilities (AI, reword, PDF, data export, data deletion, auth deletion);
- resumes list/get; tailored generation; version list/restore; stale flag;
  diff; workspace-item delete → `removedEvidenceIds`; purge; section edit;
  refresh (edited section skipped); version purge and delete; tailored PDF;
  data export; resume delete; account-deletion guard and deletion.

Results from the final account-deletion run:

| Check | Result |
| --- | --- |
| Calls | **78**, exit 0 |
| Standard PDF | 22,884 bytes, 2 sections, 8 claims, `check=passed`, missing 0 |
| Tailored PDF | 22,871 bytes, 2 sections, 6 claims, `check=passed`, missing 0 |
| Purge | 6 claims and 2 versions removed |
| Refresh | 1 section refreshed, 1 edited section skipped |
| Data export | 17 tables, 2,358 rows, 0 foreign rows |
| Cross-user | B list 200; B get/delete 404 `resume_not_found`; B export contains no A resume id |
| Account deletion guard | Wrong phrase → 400 `account_confirmation_required`; nothing deleted |
| Account deletion | 200, `deleted=True`, `tables=18`, `authUserDeleted=False`, `remainingStep=auth_user` |

The privacy log-capture run made 88 calls and also exited 0; the earlier
endpoint walk made 77 calls and exited 0. The extra calls in the privacy run
are the cross-user and export checks. The rate limiter returned 429 during the
long walks; the smoke retried using `Retry-After` (26 s, 13 s, 3 s, 1 s) and
still completed every step.

## 2. Browser sweep

`frontend/tests/e2e-live/stack-health.spec.ts` was run against the live
frontend/backend with a real signed-in session:

- **5/5 tests passed**, including the main actions, the 1280 px sweep, the
  360 px sweep, and the target-detail page at both widths.
- **28 routes × 2 widths**. The route set includes `/targets/{id}/resume`,
  which the earlier audit did not visit.
- Every route/width reported:
  `console=0 failed=0 hydration=0 axe=0 clipped=0 overlap=0 overflow=false`.
- No console errors, page errors, hydration warnings, axe violations,
  horizontal overflow, clipped controls or action-on-action overlaps.

### Earlier full live suite

The full non-destructive live suite (before the instrument fix below) reported
**8 passed, 1 failed**. The failure is the `privacy.spec.ts` PDF-export test:
it waits for a download, but the UI refuses because the CORS response hides
the `X-Export-*` check headers. This is the same major defect described in
§3.1, not a flaky test. The PDF response itself was 200 and the server-side
check was `passed`.

### 360 px overlap finding — instrument false positive, not an app defect

The first 360 px sweep reported 13 overlaps (settings buttons over bottom-nav
links, a target card over nav links, the job-description textarea over nav
links). A diagnostic showed that the app's scroll container
(`[data-app-scroll]`) ends exactly where the mobile navigation row starts, and
the content elements were **clipped** below that boundary. Their full
`getBoundingClientRect()` still extended into the nav row, but their visible
rects did not overlap it; `elementFromPoint` returned the nav because the
content was clipped away. The overlap check now clips every rect to its
overflow ancestors and the viewport before comparing. The rerun reported
**0 overlaps**. No page layout change is needed.

One earlier `/signup` run recorded `GET /onboarding failed`. The route
redirects a signed-in user from `/signup` to `/onboarding`; the request was a
navigation cancellation during that redirect. The rerun recorded 0 failed
requests. It is not a product defect.

## 3. Security

### 3.1 Major — CORS does not expose the PDF check headers

Evidence:

- A preflight from the configured origin succeeds and echoes the origin,
  methods and allowed headers (including `Authorization`).
- The actual PDF response carries `X-Export-Text-Check: passed` on the server,
  but **no `Access-Control-Expose-Headers`** header. `X-Export-Sections-*` and
  `X-Export-Claims-*` are equally invisible to the browser, as is
  `Content-Disposition`.
- The frontend's `parseExportCheck()` therefore returns `textCheck: "unknown"`;
  the fail-closed PDF button shows an alert and never calls `downloadBlob`.
  The live privacy test waits for a download and times out.

Impact: F6 PDF export is unusable from the browser in live mode, even though
the PDF is generated and verified correctly. The server-side check is a
product requirement and must remain fail-closed; the missing CORS exposure is
the defect.

Proposed fix (XS): add to the existing `CORSMiddleware` configuration in
`backend/app/main.py`:

```python
expose_headers=[
    "Content-Disposition",
    "X-Export-Text-Check",
    "X-Export-Sections-Checked",
    "X-Export-Sections-Missing",
    "X-Export-Claims-Checked",
    "X-Export-Claims-Missing",
    "X-Request-ID",
],
```

Add a regression test that sends `Origin: http://localhost:3000` to the PDF
route and asserts `Access-Control-Expose-Headers` contains the five
`X-Export-*` names. Re-run `privacy.spec.ts` after the fix; it should pass.

### 3.2 Minor — PDF UI copy contradicts the refused state

`describeExportCheck()` returns “The PDF was downloaded, but the server did not
report its text-extraction check.” for the `unknown` case. In the CORS failure
the UI has **not** downloaded anything and the alert says so, so the copy
contradicts the action. Proposed fix (XS): use a “the PDF was not downloaded”
variant for the refused path, or pass a `delivered` flag to
`describeExportCheck()`.

### 3.3 Minor — `httpx` INFO logs full Supabase REST URLs

The privacy capture had 346 app JSON lines. 244 were `httpx` “HTTP Request”
lines; 240 contained a Supabase REST URL and 212 contained `user_id=eq.`
filters. They contain the project ref, table/column names and user IDs, but
**no request bodies, resume text, job text, tokens or PDF bytes**. This is log
noise and a future query-string leak risk. Proposed fix (XS): in
`setup_logging()`, set `httpx` and `httpcore` to `WARNING`:

```python
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
```

### 3.4 Minor — rate limit is tight for a full flow

The limiter is **60 requests/minute per IP** and works as designed: it returns
`429 rate_limited` with `Retry-After`, and the frontend backs off for analysis
polling. The full endpoint walk needed 77–88 calls and hit the limit, forcing
retries. A person doing a complete create → import → target → analysis →
resume → export flow can reach it, especially with autosave and polling.
Proposed fix (S): raise the default to ~120/minute or add per-route budgets;
the shared-store replacement is already tracked by ADR-009. This is tuning,
not a correctness defect.

### 3.5 Minor — response/server hardening

- Every response advertises `Server: uvicorn`. Minor information disclosure;
  run uvicorn with `--no-server-header` or strip it at the proxy.
- `/docs`, `/redoc`, `/openapi.json` are public. Disable them in production or
  protect them at the edge.
- No `Strict-Transport-Security` header. This is expected on local HTTP; set
  HSTS at the TLS terminator in production.
- Security headers are present on 200, 401, 413 and 429 responses:
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `Content-Security-Policy`; `X-Request-ID` is present.
- CORS rejects a foreign origin (no `Access-Control-Allow-Origin`; preflight
  400) and does not allow credentials.

### 3.6 Request-size limits

- Default 1 MiB cap: oversized workspace request → **413
  `payload_too_large`**.
- Import cap (5 MiB + 8 KiB): oversized import → **413
  `payload_too_large`**.
- Security headers and `X-Request-ID` remain present on both 413 responses.

### 3.7 RLS

Catalog query over `public` tables:

- **18 public tables**, all with `relrowsecurity = true`.
- Policy counts range from 2 to 4 per table.
- None has `relforcerowsecurity`; this is not a defect here because table
  owners bypass RLS by design and PostgREST accesses tables as
  `authenticated`, which is subject to the policies. No public table lacks
  RLS.

### 3.8 SECURITY DEFINER functions (reviewed, intentional)

The Supabase security advisor reports two `SECURITY DEFINER` functions
executable by `authenticated`:

- `api_account_delete_data()` — takes no user id, resolves `auth.uid()`, sets
  `search_path = public, pg_temp`, and deletes all 18 public tables for that
  user in dependency order. Reviewed: intentional and safe.
- `api_resume_version_purge(...)` — also scopes by `auth.uid()` and sets
  `search_path`; it rewrites exactly one snapshot for the caller. Residual
  risk (minor, own data only): a signed-in user can call the RPC directly
  through the Data API and replace their own version snapshot with arbitrary
  JSON, bypassing the backend's grounding validation. It cannot touch another
  user's data. Proposed fix (S): revoke `EXECUTE` from `authenticated` and
  have the backend call it with the service role, or document the accepted
  risk.

  **Hardening pass 2026-10-24 — risk explained, no migration added.** The
  function predicate is `id = p_version_id AND resume_id = p_resume_id AND
  user_id = auth.uid()`; a caller therefore can only ever rewrite a snapshot
  they already own, and an unknown id is a silent no-op. The only integrity
  effect is that the caller's own version history can hold JSON the backend did
  not generate, which could later be restored or exported. That is not a
  cross-user leak: the same person can already type arbitrary content into
  their own workspace. There is no safe migration-only fix. Revoking `EXECUTE`
  from `authenticated` would break the backend purge route, which deliberately
  calls the RPC with the caller's JWT and never a service-role key (ADR-016);
  moving it to the service role is a backend + secret-management change.
  Replacing the RPC with one that takes removed evidence ids and rebuilds the
  snapshot server-side would fix the write surface, but it needs coordinated
  SQL, repository and contract changes — not a small `0009`. No `0009` is
  written or applied; the risk is accepted and recorded here. If resume
  snapshots ever become attested artefacts, migrate to the server-side rebuild
  RPC and revoke direct execution.

Other advisor output: leaked-password protection is disabled (operator
setting; enable it in production) and four indexes are unused (performance
only, not a security defect).

## 4. Privacy

### 4.1 Code review

- No `print(` calls in the backend application.
- No `tempfile`, `NamedTemporaryFile`, `TemporaryDirectory`, `open(...)` or
  `.write(...)` in the application package.
- PDF rendering uses `io.BytesIO` and returns `Response(content=...)` with
  `Cache-Control: no-store`; the PDF is never written to disk.
- Import extraction parses PDF/DOCX bytes in memory and discards the upload;
  there is no Supabase Storage or bucket usage.
- Logging extras are IDs, counts, types and contract codes only. The JSON
  formatter whitelist drops unknown extras; `msg` never contains document
  text.

### 4.2 Live log capture

A fresh backend on port 8010 ran the full smoke flow; the captured app log
was scanned with counts only:

| Pattern | Matches |
| --- | --- |
| JWT-like | 0 |
| `Bearer ` | 0 |
| `@example.com` | 0 |
| Synthetic resume marker | 0 |
| Job-text marker | 0 |
| `%PDF` | 0 |
| API-key / service-role words | 0 |
| `password` / `authorization` words | 0 |
| Non-JSON lines | 0 |
| ERROR lines | 0 |
| Suspicious keys (`body`, `text`, `headers`, `token`, `email`, …) | 0 |

The only keys observed were `ts`, `level`, `logger`, `msg`, `request_id`,
`method`, `path`, `status`, `duration_ms`, plus AI metrics (`provider`,
`model`, `task`, `attempt`, `valid`, `prompt_tokens`, `completion_tokens`,
`latency_ms`). The `httpx` INFO issue is described in §3.3.

### 4.3 Deletion and uploads

- Account deletion removes all **18** public tables, including
  `resume_versions` and `change_log` (verified in
  `backend/db/migrations/0008_privacy.sql` and by the live `tables=18`
  response). The wrong confirmation phrase is refused with 400 and deletes
  nothing.
- The **auth identity remains**: `authUserDeleted=False`,
  `remainingStep=auth_user`, and capabilities report `deleteAuth=False`. The
  UI must not claim “account deleted”; deleting the auth user needs a
  service-role follow-up that is not built yet.
- Uploads are not persisted; PDFs are not persisted; no storage bucket is
  used.

## 5. Secret scan

`scripts/scan_secrets.py` scanned **438 tracked files** and the full
`git log -p --all` history. It prints counts only; no matched value or file is
printed.

- Tracked env-like files: **3**, all examples (`backend/.env.example`,
  `backend/.env.test.example`, `frontend/.env.example`). They were not read
  for values; a high-confidence pattern count over them returned 0 for JWT,
  OpenAI/Groq/NVIDIA keys and service-role assignments.
- `.env` and `.env.local` are ignored by git; no real `.env` file appears in
  history (only the three example paths).
- No JWT, OpenAI/Groq/NVIDIA/GitHub/AWS keys, private keys, service-role
  assignments or postgres URLs with passwords were found in the working tree
  or history.
- The only matches are test/documentation fixtures: 3 bearer test strings in
  2 files, 28 password-label fixtures in 10 files, 59 email fixtures in 26
  files; history has 3 bearer lines, 34 password lines and 257 email lines.
  None is a live credential.

## 6. Dependencies

- **Frontend production dependencies:** `npm audit --omit=dev` → **0
  vulnerabilities** (info 0, low 0, moderate 0, high 0, critical 0).
- **Backend:** `pip-audit` reports **15 advisory entries / 8 unique IDs** in
  3 packages:
  - `certifi 2026.7.22` — PYSEC-2026-4320; fix `2026.10.19`.
  - `pytest 8.4.2` — PYSEC-2026-1845; fix `9.0.3` (development only).
  - `starlette 0.48.0` — six unique IDs (PYSEC-2026-1942, -161, -2281, -2280,
    -249, -248); fixes range from `0.49.1` to `1.3.1`.
- Starlette is pinned through FastAPI; moving to the fully fixed release
  requires a FastAPI compatibility pass, not a blind bump. Certifi is a patch
  upgrade. Pytest is not shipped in production.
- No advisory was exploited during this audit; this is dependency risk to
  schedule, not an observed vulnerability.

## 7. Quality gates

| Gate | Command | Result |
| --- | --- | --- |
| Backend lint | `uv run ruff check .` | pass |
| Backend types | `uv run mypy .` | pass, 131 files |
| Backend tests | `uv run pytest -q` | pass, exit 0 |
| Frontend lint | `npm run lint` | pass |
| Frontend tests | `npm run test -- --run` | 40 files / 253 tests pass |
| Frontend build | `npm run build` | pass, Next.js 16.4.2, 32 routes |

The only gate failure during the audit was the new probe's return type
(`no-any-return`); it was fixed in the audit script, not in application code.

## 8. Real defects vs not built yet

### Real defects (fix before calling F6 complete)

| # | Severity | Defect | Fix size |
| --- | --- | --- | --- |
| 1 | **Major** | CORS does not expose `X-Export-*` / `Content-Disposition`; live PDF export is refused by the UI | XS |
| 2 | Minor | “The PDF was downloaded…” copy in the refused state | XS |
| 3 | Minor | `httpx` INFO logs full Supabase REST URLs with user-ID filters | XS |
| 4 | Minor | 60/min rate limit is tight for a full flow; smoke retried | S |
| 5 | Minor | `Server: uvicorn` header; public `/docs`, `/redoc`, `/openapi.json`; no HSTS (deployment) | XS |
| 6 | Minor (accepted risk) | `api_resume_version_purge` can rewrite the caller's own snapshot via direct RPC | S |
| 7 | Dependency risk | Certifi, pytest (dev) and starlette advisories | M |

### Not built yet / known limitations

- **Auth-user deletion** (`deleteAuth=False`): public data is removed, but the
  Supabase auth identity (email, password hash, metadata) remains. Requires a
  service-role endpoint and a capability flag; the current UI/capability
  correctly reports that auth deletion is unavailable.
- **HSTS/TLS termination**, production CORS origins, docs disabling and
  leaked-password protection are deployment/operator settings, not
  application logic.
- **Shared rate-limit store**: the in-memory limiter is a single-process
  placeholder (ADR-009); a multi-replica deployment needs Redis or equivalent.
- **Dependency upgrades** are scheduled work, not an application defect.
- **Test-user residue**: 15 `@example.com` Supabase auth users remain from the
  audit runs. User A's public data was deleted; the auth identities must be
  removed by the operator in Supabase Authentication → Users.

### Reviewed and not a defect

- The 13 initial 360 px overlaps were measurement false positives (content
  clipped by `[data-app-scroll]`); the instrument now clips to overflow
  ancestors and the rerun is clean.
- The `/signup` failed request was a navigation cancellation during the
  signed-in redirect to `/onboarding`; the rerun is clean.
- The two `SECURITY DEFINER` advisor warnings are expected for the intentional
  RPCs; both scope by `auth.uid()` and set `search_path`. Only the version
  purge has the residual own-data risk noted above.
- RLS `forced=false` is not a defect because table owners bypass RLS by
  design and PostgREST uses the `authenticated` role.

## 9. Commands and evidence

```powershell
cd backend
uv run ruff check .
uv run mypy .
uv run pytest -q
$env:RUN_LIVE_SMOKE="1"; $env:SMOKE_BASE_URL="http://127.0.0.1:8000"
$env:SMOKE_DELETE_ACCOUNT="1"; uv run python scripts/smoke_live.py
$env:RUN_LIVE_SECURITY="1"; $env:SECURITY_BASE_URL="http://127.0.0.1:8010"
uv run python scripts/security_probe.py

cd frontend
npm run lint
npm run test -- --run
npm run build
$env:RUN_LIVE_E2E="1"
npx playwright test -c playwright.live.config.ts stack-health.spec.ts
```

- Endpoint smoke: 78 calls (account deletion), 88 calls (privacy capture), 77
  calls (earlier), all exit 0.
- Security probe: 38/38 protected operations 401; 9 raw findings, consolidated
  in §3; rate limiter 429 with `Retry-After`.
- Browser: 28 routes × 2 widths, 5/5 tests, all counters zero. Full live suite
  earlier: 8 passed, 1 failed (the CORS PDF test).
- Logs/probe output: `%TEMP%\opencode\security-probe.txt`,
  `smoke-account-delete.txt`, `smoke-privacy.txt`,
  `backend-8010-privacy.out.log` (counts only in this report).
- Route/target JSON: `%TEMP%\opencode\live-audit-evidence\` (git-ignored
  Playwright output copied before the next run overwrote `test-results`).
- No `.env` file was read or printed; no token, password, resume text or job
  text appears in this report.

## 10. Limitations

- `auth-flows.spec.ts` was not run in the final sweep to avoid creating more
  throwaway Supabase users. Sign-in/sign-out and the live session are covered
  by the unit tests and the existing live suite.
- The browser PDF-export test cannot pass until the CORS fix lands; it was
  intentionally left failing rather than weakening the fail-closed UI.
- Security/privacy probes ran on a dedicated 8010 backend so the rate-limit
  probe did not block the 8000 browser session; the rate-limit counts are
  therefore per-process and include the probe's own earlier calls.
- HSTS/TLS, production CORS origins and multi-replica rate limiting cannot be
  verified on the local HTTP stack.
- `pip-audit` counts duplicate advisory entries; the report also states the 8
  unique IDs.

## 11. Proposed next actions

1. **Fix CORS** (`expose_headers`) and add the PDF header regression test.
2. Re-run `privacy.spec.ts` and the full live suite; expect 9/9.
3. Fix the PDF “unknown” copy and silence `httpx`/`httpcore` INFO logs.
4. Tune the rate limit or add per-route budgets; keep the shared-store plan.
5. Harden the deployment: `--no-server-header`, disable/protect docs, HSTS at
   the proxy, production CORS origins, leaked-password protection.
6. Schedule certifi/pytest/starlette upgrades; test the FastAPI/Starlette
   compatibility jump before bumping.
7. Decide on the version-purge RPC: service-role call with revoked
   `authenticated` execute, or document the accepted own-data risk.
8. Build auth-user deletion (service role) and flip `deleteAuth` only when it
   works end to end.
9. Operator cleanup: remove the 15 `@example.com` Supabase auth users.

**Bottom line:** the merged stack is internally consistent, authenticated,
RLS-protected, secret-clean and privacy-conscious. It is **not ready to call
F6 complete in live mode** until the CORS expose-headers fix lands; after that
one small fix, the live PDF path and the remaining hardening items are
straightforward.
