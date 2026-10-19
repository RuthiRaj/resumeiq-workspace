-- ResumeIQ B4 analysis API (Supabase Postgres).
--
-- Aligns the B0 tables with the wire contract in
-- docs/api/contract-proposals.md §3–§5 and adds the columns B4 persists. No new
-- tables: the existing RLS policies (`auth.uid() = user_id`) are exactly the
-- isolation the API needs, so they are reused unchanged.
--
-- Forward-only: run after 0004_imports.sql. NOT applied by the repository.
-- Until it is applied, the live Supabase target/analysis routes fail closed;
-- the in-memory repositories and every unit/parity test are unaffected.
--
-- Privacy: no job-description or resume text is copied into logs, `jobs.error`
-- holds a code-safe message only, and `analysis_reports` stays insert-only.

-- ---------------------------------------------------------------------------
-- targets: wire enums + the latest analysis summary
-- ---------------------------------------------------------------------------

ALTER TABLE public.targets ADD COLUMN IF NOT EXISTS analysis jsonb;

-- `length` was 'one-page'/'two-page'; the wire is 'one_page'/'two_page'.
ALTER TABLE public.targets DROP CONSTRAINT IF EXISTS targets_length_check;
UPDATE public.targets
   SET length = replace(length, '-', '_')
 WHERE length IN ('one-page', 'two-page');
ALTER TABLE public.targets
  ADD CONSTRAINT targets_length_check CHECK (length IN ('one_page', 'two_page'));

-- `template` was a free-form string defaulting to 'default'.
ALTER TABLE public.targets ALTER COLUMN template SET DEFAULT 'precision';
UPDATE public.targets
   SET template = 'precision'
 WHERE template NOT IN ('precision', 'classic', 'compact');
ALTER TABLE public.targets DROP CONSTRAINT IF EXISTS targets_template_check;
ALTER TABLE public.targets
  ADD CONSTRAINT targets_template_check CHECK (template IN ('precision', 'classic', 'compact'));

-- `status` needs 'failed' for a run that could not complete.
ALTER TABLE public.targets DROP CONSTRAINT IF EXISTS targets_status_check;
ALTER TABLE public.targets
  ADD CONSTRAINT targets_status_check
  CHECK (status IN ('draft', 'analyzing', 'ready', 'failed', 'archived'));

-- ---------------------------------------------------------------------------
-- jd_requirements: prose pattern + explanation + stable order
-- ---------------------------------------------------------------------------

ALTER TABLE public.jd_requirements
  ADD COLUMN IF NOT EXISTS pattern text
  CHECK (pattern IN ('experience', 'education', 'seniority'));
ALTER TABLE public.jd_requirements
  ADD COLUMN IF NOT EXISTS explanation text NOT NULL DEFAULT '';
ALTER TABLE public.jd_requirements
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS jd_requirements_target_position_idx
  ON public.jd_requirements (target_id, position);

-- ---------------------------------------------------------------------------
-- analysis_reports: the full wire report (durable artefact)
-- ---------------------------------------------------------------------------

ALTER TABLE public.analysis_reports
  ADD COLUMN IF NOT EXISTS report jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.analysis_reports
  ADD COLUMN IF NOT EXISTS workspace_version integer;
ALTER TABLE public.analysis_reports
  ADD COLUMN IF NOT EXISTS generated_at timestamptz;
ALTER TABLE public.analysis_reports
  ADD COLUMN IF NOT EXISTS ai_used boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS analysis_reports_target_created_idx
  ON public.analysis_reports (target_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- jobs: one row per analysis run, with staged progress for polling
-- ---------------------------------------------------------------------------

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS target_id uuid
  REFERENCES public.targets (id) ON DELETE CASCADE;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS stage_index integer;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS progress numeric(5, 2);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS workspace_version integer;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS finished_at timestamptz;

CREATE INDEX IF NOT EXISTS jobs_target_created_idx
  ON public.jobs (user_id, kind, target_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Explicit grants (mirror the policies above; RLS still applies)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.targets         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jd_requirements TO authenticated;
GRANT SELECT, INSERT ON public.analysis_reports                TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs            TO authenticated;
