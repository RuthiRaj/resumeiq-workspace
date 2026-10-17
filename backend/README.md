# ResumeIQ backend (FastAPI) — B0 scaffold + B1 workspace API

B0: app scaffold, Supabase JWT auth (`GET /api/v1/me`), `GET /health`, security
defaults, Postgres schema + RLS, OpenAPI contract export, Docker, CI.

B1: the workspace API under `/api/v1` (items across all sections, evidence
states, attachment metadata, per-user versioning + append-only change log,
soft-delete/restore/reorder) and the deterministic standard-resume sync. No AI
calls, no document parsing, no job analysis (those are B2+).

## Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (preferred). Without uv: `python -m venv .venv`
  + `pip install -e ".[dev]"` (no lockfile in that path — prefer uv).

## Setup

```bash
cd backend
uv sync            # creates .venv and installs locked deps (uv.lock)
cp .env.example .env   # then fill in Supabase values; never commit .env
```

## Run

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
# GET http://localhost:8000/health
# GET http://localhost:8000/api/v1/me  (Authorization: Bearer <Supabase JWT>)
# Docs: http://localhost:8000/docs
```

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

See `.env.example` for every variable (no real values committed).
Key notes:

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
- `RUN_SUPABASE_INTEGRATION=1` opts into the integration tests (see below).

## API (B1)

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

## Tests

```bash
cd backend
uv run pytest            # unit + contract tests (in-memory repo, httpx.MockTransport)
RUN_SUPABASE_INTEGRATION=1 \
  SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... SUPABASE_TEST_TOKEN_A=... \
  uv run pytest tests/test_workspace_integration.py   # opt-in; skipped otherwise
```

Integration tests hit a real project with a real user JWT (so they also prove RLS
and the transactional versioning). Without the flag they are skipped; no keys are
ever printed.

## Supabase JWT verification (what was verified)

Checked against current Supabase docs on 2026-10-16 (`/docs/guides/auth/jwts`,
`/docs/guides/auth/signing-keys`): asymmetric project signing keys verified
via `GET {project}/auth/v1/.well-known/jwks.json` (kid/alg match, ≤10-min
cache); legacy HS256 shared secret kept as opt-in fallback; `aud`
(`authenticated`), `iss`, `exp`, `sub` enforced. Details in ADR-010.

## Database

Schema + RLS live in `db/migrations/` (`0001_initial.sql`, then
`0002_workspace_api.sql`) — see `db/README.md`. Apply them with the Supabase SQL
editor or CLI (`supabase db push` once the project is linked). `0002` adds the
readable `change_log` columns and the `SECURITY INVOKER` workspace functions.

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
