-- ResumeIQ B0 initial schema (Supabase Postgres).
--
-- Covers PRD section 6 entities: profiles, workspace_items, evidence_links,
-- workspace_versions + change_log, skills + skill_relations, targets,
-- jd_requirements, analysis_reports, resumes, resume_versions, resume_claims,
-- jobs (async background jobs, PRD 10.1), consent_records, audit_events.
--
-- Conventions (see db/README.md):
--   * Every row belongs to exactly one user (`user_id ... REFERENCES auth.users`).
--   * Row Level Security is enabled on EVERY table; users can only touch their
--     own rows. `change_log` and `audit_events` are append-only (no
--     UPDATE/DELETE policies); history tables are insert-only.
--   * Deletes are soft deletes (`deleted_at`); standard-resume sync excludes
--     soft-deleted rows (PRD SYN-2).
--   * Idempotent: safe to run once on a fresh project. (No down migration for
--     B0; forward-only migrations from B1 onwards.)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

CREATE TABLE public.profiles (
  user_id      uuid        NOT NULL PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text        NOT NULL DEFAULT '',
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- workspace_items (PRD WS-1..WS-6)
-- ---------------------------------------------------------------------------

CREATE TABLE public.workspace_items (
  id                uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  section           text        NOT NULL CHECK (section IN (
    'personal', 'education', 'experience', 'internship', 'project', 'skill',
    'achievement', 'extracurricular', 'certificate', 'course', 'publication', 'training'
  )),
  title             text        NOT NULL,
  organization      text,
  start_date        date,
  end_date          date,
  location          text,
  bullets           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  tags              text[]      NOT NULL DEFAULT '{}',
  links             text[]      NOT NULL DEFAULT '{}',
  evidence          text        NOT NULL DEFAULT 'attested' CHECK (evidence IN (
    'verified', 'attested', 'related', 'missing'
  )),
  position          integer     NOT NULL DEFAULT 0,
  workspace_version integer     NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);

CREATE INDEX workspace_items_user_section_idx ON public.workspace_items (user_id, section)
  WHERE deleted_at IS NULL;
CREATE INDEX workspace_items_user_evidence_idx ON public.workspace_items (user_id, evidence)
  WHERE deleted_at IS NULL;
CREATE INDEX workspace_items_user_version_idx ON public.workspace_items (user_id, workspace_version);

-- ---------------------------------------------------------------------------
-- evidence_links
-- ---------------------------------------------------------------------------

CREATE TABLE public.evidence_links (
  id                uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  workspace_item_id uuid       NOT NULL REFERENCES public.workspace_items (id) ON DELETE CASCADE,
  url               text        NOT NULL,
  label             text,
  kind              text        NOT NULL DEFAULT 'other' CHECK (kind IN (
    'certificate', 'document', 'link', 'other'
  )),
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX evidence_links_item_idx ON public.evidence_links (workspace_item_id)
  WHERE deleted_at IS NULL;
CREATE INDEX evidence_links_user_idx ON public.evidence_links (user_id);

-- ---------------------------------------------------------------------------
-- workspace_versions + change_log (PRD WS-4, append-only log)
-- ---------------------------------------------------------------------------

CREATE TABLE public.workspace_versions (
  id         uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  version    integer     NOT NULL CHECK (version > 0),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);

CREATE TABLE public.change_log (
  id                uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  workspace_version integer     NOT NULL,
  action            text        NOT NULL CHECK (action IN (
    'create', 'update', 'delete', 'reorder', 'restore'
  )),
  entity            text        NOT NULL,
  entity_id         uuid,
  diff              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX change_log_user_version_idx ON public.change_log (user_id, workspace_version);
CREATE INDEX change_log_user_entity_idx ON public.change_log (user_id, entity, entity_id);

-- ---------------------------------------------------------------------------
-- skills + skill_relations (PRD section 4.3: related, never equivalent)
-- ---------------------------------------------------------------------------

CREATE TABLE public.skills (
  id         uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name       text        NOT NULL,
  normalized text        NOT NULL,
  category   text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (user_id, normalized)
);

CREATE INDEX skills_user_idx ON public.skills (user_id) WHERE deleted_at IS NULL;

CREATE TABLE public.skill_relations (
  id            uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  from_skill_id uuid        NOT NULL REFERENCES public.skills (id) ON DELETE CASCADE,
  to_skill_id   uuid        NOT NULL REFERENCES public.skills (id) ON DELETE CASCADE,
  relation      text        NOT NULL DEFAULT 'related' CHECK (relation IN ('related')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_skill_id, to_skill_id),
  CHECK (from_skill_id <> to_skill_id)
);

CREATE INDEX skill_relations_from_idx ON public.skill_relations (from_skill_id);

-- ---------------------------------------------------------------------------
-- targets + jd_requirements (PRD JD-1..JD-5)
-- ---------------------------------------------------------------------------

CREATE TABLE public.targets (
  id              uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role            text        NOT NULL,
  company         text,
  jd_text         text        NOT NULL,
  required_skills text[]      NOT NULL DEFAULT '{}',
  template        text        NOT NULL DEFAULT 'default',
  length          text        NOT NULL DEFAULT 'one-page' CHECK (length IN ('one-page', 'two-page')),
  status          text        NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'analyzing', 'ready', 'archived'
  )),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX targets_user_status_idx ON public.targets (user_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE public.jd_requirements (
  id          uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  target_id   uuid        NOT NULL REFERENCES public.targets (id) ON DELETE CASCADE,
  text        text        NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('required', 'preferred')),
  status      text        NOT NULL DEFAULT 'unsupported' CHECK (status IN (
    'matched', 'partial', 'unsupported'
  )),
  gap_type    text        CHECK (gap_type IN ('not_evidenced', 'genuinely_missing')),
  evidence_ids jsonb      NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jd_requirements_target_idx ON public.jd_requirements (target_id);
CREATE INDEX jd_requirements_user_idx ON public.jd_requirements (user_id);

-- ---------------------------------------------------------------------------
-- analysis_reports (PRD 6.5, 6.6; immutable per run)
-- ---------------------------------------------------------------------------

CREATE TABLE public.analysis_reports (
  id                   uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  target_id            uuid        NOT NULL REFERENCES public.targets (id) ON DELETE CASCADE,
  score                integer     CHECK (score BETWEEN 0 AND 100),
  factors              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  requirements_snapshot jsonb     NOT NULL DEFAULT '[]'::jsonb,
  roadmap              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ats                  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  methodology_version  text        NOT NULL DEFAULT 'v1',
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analysis_reports_target_idx ON public.analysis_reports (target_id);
CREATE INDEX analysis_reports_user_idx ON public.analysis_reports (user_id);

-- ---------------------------------------------------------------------------
-- resumes + resume_versions + resume_claims (PRD RG-1..RG-6)
-- ---------------------------------------------------------------------------

CREATE TABLE public.resumes (
  id                uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind              text        NOT NULL CHECK (kind IN ('standard', 'tailored')),
  target_id         uuid        REFERENCES public.targets (id) ON DELETE SET NULL,
  workspace_version integer     NOT NULL DEFAULT 1,
  stale             boolean     NOT NULL DEFAULT false,
  sections          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

-- Exactly one live standard resume per user (PRD section 4 table).
CREATE UNIQUE INDEX resumes_one_standard_per_user
  ON public.resumes (user_id)
  WHERE kind = 'standard' AND deleted_at IS NULL;
CREATE INDEX resumes_user_kind_idx ON public.resumes (user_id, kind)
  WHERE deleted_at IS NULL;
CREATE INDEX resumes_target_idx ON public.resumes (target_id) WHERE target_id IS NOT NULL;

CREATE TABLE public.resume_versions (
  id                uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  resume_id         uuid        NOT NULL REFERENCES public.resumes (id) ON DELETE CASCADE,
  snapshot          jsonb       NOT NULL,
  workspace_version integer     NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resume_versions_resume_idx ON public.resume_versions (resume_id);

CREATE TABLE public.resume_claims (
  id           uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  resume_id    uuid        NOT NULL REFERENCES public.resumes (id) ON DELETE CASCADE,
  text         text        NOT NULL,
  evidence_ids jsonb       NOT NULL DEFAULT '[]'::jsonb,
  confirmed    boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resume_claims_resume_idx ON public.resume_claims (resume_id);

-- ---------------------------------------------------------------------------
-- jobs (async background-job tracking for B2+ slow AI work, PRD 10.1)
-- ---------------------------------------------------------------------------

CREATE TABLE public.jobs (
  id         uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN ('extraction', 'analysis', 'generation', 'export')),
  status     text        NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'succeeded', 'failed', 'cancelled'
  )),
  payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  result     jsonb,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_user_status_idx ON public.jobs (user_id, status);

-- ---------------------------------------------------------------------------
-- consent_records (PRD EX-3: explicit AI-processing consent)
-- ---------------------------------------------------------------------------

CREATE TABLE public.consent_records (
  id         uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  purpose    text        NOT NULL CHECK (purpose IN ('ai_processing', 'data_export')),
  provider   text,
  granted    boolean     NOT NULL,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (granted AND granted_at IS NOT NULL OR NOT granted)
);

CREATE INDEX consent_records_user_idx ON public.consent_records (user_id, purpose);

-- ---------------------------------------------------------------------------
-- audit_events (append-only security trail)
-- ---------------------------------------------------------------------------

CREATE TABLE public.audit_events (
  id         uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  action     text        NOT NULL,
  entity     text,
  entity_id  uuid,
  metadata   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_user_idx ON public.audit_events (user_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER workspace_items_set_updated_at
  BEFORE UPDATE ON public.workspace_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER skills_set_updated_at
  BEFORE UPDATE ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER targets_set_updated_at
  BEFORE UPDATE ON public.targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER resumes_set_updated_at
  BEFORE UPDATE ON public.resumes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER jobs_set_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: every user reads/writes ONLY their own rows.
-- change_log / resume_versions / analysis_reports / audit_events are
-- insert-only history (SELECT + INSERT policies, no UPDATE/DELETE).
-- workspace_versions rows are immutable markers (SELECT + INSERT).
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_relations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.targets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jd_requirements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_reports   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_claims     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events       ENABLE ROW LEVEL SECURITY;

-- Full own-row access tables.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'workspace_items', 'evidence_links', 'skills', 'skill_relations',
    'targets', 'jd_requirements', 'resumes', 'resume_claims', 'jobs', 'consent_records'
  ]
  LOOP
    EXECUTE format('CREATE POLICY %I_owner_select ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)', t || '', t);
    EXECUTE format('CREATE POLICY %I_owner_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', t || '', t);
    EXECUTE format('CREATE POLICY %I_owner_update ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t || '', t);
    EXECUTE format('CREATE POLICY %I_owner_delete ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id)', t || '', t);
  END LOOP;
END;
$$;

-- Insert-only history tables (no UPDATE/DELETE policies: updates/deletes are denied).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workspace_versions', 'change_log', 'analysis_reports', 'resume_versions', 'audit_events'
  ]
  LOOP
    EXECUTE format('CREATE POLICY %I_owner_select ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)', t || '', t);
    EXECUTE format('CREATE POLICY %I_owner_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', t || '', t);
  END LOOP;
END;
$$;
