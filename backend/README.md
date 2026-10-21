# ResumeIQ backend (FastAPI) — B0 scaffold + B1 workspace API + B2 import parsing + B3 AI gateway

B0: app scaffold, Supabase JWT auth (`GET /api/v1/me`), `GET /health`, security
defaults, Postgres schema + RLS, OpenAPI contract export, Docker, CI.

B1: the workspace API under `/api/v1` (items across all sections, evidence
states, attachment metadata, per-user versioning + append-only change log,
soft-delete/restore/reorder) and the deterministic standard-resume sync. No AI
calls, no document parsing, no job analysis (those are B2+).

B2: real PDF/DOCX parsing for the import review flow (PRD §6.2 IM-1..IM-3). The
upload is sniffed on magic bytes, parsed **in memory** by a deterministic section
parser (no OCR, no AI) and discarded — only the extracted text and the candidate
items are stored. Nothing reaches the workspace until the user confirms an item,
and confirming runs through one transactional RPC (`api_import_confirm`). See
ADR-028.

## Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (preferred). Without uv: `python -m venv .venv`
  + `pip install -e ".[dev]"` (no lockfile in that path — prefer uv).

## Setup

```bash
cd backend
uv sync            # creates .venv and installs locked deps (uv.lock)
cp .env.example .env              # runtime; fill in Supabase values; never commit
cp .env.test.example .env.test    # optional: only for the integration tests
```

## Run

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
# GET http://localhost:8000/health
# GET http://localhost:8000/api/v1/me  (Authorization: Bearer <Supabase JWT>)
# Docs: http://localhost:8000/docs
```

## Run with the frontend (live mode)

Run the API on port **8000** and the Next.js app on port **3000**:

```bash
# terminal 1 (backend)
cd backend
uv run uvicorn app.main:app --reload --port 8000

# terminal 2 (frontend)
cd frontend
npm run dev        # http://localhost:3000
```

The frontend uses these variable **names** in `frontend/.env.local` (values are
never committed): `NEXT_PUBLIC_API_MODE=live`, `NEXT_PUBLIC_API_BASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. See
`frontend/README.md` for the walkthrough.

CORS: `CORS_ORIGINS` is an exact, comma-separated allowlist with no wildcard.
The default already includes `http://localhost:3000`; add it explicitly if you
override the list. The frontend sends the Supabase access token as
`Authorization: Bearer …`, so the backend verifies it against the project's
JWKS exactly as it does for any other client.

## Checks (all must pass)

```bash
cd backend
uv run ruff check . && uv run ruff format --check .
uv run mypy app
uv run pytest
python scripts/export_openapi.py   # keep docs/api/openapi.json in sync (CI-tested)
```

With plain pip instead of uv: `python -m venv .venv && .venv/bin/activate`
(Windows: `.venv\Scripts\activate`) then `pip install -e ".[dev]"`.

## Configuration

`.env.example` lists every runtime variable (no real values committed), grouped
as **App**, **CORS**, **Supabase**, **AI providers** and **Limits**, each with a
comment. The **AI providers** group is **optional**: the backend starts with no
provider key, and an AI call then fails with the typed `ai_not_configured` error
instead of reaching the network. Adding a key is all that is needed to enable
live calls (see the AI gateway section below).

- The app **fails fast at startup**: if a required variable is missing it exits
  with a message naming it (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) — a value
  is never printed (see `app/core/config.py`).
- `SUPABASE_URL` derives the JWKS URL
  (`{url}/auth/v1/.well-known/jwks.json`) and expected issuer
  (`{url}/auth/v1`); both overridable via `SUPABASE_JWKS_URL` /
  `SUPABASE_JWT_ISSUER`.
- `SUPABASE_JWT_SECRET` enables the **legacy HS256 fallback only**. Prefer
  asymmetric signing keys; the docs strongly discourage local HS256
  verification (see `app/api/deps.py` header + ADR-010).
- `CORS_ORIGINS` is an exact allowlist (comma-separated). No wildcard.
- `SUPABASE_PUBLISHABLE_KEY` is the Data API `apikey` header (publishable/anon
  key). Workspace queries also send the **caller's JWT**, so RLS applies; the
  `service_role` key is never used (ADR-016).
