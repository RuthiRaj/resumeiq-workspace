-- 0008_privacy.sql -- B6 deletion, purge and account-data removal
--
-- Run AFTER 0007. Authored but NOT applied by the repository: the SQL editor
-- (or `supabase db push`) applies it. Until it is applied, the B6 delete/purge
-- and account-deletion routes fail closed; PDF export, the data export and every
-- unit test (in-memory repositories) are unaffected.
--
-- What this migration adds and why:
--
--   * `resume_versions` keeps its insert-only default, but B6 lets a user delete
--     one saved version explicitly. A DELETE policy scoped to auth.uid() is the
--     narrowest way to allow that (no UPDATE policy is added).
--   * `api_resume_version_purge` rewrites exactly one snapshot (the "remove
--     removed information" action, PRD RG-6). A direct UPDATE grant would let a
--     caller rewrite any column of any own version, so the function is SECURITY
--     DEFINER, takes no user id, resolves auth.uid() and changes only snapshot.
--   * `api_account_delete_data` removes every public row the caller owns in
--     dependency order and returns per-table counts. The auth identity is NOT
--     touched: deleting it needs a privilege this process deliberately does not
--     hold (ADR-043), and the API response says so.
--
-- Privacy: the functions log nothing, take no row content, and cannot select a
-- user other than auth.uid().

-- ---------------------------------------------------------------------------
-- 1. Explicit deletion of one saved version
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS resume_versions_owner_delete ON public.resume_versions;
CREATE POLICY resume_versions_owner_delete ON public.resume_versions
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- The table grant only permits the statement; RLS above still limits it to the
-- caller's own rows.
GRANT DELETE ON public.resume_versions TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Rewrite one snapshot without removed-item claims (RG-6)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.api_resume_version_purge(
  p_resume_id uuid,
  p_version_id uuid,
  p_snapshot  jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Shape check only: the caller supplies a snapshot, never another user's id.
  IF p_snapshot IS NULL
     OR jsonb_typeof(p_snapshot) <> 'object'
     OR NOT (p_snapshot ? 'resume') THEN
    RAISE EXCEPTION 'invalid snapshot' USING ERRCODE = '22023';
  END IF;

  UPDATE public.resume_versions
     SET snapshot = p_snapshot
   WHERE id = p_version_id
     AND resume_id = p_resume_id
     AND user_id = v_user;

  -- A missing row is not an error: purge is idempotent and the API already
  -- proved the version exists before calling. Returning quietly also avoids
  -- leaking whether another user's version id exists.
END;
$$;

REVOKE EXECUTE ON FUNCTION public.api_resume_version_purge(uuid, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api_resume_version_purge(uuid, uuid, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.api_resume_version_purge(uuid, uuid, jsonb) IS
  'B6: rewrite one owned resume_versions.snapshot after removing claims that cite deleted items.';

-- ---------------------------------------------------------------------------
-- 3. Delete every public row the caller owns (account data deletion)
-- ---------------------------------------------------------------------------
--
-- Dependency order (children first). Nothing here touches `auth.users`; the
-- response exposes the remaining auth-identity step instead of pretending the
-- whole account is gone. Calling it twice is safe and reports zero rows.
--
-- SECURITY DEFINER is required because `resume_versions`, `change_log`,
-- `analysis_reports` and `audit_events` deliberately have no DELETE policy.
-- The function is the only path that can remove them, it accepts no arguments
-- and it can only ever target auth.uid().

CREATE OR REPLACE FUNCTION public.api_account_delete_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_counts jsonb := '{}'::jsonb;
  v_count  integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.resume_claims WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('resume_claims', v_count);

  DELETE FROM public.resume_versions WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('resume_versions', v_count);

  DELETE FROM public.resumes WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('resumes', v_count);

  DELETE FROM public.evidence_links WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('evidence_links', v_count);

  DELETE FROM public.import_review_items WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('import_review_items', v_count);

  DELETE FROM public.import_sessions WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('import_sessions', v_count);

  DELETE FROM public.jd_requirements WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('jd_requirements', v_count);

  DELETE FROM public.analysis_reports WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('analysis_reports', v_count);

  DELETE FROM public.jobs WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('jobs', v_count);

  DELETE FROM public.targets WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('targets', v_count);

  DELETE FROM public.change_log WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('change_log', v_count);

  DELETE FROM public.workspace_versions WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('workspace_versions', v_count);

  DELETE FROM public.workspace_items WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('workspace_items', v_count);

  DELETE FROM public.skill_relations WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('skill_relations', v_count);

  DELETE FROM public.skills WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('skills', v_count);

  DELETE FROM public.consent_records WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('consent_records', v_count);

  DELETE FROM public.audit_events WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('audit_events', v_count);

  DELETE FROM public.profiles WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('profiles', v_count);

  RETURN v_counts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.api_account_delete_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api_account_delete_data() TO authenticated;

COMMENT ON FUNCTION public.api_account_delete_data() IS
  'B6: delete all public rows for auth.uid() in dependency order; the auth user remains.';
