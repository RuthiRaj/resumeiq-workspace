# Database (Supabase Postgres)

Forward-only migrations: `0001_initial.sql` creates the B0 schema (PRD section
6); `0002_workspace_api.sql` adds the B1 workspace columns + functions;
`0003_hardening.sql` locks down the RPC privileges and closes the
version↔change-log gap (ADR-018); `0004_imports.sql` adds the B2 import tables
and functions (ADR-028); `0005_analysis.sql` adds the B4 target/run/report
columns; `0006_fixes.sql` corrects two findings from the B4 live check
(ADR-034); `0007_resumes.sql` adds the B5 tailored-resume metadata and claim
provenance columns (ADR-039); `0008_privacy.sql` adds B6 deletion/purge
policies and the account-data RPC (ADR-041/043). Apply them in order with the Supabase SQL editor
or CLI (`supabase db push` once the project is linked). They reference
`auth.users` / `auth.uid()`, so they only run on Supabase Postgres (or a local
Postgres with an `auth` schema stub) — not on vanilla local Postgres.

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

## Migration 0006 — B4 follow-ups (ADR-034)

Authored but **not yet applied**. It contains the two fixes found while
verifying 0005 against the live project; both statements are safe to re-run.

- `targets.length` default is now `'one_page'`. 0005 changed the check
  constraint to the wire values but left the old `'one-page'` default, so an
  insert that omitted `length` failed with `23514`.
- `jobs_target_idx` indexes `jobs (target_id)`. 0005 added the FK but only a
  composite index starting with `user_id`, so target-only lookups could not use
  it and the performance advisor reported an unindexed foreign key.

`tests/test_migrations.py` parses the migration text and asserts both statements
(without connecting to a database). Apply `0006_fixes.sql` after 0005 in the SQL
editor, then re-run the performance advisor to confirm the unindexed-FK finding
is cleared.

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
- `change_log`, `audit_events`, `workspace_versions`, `analysis_reports` are
  **insert-only**: they have SELECT + INSERT policies and no UPDATE/DELETE
  policies, so updates/deletes are denied.
- `resume_versions` is insert-only except for one owner-scoped DELETE policy
  added by 0008 (B6 explicit version deletion). It still has no UPDATE policy:
  purging a snapshot goes through the narrow `api_resume_version_purge`
  function, which changes only `snapshot`.
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

`0004_imports.sql` was applied to the Supabase dev project on 2026-10-19 and
verified read-only: both import tables exist with RLS enabled and four
`(select auth.uid()) = user_id` policies each; `api_import_create_session` and
`api_import_confirm` are `SECURITY INVOKER` with `search_path=public`, executable
by `authenticated` and not by `anon`. The security/performance advisors show no
new 0004-related findings (see the ADR-028 addendum).

The opt-in import suite (`tests/test_import_integration.py`) probes the Data API
for `import_sessions` before running, so it still skips with that exact reason in
any project where `0004` has not been applied (the same gate also requires user
B's credentials in `backend/.env.test`).

## Migration 0007 — B5 resumes (ADR-039)

`0007_resumes.sql` is authored but **not yet applied**. It only adds columns and
one index; it does not create tables or policies:

- `resumes`: `title`, `ai_used`, `ats`, `edited_sections`, `source_evidence`
  (the cited items with content fingerprints, never sent to clients);
- `resume_claims`: `section`, `position`, `ai_rewritten` so each visible claim is
  queryable and its AI provenance survives;
- `resumes_user_updated_idx` for the newest-first resume list.

The standard resume is intentionally not stored (it is derived on every read),
so there is no standard row or standard-version history. `resume_versions`
remains insert-only; restoring copies a snapshot into a new version.

Apply `0007_resumes.sql` after `0006_fixes.sql`. The opt-in
`tests/test_resumes_integration.py` probes for these columns and skips with
"migration 0007_resumes.sql is not applied" until they exist.

## Migration 0008 — B6 privacy: delete, purge and account-data removal

`0008_privacy.sql` is authored but **not yet applied**. It adds:

- `resume_versions_owner_delete` — the first DELETE policy on that history
  table, so `DELETE /resumes/{id}/versions/{id}` can work. It is owner-scoped
  with `(select auth.uid()) = user_id` and adds no UPDATE policy.
- `api_resume_version_purge(p_resume_id, p_version_id, p_snapshot)` — a
  `SECURITY DEFINER` function with a pinned `search_path` that rewrites exactly
  one owned snapshot (PRD RG-6). It takes no user id, resolves `auth.uid()`,
  checks the resume id, validates that the payload is a JSON object, and changes
  only `snapshot`. EXECUTE is revoked from `PUBLIC`/`anon` and granted to
  `authenticated`.
- `api_account_delete_data()` — a `SECURITY DEFINER` function with no arguments
  that deletes every public row owned by `auth.uid()` in dependency order
  (claims → versions → resumes; import items → sessions; requirements, reports
  and jobs → targets; evidence → workspace items; relations → skills; then
  workspace versions, change log, consent records, audit events and the
  profile) and returns per-table counts. EXECUTE is granted to `authenticated`
  only.

The function cannot touch `auth.users`. The API therefore returns
`authUserDeleted: false` and `remainingStep: "auth_user"`; completing that step
is an operator action (see below).

### Remaining account step: delete the auth identity

The backend deliberately holds no `service_role` key, so `DELETE /account`
removes all app data and stops. To finish an account deletion, an operator with
access to the Supabase project:

1. Confirms the request out-of-band and records the user's id (the API response
   does not return it).
2. Deletes the identity through the Supabase dashboard (Authentication → Users →
   Delete user) or the Admin API
   (`DELETE {SUPABASE_URL}/auth/v1/admin/users/{user_id}` with the
   `service_role` key held only in the operator's environment).
3. Verifies no `public` rows remain for that id:
   `select count(*) from public.profiles where user_id = '<id>';` (expects `0`).

Because every `public` foreign key to `auth.users` is `ON DELETE CASCADE`, step
2 is a safety net rather than the only cleanup. Never commit or expose the
`service_role` key, and never send it to the frontend.

Apply `0008_privacy.sql` after `0007_resumes.sql`. The opt-in
`tests/test_privacy_integration.py` skips with "migration 0008_privacy.sql is not
applied" until the RPCs exist, and it never deletes real test users.
