# Database (Supabase Postgres)

Forward-only migrations: `0001_initial.sql` creates the B0 schema (PRD section
6); `0002_workspace_api.sql` adds the B1 workspace columns + functions;
`0003_hardening.sql` locks down the RPC privileges and closes the
version↔change-log gap (ADR-018); `0004_imports.sql` adds the B2 import tables
and functions (ADR-028). Apply them in order with the Supabase SQL editor or CLI
(`supabase db push` once the project is linked). They reference `auth.users` /
`auth.uid()`, so they only run on Supabase Postgres (or a local Postgres with an
`auth` schema stub) — not on vanilla local Postgres.

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

## Migration 0003 — B1 hardening (ADR-018)

Applies the B1 self-review fixes (report only — this migration must be applied
separately in the SQL editor):

- **RPC privileges.** `REVOKE EXECUTE … FROM PUBLIC, anon` on the five
  `api_workspace_*` mutation functions (Postgres grants EXECUTE to `PUBLIC` by
  default, so they were reachable by `anon`); `GRANT EXECUTE … TO authenticated`
  is kept. `set_updated_at()` also loses `PUBLIC`/`anon` and gets a pinned
  `search_path`.
- **No user-id parameter.** `api_workspace_next_seq` / `api_workspace_next_version`
  are **dropped**; their bodies are inlined into the five mutation functions, so
  no caller can bump a version as a standalone call (see ADR-018 for why the
  other options are unsafe under `SECURITY INVOKER`).
- **Version ↔ log invariant.** A `DEFERRABLE INITIALLY DEFERRED` constraint
  trigger on `workspace_versions` rejects (at commit) any version row without a
  matching `change_log` row, which also blocks a direct Data API insert.
- **RLS initplan.** All 54 policies are rewritten to `(select auth.uid()) = user_id`
  so `auth.uid()` is evaluated once per query, not per row.
- **Indexes.** Four covering indexes for the previously unindexed foreign keys:
  `resume_claims.user_id`, `resume_versions.user_id`, `skill_relations.user_id`,
  `skill_relations.to_skill_id`.

## Migration 0004 — B2 import parsing (ADR-028)

Adds what a document upload produced. **The uploaded file itself is not stored**
— it is parsed in memory and discarded; only the extracted text and the candidate
items are persisted (PRD §11).

- `import_sessions` — one row per upload: `file_name`, `file_type` (`pdf`/`docx`),
  `file_size`, `page_count`, `source_text` (the real extracted text the preview
  shows), `preview_available` (false when nothing was readable, e.g. a scan).
- `import_review_items` — one candidate per extracted entry: the immutable
  `extraction` jsonb (per-field confidence + 1-based `sourceLine`), the editable
  `values` jsonb, `status` (`pending`/`confirmed`/`rejected`), `support`
  (`{kind:'file',name}` or `{kind:'link',url}`), and `workspace_item_id` once
  confirmed. `UNIQUE (import_id, wire_id)`.
- `api_import_create_session(...)` — inserts the session and every review item in
  one transaction (one Data API call, so a partial session is impossible).
- `api_import_confirm(p_import_id uuid, p_item_id text) -> uuid` — the **only**
  import→workspace path. It reads the row's `values`/`support`, inserts the
  `workspace_items` row, bumps the workspace version, appends the `change_log`
  row, adds the evidence link for a certificate file, and flips the review item
  to `confirmed`. Idempotent: a second call returns the same workspace item.
  Evidence is `verified` only when support was attached, else `attested` (IM-3).
- Both are `SECURITY INVOKER` with `SET search_path = public`, EXECUTE revoked
  from `PUBLIC`/`anon` and granted to `authenticated` only; RLS policies on both
  tables use the `(select auth.uid()) = user_id` initplan form from 0003. An item
  update touches its session's `updated_at` via a trigger.
- Version bump and `seq` are inlined, not called: `0003` dropped the
  `api_workspace_next_*` helpers (ADR-018). `0004` therefore runs whether or not
  `0003` has been applied.

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
| `import_sessions` | One document upload's extracted text + preview state (IM-1) |
| `import_review_items` | Candidate items awaiting the user's confirm/reject (IM-1..IM-3) |
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

Migrations `0001` and `0002` were applied to the Supabase dev project on
2026-10-17 and verified read-only: 16 tables in `public`, all with RLS enabled
(11 with four own-row CRUD policies, 5 insert-only with two), and the seven
`api_workspace_*` functions present with the expected signatures.

`0003_hardening.sql` is authored but **not yet applied** — run it in the SQL
editor, then re-run the security/performance advisors to confirm the warnings are
cleared. Once it is applied, `api_workspace_next_seq` /
`api_workspace_next_version` no longer exist (five `api_workspace_*` functions
remain, all `authenticated`-only).

The Data API path is covered by `httpx.MockTransport` unit tests and by the
opt-in integration tests (`RUN_SUPABASE_INTEGRATION=1`, see `backend/README.md`);
those are skipped unless a real project and two signed-in test users are supplied.

`0004_imports.sql` is authored but **not yet applied** (deliberate, per the B2
brief): apply it in the SQL editor, then re-run the Supabase security and
performance advisors.
