# Database (Supabase Postgres)

Migration `db/migrations/0001_initial.sql` creates the B0 schema for PRD
section 6. Apply it with the Supabase SQL editor or CLI (`supabase db push`
once the project is linked). It references `auth.users` / `auth.uid()`, so it
only runs on Supabase Postgres (or a local Postgres with an `auth` schema
stub) — not on vanilla local Postgres.

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
  The B1 API must reject `verified` items with no evidence link.
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

> **Not executed against a live database.** No local Postgres is available in
> this environment (`psql` not installed; Supabase project not linked), so
> `0001_initial.sql` has been carefully reviewed but **not run**. Before B1,
> apply it to a linked Supabase project and confirm with:
>
> ```sql
> select tablename from pg_tables where schemaname = 'public' order by 1;
> ```
