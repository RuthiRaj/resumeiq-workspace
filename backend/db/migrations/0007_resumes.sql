-- 0007_resumes.sql -- B5 tailored resumes (PRD §6.8 RG-1..RG-6)
--
-- Run AFTER 0006 (whichever migration is current). Do not apply automatically:
-- the backend can be deployed before the migration, but resume generation
-- needs these columns. The opt-in integration test probes for them and skips
-- while they are absent.
--
-- Why these columns:
--   * title            -- human label shown in the resume list;
--   * ai_used          -- whether any visible claim came from the AI reworder;
--   * ats              -- deterministic ATS result computed at generation time;
--   * edited_sections  -- section keys the user edited by hand; refresh skips
--                         them unless that section is named explicitly;
--   * source_evidence  -- snapshot of the cited workspace items (content
--                         fingerprint + last known text) used for diff, the
--                         "removed item" flag and a non-destructive restore.
--
-- The standard resume is deliberately NOT stored: it is derived from the
-- workspace on every read, so a deleted item can never survive there (SYN-2).
-- resume_versions and resume_claims stay insert-only/own-row; restoring copies
-- an old snapshot into a new version and never deletes history.

ALTER TABLE public.resumes
  ADD COLUMN IF NOT EXISTS title           text,
  ADD COLUMN IF NOT EXISTS ai_used         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ats             jsonb,
  ADD COLUMN IF NOT EXISTS edited_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_evidence jsonb NOT NULL DEFAULT '[]'::jsonb;

-- One row per visible claim. section/position let the API rebuild the same
-- order the JSON snapshot uses; ai_rewritten keeps the provenance of a line.
ALTER TABLE public.resume_claims
  ADD COLUMN IF NOT EXISTS section      text,
  ADD COLUMN IF NOT EXISTS position     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_rewritten boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS resumes_user_updated_idx
  ON public.resumes (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.resumes.source_evidence IS
  'B5: cited workspace items with content fingerprints (never sent to clients).';
COMMENT ON COLUMN public.resumes.edited_sections IS
  'B5: section keys hand-edited by the user; refresh needs explicit opt-in.';
COMMENT ON COLUMN public.resume_claims.section IS
  'B5: resume section key for this claim.';