- `MAX_IMPORT_BYTES` (default 5 MiB) caps an import upload. It is enforced both
  by `RequestSizeLimitMiddleware` for `{API_V1_PREFIX}/imports` (which streams
  the body, so an oversized upload is rejected before it is buffered) and by the
  import service.
- `EXTRACTION_TIMEOUT_SECONDS` (default 8.0) bounds a single document parse; the
  deadline is checked inside the page/block loops, so a pathological file cannot
  hold a worker indefinitely.

### Integration-test environment

Integration-test credentials are **not** part of the runtime `.env`: they live in
`backend/.env.test` (git-ignored; copy `.env.test.example`), so a deployed backend
never holds test passwords. `RUN_SUPABASE_INTEGRATION=1` there opts into the
integration tests; see Tests below.

### Check your environment

`scripts/check_env.py` reports which required variables are **set or missing** for
the app and for the tests — names only, never values:

```bash
cd backend
uv run python scripts/check_env.py
uv run python scripts/check_env.py --strict   # exit 1 if an app variable is missing
```

## API (B1–B5)

All workspace/resume endpoints require `Authorization: Bearer <Supabase JWT>` and
mirror the F3 mock contract (`frontend/src/mocks/handlers.ts`):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/workspace` | current version + active items |
| GET | `/api/v1/workspace/changelog` | append-only log, newest first |
| GET | `/api/v1/workspace/items/{id}` | a single active item |
| POST | `/api/v1/workspace/items` | create (201) |
| PATCH | `/api/v1/workspace/items/{id}` | partial update |
| DELETE | `/api/v1/workspace/items/{id}` | soft delete (204) |
| POST | `/api/v1/workspace/items/{id}/restore` | undo a soft delete |
| POST | `/api/v1/workspace/reorder` | one version bump (WS-6) |
| GET | `/api/v1/resume/standard` | deterministic standard resume |

Every mutation bumps the per-user workspace version exactly once and appends a
`change_log` row in the same transaction. `verified` items must carry a supporting
document or link (enforced in the models *and* in SQL). Wire↔DB mappings and the
known mismatches are in ADR-016/ADR-017.

Import endpoints (B2, contract in `docs/api/contract-proposals.md` §2):

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/imports` | multipart `file` (PDF/DOCX) → `201 {"import": ImportSession}` |
| GET | `/api/v1/imports` | recent imports (list rows, no document text) |
| GET | `/api/v1/imports/{import_id}` | one session with its review items |
| PATCH | `/api/v1/imports/{import_id}/items/{item_id}` | edit `values`/`status`/`support` |
| POST | `/api/v1/imports/{import_id}/items/{item_id}/confirm` | create the workspace item (201) |

Error codes: `import_file_required` (400), `import_file_rejected` (400 — empty,
damaged, zip bomb or over a cap), `import_file_too_large` (413),
`import_file_type_unsupported` (415 — the bytes do not match the name),
`extraction_unavailable` (503), `import_not_found` / `import_item_not_found`
(404), `values_invalid` (422). Extraction reports per-field `confidence` and a
1-based `sourceLine`; a scanned or empty document returns
`previewAvailable: false` with no items.

Analysis endpoints (B4, contract in `docs/api/contract-proposals.md` §3–§5):

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/v1/targets` | list / create (201) |
| GET | `/api/v1/targets/{id}` | one target |
| POST | `/api/v1/targets/{id}/analysis` | start a staged run (202); consent-gated |
| GET | `/api/v1/targets/{id}/analysis/run` | poll the latest run |
| GET | `/api/v1/targets/{id}/analysis` | latest report |

Resume endpoints (B5, contract §6):

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/targets/{id}/resume` | generate a tailored resume (201) |
| GET | `/api/v1/resumes` | standard + tailored summaries |
| GET | `/api/v1/resumes/{id}` | one resume (`resume-standard` is derived) |
| PATCH | `/api/v1/resumes/{id}/sections/{key}` | grounded hand edit |
| GET | `/api/v1/resumes/{id}/versions` | insert-only history |
| POST | `/api/v1/resumes/{id}/versions/{version_id}/restore` | copy forward, keep history |
| POST | `/api/v1/resumes/{id}/stale` | set the stale flag |
| GET | `/api/v1/resumes/{id}/diff` | resume vs current workspace |
| POST | `/api/v1/resumes/{id}/refresh` | refresh unedited sections |

