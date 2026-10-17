# Database (Supabase Postgres)

Forward-only migrations: `0001_initial.sql` creates the B0 schema (PRD section
6); `0002_workspace_api.sql` adds the B1 workspace columns + functions. Apply
them in order with the Supabase SQL editor or CLI (`supabase db push` once the
project is linked). They reference `auth.users` / `auth.uid()`, so they only run
on Supabase Postgres (or a local Postgres with an `auth` schema stub) — not on
vanilla local Postgres.

## Migration 0002 — B1 workspace API

- `change_log` gains `label text` (captured at write time so the log stays
  readable after a soft delete) and a per-user monotonic `seq integer`
  (NOT NULL, unique per user) — the wire changelog entry needs both (ADR-017).
- Seven `SECURITY INVOKER` functions perform each mutation atomically (version
  bump + `change_log` append + item change in one transaction):
  `api_workspace_create/update/delete/restore/reorder`, plus the
  `api_workspace_next_version` / `api_workspace_next_seq` helpers.
- `SECURITY INVOKER` keeps RLS effective (functions run as `authenticated`);
  EXECUTE is granted to `authenticated` only. The backend reaches them through
  the Data API with the caller's JWT (ADR-016).

## Tables

| Table | Purpose (PRD) |
|---|---|
| `profiles` | Per-user profile (1:1 with `auth.users`) |
| `workspace_items` | Master-workspace entries, all sections (WS-1..WS-3) |
| `evidence_links` | Attachments/links backing an item's evidence state (WS-2) |
| `workspace_versions` | Monotonic version markers (WS-4), immutable |
| `change_log` | Append-only change log (WS-4) |
| `skills` | Canonical per-user skill entries |
| `skill_relations` | Adjacent-skill links (`related` only — never equivalent) |
| `targets` | Job targets: role/company/JD/preferences (JD-1) |
| `jd_requirements` | Extracted requirements + match status/gap type (JD-2..JD-4) |
| `analysis_reports` | Immutable per-run score/factors/roadmap/ATS (6.5, 6.6) |
| `resumes` | Standard (one live copy) + tailored snapshots (RG) |
| `resume_versions` | Saved tailored-version history (RG-6), insert-only |
| `resume_claims` | Every generated claim + its evidence links (RG-3) |
| `jobs` | Async background-job tracking for slow AI work (10.1; used from B2+) |
| `consent_records` | Explicit AI-processing consent (EX-3) |
| `audit_events` | Append-only security trail |

## Evidence states

`workspace_items.evidence` is one of `verified | attested | related | missing`
(PRD section 4.2):

- `verified` — a supporting document/link exists (`evidence_links` row).
  The B1 API rejects `verified` items with no evidence link, in the request
  models *and* in the SQL functions.
- `attested` — typed by the user, no supporting artefact (import default, IM-3).
- `related` — adjacent but not equivalent (e.g. TypeScript for a JS requirement).
- `missing` — known gap; never rendered as a positive claim.

Generation (B5) may only emit claims whose `evidence_ids` point at workspace
items; unsupported statements are removed or flagged `needs confirmation`
(RG-2, RG-3). Scores are methodology breakdowns, never hiring probabilities.

## Standard vs tailored resumes

- `kind='standard'`: exactly one live row per user (partial unique index
  `resumes_one_standard_per_user`). Regenerated from the workspace on every
  add/edit/delete/reorder; soft-deleted items (`deleted_at NOT NULL`) are
  always excluded (SYN-2).
- `kind='tailored'`: immutable snapshots bound to a `target_id` and the
  `workspace_version` at generation time. Workspace changes set `stale=true`
  with a diff; user-edited sections are never silently overwritten.
- `resume_versions` keeps saved history; deleting a workspace item flags (not
  rewrites) history rows containing it ("contains removed information").

## Row Level Security

- RLS is enabled on **every** table. Policies restrict all access to
  `auth.uid() = user_id` — users can only read/write their own rows.
- `change_log`, `audit_events`, `workspace_versions`, `analysis_reports`,
  `resume_versions` are **insert-only**: they have SELECT + INSERT policies
  and no UPDATE/DELETE policies, so updates/deletes are denied.
- The backend authenticates with the caller's Supabase JWT
  (`app/api/deps.py`), so Postgres sees the real `auth.uid()` and RLS
  applies end to end. The `service_role` key (bypasses RLS) is never used
  for user-data access.

## Validation status

Both migrations were applied to the Supabase dev project on 2026-10-17 and the
result was verified read-only:

- `0001_initial.sql`: 16 tables in `public`, **all with RLS enabled** — 11 with
  four policies (own-row CRUD), 5 insert-only with two (`analysis_reports`,
  `audit_events`, `change_log`, `resume_versions`, `workspace_versions`).
- `0002_workspace_api.sql`: the seven `api_workspace_*` functions exist with the
  expected signatures; `change_log.label`/`seq` added.

Not yet exercised against the live project with a real user JWT: the opt-in
integration tests (`RUN_SUPABASE_INTEGRATION=1`, see `backend/README.md`). The
unit/contract tests run the in-memory repository and `httpx.MockTransport`.