Generation needs a report at the current workspace version (`analysis_required`
/ `analysis_stale`). The engine only reorders/trims existing items and every
claim cites workspace item ids. `rewordWithAi: true` additionally needs a
configured provider and recorded consent; an ungrounded rewrite falls back to
the original text. See ADR-039/ADR-040.

## Tests

```bash
cd backend
uv run pytest            # unit + contract tests (in-memory repo, httpx.MockTransport)

# opt-in integration tests (skipped unless backend/.env.test opts in)
uv run pytest tests/test_workspace_integration.py tests/test_import_integration.py \
  tests/test_analysis_integration.py tests/test_resumes_integration.py
```

Integration tests read `backend/.env.test` (git-ignored; copy
`.env.test.example`) plus the runtime `backend/.env` for `SUPABASE_URL` /
`SUPABASE_PUBLISHABLE_KEY`. Set `RUN_SUPABASE_INTEGRATION=1` and two test users
(`SUPABASE_TEST_EMAIL_A`/`_PASSWORD_A` and `..._B`); the helper
`tests/supabase_auth.py` signs them in through Supabase Auth. They hit a real
project with a real user JWT, so they prove RLS, the per-user change log and
standard resume, and the transactional versioning.

Before a live run, check both password sign-ins without printing any secret:

```bash
uv run python scripts/check_test_users.py   # prints label, HTTP status, error code only
```

The live endpoint smoke (`scripts/smoke_live.py`) and the frontend live
Playwright suite also read their opt-in gates (`RUN_LIVE_SMOKE` /
`RUN_LIVE_E2E`) and user A credentials from `backend/.env.test`, so no shell
export is required; exported values still win.

`tests/test_import_integration.py` additionally needs migration `0004` applied;
it proves import isolation between two users, idempotent confirm, and the
attested/verified evidence rules. Both suites skip cleanly when the flag or the
credentials are absent; the import suite also skips when `0004` is not applied,
and prints which condition caused the skip. No key, password or token is ever
printed.

## AI gateway (B3)

`app/ai/` is a provider-agnostic gateway over an OpenAI-compatible HTTP client.
**There are no public AI endpoints in B3** — the gateway is infrastructure that B4
(job analysis) and B5 (reports/generation) will call.

- **Providers** are chosen by config (`AI_PRIMARY_PROVIDER=groq`,
  `AI_SECONDARY_PROVIDER=nvidia`). Base URLs and model IDs come from settings and
  are never hardcoded in request code; defaults live in `.env.example` comments.
  Both providers' docs were read **and probed live** on 2026-10-19 — base URLs,
  current model IDs (the NVIDIA docs still listed retired ones), structured-output
  form, free-tier rate limits and data terms are recorded in `docs/DECISIONS.md`
  ADR-029 and measured in `docs/ai-bakeoff.md`.
- **Structured output**: each task is a Pydantic model. Both providers get
  `response_format={"type":"json_schema", "strict":true}` (NVIDIA's hosted endpoint
  rejected `nvext.guided_json` for a current model, so the OpenAI-compatible form
  is the verified path). Every response is validated; a Groq
  `json_validate_failed` 400 is treated as an invalid output, not a hard error.
  On failure the gateway makes **one** repair attempt, then fails with the typed
  `ai_invalid_output` error.
- **Reliability**: per-request timeout, retry with exponential backoff, and
  fallback to the secondary provider on 429, 5xx or timeout (an oversized
  `Retry-After` falls back immediately instead of sleeping). Other 4xx fail fast.
- **Cache**: in-memory, keyed by a SHA-256 of the request (task, redacted
  messages, schema **and the user id**, so one person's restored result can never
  be served to another), TTL from `AI_CACHE_TTL_SECONDS`. A cache hit makes no
  provider call and consumes no quota.
- **Quota**: `AI_DAILY_QUOTA` per user per UTC day, behind the `QuotaStore`
  interface (`InMemoryDailyQuota` is the B3 implementation; a database-backed
  store slots in later).
- **Privacy**: before any external call, email, phone, URLs, street addresses and
  the caller's known profile fields are replaced with reversible placeholders
  (`[[EMAIL_1]]`, `[[FIELD_2]]`, …); generated text is restored before validation
  and return. Logs carry provider, model, latency, token counts and validity only —
  never a prompt, a response, or a key.
- **Consent**: no AI call runs without a `ConsentGrant`, which only
  `app.api.deps.require_ai_consent` mints after finding a live row in
  `consent_records` (`purpose='ai_processing'`, not revoked). The dependency is
  ready for B4/B5.
- **Grounding**: `app/ai/claims.py` is a deterministic validator (no LLM) that
  rejects claims whose numbers, technologies, organisations, titles or dates do
  not appear in the cited evidence — including adjacent-skill substitution
  (TypeScript for JavaScript, Docker for Kubernetes) and inflated titles.

### Bake-off

```bash
cd backend
uv run python scripts/ai_bakeoff.py                 # writes docs/ai-bakeoff.md (skipped without keys)
uv run python scripts/ai_bakeoff.py --simulate      # offline self-check of the harness
$env:RUN_AI_LIVE=1; uv run python scripts/ai_bakeoff.py   # live, only if a key is present
```

It runs the four typed tasks over the **synthetic** corpus in
`backend/tests/golden/` (no real personal data) and reports JSON validity after
retries, latency p50/p95 and grounding errors per provider and model. Live calls
happen only with `RUN_AI_LIVE=1` and a key. Results: `docs/ai-bakeoff.md`.

### AI environment variables

| Variable | Meaning |
|---|---|
| `GROQ_API_KEY` / `NVIDIA_API_KEY` | provider keys (optional; empty = provider skipped) |
| `GROQ_BASE_URL` / `NVIDIA_BASE_URL` | OpenAI-compatible base URL (defaults in `.env.example`) |
| `GROQ_MODEL` / `NVIDIA_MODEL` | model ID (defaults in `.env.example`) |
| `AI_PRIMARY_PROVIDER` / `AI_SECONDARY_PROVIDER` | fallback order |
| `AI_TIMEOUT_SECONDS`, `AI_MAX_RETRIES`, `AI_BACKOFF_BASE_SECONDS`, `AI_RETRY_AFTER_CAP_SECONDS` | timeout/retry policy |
| `AI_MAX_OUTPUT_TOKENS`, `AI_DAILY_QUOTA`, `AI_CACHE_TTL_SECONDS`, `AI_CACHE_MAX_ENTRIES` | generation, quota and cache limits |

`scripts/check_env.py` reports these names as **optional** (they never affect
`--strict`).

## Supabase JWT verification (what was verified)

Checked against current Supabase docs on 2026-10-16 (`/docs/guides/auth/jwts`,
`/docs/guides/auth/signing-keys`): asymmetric project signing keys verified
via `GET {project}/auth/v1/.well-known/jwks.json` (kid/alg match, ≤10-min
cache); legacy HS256 shared secret kept as opt-in fallback; `aud`
(`authenticated`), `iss`, `exp`, `sub` enforced. Details in ADR-010.

## Database

Schema + RLS live in `db/migrations/` (`0001_initial.sql`, then
`0002_workspace_api.sql`, `0003_hardening.sql`, `0004_imports.sql`) — see
`db/README.md`. Apply them with the Supabase SQL editor or CLI (`supabase db push`
once the project is linked). `0002` adds the readable `change_log` columns and the
`SECURITY INVOKER` workspace functions; `0003` hardens grants/policies; `0004`
adds `import_sessions` + `import_review_items` and the import RPCs. `0004` was
applied to the dev project on 2026-10-19; RLS, owner-only policies and the
invoker-only RPCs were verified read-only.

## Docker / Render

```bash
cd backend
docker build -t resumeiq-backend .
docker run -p 8000:8000 --env-file .env -e PORT=8000 resumeiq-backend
```

Render (free web service): build `docker build -t app .` equivalent is
automatic — set the service root to `backend/`, Dockerfile path
`backend/Dockerfile`, start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (the Dockerfile CMD already does
this), and copy every variable from `.env.example` into the service
environment. Expect ~1 min cold starts (frontend warm-up screen covers this).
