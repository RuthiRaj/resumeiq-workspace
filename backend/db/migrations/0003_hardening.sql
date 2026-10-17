-- ResumeIQ B1 hardening (Supabase Postgres).
--
-- Addresses the B1 self-review findings (see docs/DECISIONS.md ADR-018).
-- Forward-only: run after 0002_workspace_api.sql. Nothing here changes the wire
-- contract; it tightens privileges and closes two integrity gaps.
--
--   1. Lock down EXECUTE on the workspace RPCs: PUBLIC/anon lose EXECUTE;
--      authenticated keeps it (unchanged behaviour for the app).
--   2. Remove the two user-id-parameter helpers. Their bodies are inlined into
--      the five mutation functions, so nothing can bump a workspace version as
--      a standalone call. (SECURITY INVOKER means the caller must hold EXECUTE
--      on any helper it calls, so "revoke from authenticated" is not viable;
--      inlining is the safe option — ADR-018.)
--   3. Enforce "every workspace version has a change_log entry" with a deferred
--      constraint trigger, so a direct Data API insert cannot desync the log.
--   4. Fix the mutable search_path on set_updated_at().
--   5. Rewrite RLS policies to evaluate auth.uid() once (initplan), not per row.
--   6. Index the four unindexed foreign keys.

-- ---------------------------------------------------------------------------
-- 1 + 2. Mutation functions: inlined version/seq, then helpers dropped
-- ---------------------------------------------------------------------------

-- api_workspace_create
CREATE OR REPLACE FUNCTION public.api_workspace_create(
  p_section      text,
  p_title        text,
  p_organization text,
  p_start_date   text,
  p_end_date     text,
  p_location     text,
  p_bullets      jsonb,
  p_tags         text[],
  p_links        text[],
  p_attachments  jsonb,
  p_evidence     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_version  integer;
  v_seq      integer;
  v_position integer;
  v_id       uuid;
  v_att      jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT COALESCE(MAX(position), -1) + 1 INTO v_position
    FROM public.workspace_items
   WHERE user_id = v_user AND section = p_section AND deleted_at IS NULL;

  -- Version bump and its change_log row are written together in this
  -- transaction; the deferred constraint trigger below re-checks the pair at
  -- commit, so a version can never exist without a matching log entry.
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.workspace_versions WHERE user_id = v_user;
  INSERT INTO public.workspace_versions (user_id, version) VALUES (v_user, v_version);

  INSERT INTO public.workspace_items (
    user_id, section, title, organization, start_date, end_date, location,
    bullets, tags, links, evidence, position, workspace_version
  ) VALUES (
    v_user, p_section, p_title, p_organization,
    NULLIF(p_start_date, '')::date, NULLIF(p_end_date, '')::date, p_location,
    COALESCE(p_bullets, '[]'::jsonb), COALESCE(p_tags, '{}'), COALESCE(p_links, '{}'),
    p_evidence, v_position, v_version
  )
  RETURNING id INTO v_id;

  FOR v_att IN SELECT * FROM jsonb_array_elements(COALESCE(p_attachments, '[]'::jsonb))
  LOOP
    INSERT INTO public.evidence_links (user_id, workspace_item_id, url, label, kind)
    VALUES (v_user, v_id, COALESCE(v_att->>'url', ''), v_att->>'name', 'document');
  END LOOP;

  -- A verified item must be backed by a document or link (PRD §4.2).
  IF p_evidence = 'verified'
     AND NOT EXISTS (
       SELECT 1 FROM public.evidence_links
        WHERE workspace_item_id = v_id AND deleted_at IS NULL
     )
     AND COALESCE(array_length(p_links, 1), 0) = 0 THEN
    RAISE EXCEPTION 'verified item needs a supporting attachment or link'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.change_log WHERE user_id = v_user;

  INSERT INTO public.change_log (
    user_id, workspace_version, action, entity, entity_id, label, diff, seq
  ) VALUES (
    v_user, v_version, 'create', 'workspace_item', v_id, p_title,
    jsonb_build_object('section', p_section), v_seq
  );

  RETURN v_id;
END;
$$;

-- api_workspace_update
CREATE OR REPLACE FUNCTION public.api_workspace_update(p_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_version  integer;
  v_seq      integer;
  v_title    text;
  v_evidence text;
  v_has_link boolean;
  v_att      jsonb;
BEGIN
  PERFORM 1 FROM public.workspace_items
     WHERE id = p_id AND user_id = v_user AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.workspace_versions WHERE user_id = v_user;
  INSERT INTO public.workspace_versions (user_id, version) VALUES (v_user, v_version);

  UPDATE public.workspace_items SET
    section     = COALESCE(p_patch->>'section', section),
    title       = COALESCE(p_patch->>'title', title),
    organization = CASE WHEN p_patch ? 'organization' THEN p_patch->>'organization' ELSE organization END,
    location    = CASE WHEN p_patch ? 'location' THEN p_patch->>'location' ELSE location END,
    start_date  = CASE WHEN p_patch ? 'start_date' THEN NULLIF(p_patch->>'start_date', '')::date ELSE start_date END,
    end_date    = CASE WHEN p_patch ? 'end_date' THEN NULLIF(p_patch->>'end_date', '')::date ELSE end_date END,
    bullets     = CASE WHEN p_patch ? 'bullets'
                       THEN COALESCE(p_patch->'bullets', '[]'::jsonb) ELSE bullets END,
    tags        = CASE WHEN p_patch ? 'tags'
                       THEN ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_patch->'tags', '[]'::jsonb)))
                       ELSE tags END,
    links       = CASE WHEN p_patch ? 'links'
                       THEN ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_patch->'links', '[]'::jsonb)))
                       ELSE links END,
    evidence    = COALESCE(p_patch->>'evidence', evidence),
    position    = COALESCE((p_patch->>'position')::integer, position),
    workspace_version = v_version
  WHERE id = p_id AND user_id = v_user AND deleted_at IS NULL;

  IF p_patch ? 'attachments' THEN
    DELETE FROM public.evidence_links
     WHERE workspace_item_id = p_id AND user_id = v_user;
    FOR v_att IN SELECT * FROM jsonb_array_elements(COALESCE(p_patch->'attachments', '[]'::jsonb))
    LOOP
      INSERT INTO public.evidence_links (user_id, workspace_item_id, url, label, kind)
      VALUES (v_user, p_id, COALESCE(v_att->>'url', ''), v_att->>'name', 'document');
    END LOOP;
  END IF;

  SELECT title, evidence,
         EXISTS (
           SELECT 1 FROM public.evidence_links
            WHERE workspace_item_id = p_id AND deleted_at IS NULL
         ) OR EXISTS (
           SELECT 1 FROM unnest(links) AS l WHERE btrim(l) <> ''
         )
    INTO v_title, v_evidence, v_has_link
    FROM public.workspace_items
   WHERE id = p_id;

  IF v_evidence = 'verified' AND NOT v_has_link THEN
    RAISE EXCEPTION 'verified item needs a supporting attachment or link'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.change_log WHERE user_id = v_user;

  INSERT INTO public.change_log (
    user_id, workspace_version, action, entity, entity_id, label, diff, seq
  ) VALUES (
    v_user, v_version, 'update', 'workspace_item', p_id, v_title,
    '{}'::jsonb, v_seq
  );
END;
$$;

-- api_workspace_delete
CREATE OR REPLACE FUNCTION public.api_workspace_delete(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_version integer;
  v_seq     integer;
  v_title   text;
BEGIN
  UPDATE public.workspace_items
     SET deleted_at = now()
   WHERE id = p_id AND user_id = v_user AND deleted_at IS NULL
   RETURNING title INTO v_title;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.workspace_versions WHERE user_id = v_user;
  INSERT INTO public.workspace_versions (user_id, version) VALUES (v_user, v_version);

  SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.change_log WHERE user_id = v_user;

  INSERT INTO public.change_log (
    user_id, workspace_version, action, entity, entity_id, label, diff, seq
  ) VALUES (
    v_user, v_version, 'delete', 'workspace_item', p_id, v_title,
    '{}'::jsonb, v_seq
  );
END;
$$;

-- api_workspace_restore (logged as action 'restore'; the wire shows 'restore')
CREATE OR REPLACE FUNCTION public.api_workspace_restore(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_version integer;
  v_seq     integer;
  v_title   text;
BEGIN
  UPDATE public.workspace_items
     SET deleted_at = NULL
   WHERE id = p_id AND user_id = v_user AND deleted_at IS NOT NULL
   RETURNING title INTO v_title;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.workspace_versions WHERE user_id = v_user;
  INSERT INTO public.workspace_versions (user_id, version) VALUES (v_user, v_version);

  SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.change_log WHERE user_id = v_user;

  INSERT INTO public.change_log (
    user_id, workspace_version, action, entity, entity_id, label, diff, seq
  ) VALUES (
    v_user, v_version, 'restore', 'workspace_item', p_id, v_title,
    '{}'::jsonb, v_seq
  );
END;
$$;

-- api_workspace_reorder (one version bump, one change_log row per moved id)
CREATE OR REPLACE FUNCTION public.api_workspace_reorder(p_section text, p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_version integer;
  v_seq     integer;
  v_idx     integer;
  v_id      uuid;
  v_title   text;
BEGIN
  -- Every id must be an active item in the target section (ADR-017).
  IF EXISTS (
    SELECT 1 FROM unnest(p_ids) AS x(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.workspace_items wi
        WHERE wi.id = x.id AND wi.user_id = v_user
          AND wi.section = p_section AND wi.deleted_at IS NULL
     )
  ) THEN
    RAISE EXCEPTION 'reorder ids must all be active items in the section'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.workspace_versions WHERE user_id = v_user;
  INSERT INTO public.workspace_versions (user_id, version) VALUES (v_user, v_version);

  FOR v_idx IN 1..array_length(p_ids, 1) LOOP
    v_id := p_ids[v_idx];
    UPDATE public.workspace_items
       SET position = v_idx - 1
     WHERE id = v_id AND user_id = v_user AND deleted_at IS NULL
     RETURNING title INTO v_title;

    SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
      FROM public.change_log WHERE user_id = v_user;

    INSERT INTO public.change_log (
      user_id, workspace_version, action, entity, entity_id, label, diff, seq
    ) VALUES (
      v_user, v_version, 'reorder', 'workspace_item', v_id, v_title,
      '{}'::jsonb, v_seq
    );
  END LOOP;
END;
$$;

-- The two helpers no longer exist: their logic lives inside the callers above.
-- Revoke first so the intent is explicit even if the DROP were ever removed
-- (DROP removes the privileges anyway), then drop the standalone RPC surface.
REVOKE EXECUTE ON FUNCTION public.api_workspace_next_seq(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.api_workspace_next_version(uuid) FROM PUBLIC, anon;
DROP FUNCTION IF EXISTS public.api_workspace_next_seq(uuid);
DROP FUNCTION IF EXISTS public.api_workspace_next_version(uuid);

-- ---------------------------------------------------------------------------
-- 1. Grants: signed-in users only. PUBLIC/anon lose EXECUTE (Postgres grants
--    EXECUTE to PUBLIC by default), authenticated keeps it.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.api_workspace_create(
  text, text, text, text, text, text, jsonb, text[], text[], jsonb, text
) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.api_workspace_update(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.api_workspace_delete(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.api_workspace_restore(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.api_workspace_reorder(text, uuid[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.api_workspace_create(
  text, text, text, text, text, text, jsonb, text[], text[], jsonb, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_workspace_update(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_workspace_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_workspace_restore(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_workspace_reorder(text, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enforce "a workspace version always has a change_log entry".
--
-- The mutation functions write the workspace_versions row and its change_log
-- row in one transaction. This DEFERRED constraint trigger re-checks the pair
-- at commit, so a direct Data API insert into workspace_versions (which RLS
-- otherwise allows for a user's own rows) cannot desync the change log.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_version_has_changelog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.change_log
     WHERE user_id = NEW.user_id AND workspace_version = NEW.version
  ) THEN
    RAISE EXCEPTION 'workspace version % has no change_log entry', NEW.version
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS workspace_versions_require_changelog ON public.workspace_versions;
CREATE CONSTRAINT TRIGGER workspace_versions_require_changelog
  AFTER INSERT ON public.workspace_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_version_has_changelog();

-- ---------------------------------------------------------------------------
-- 4. set_updated_at(): pin search_path (it only needs now(), in pg_catalog).
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.set_updated_at() SET search_path = '';
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS: evaluate auth.uid() once per query, not per row (advisor 0003).
--    Only USING / WITH CHECK change; the policies keep TO authenticated.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'workspace_items', 'evidence_links', 'skills', 'skill_relations',
    'targets', 'jd_requirements', 'resumes', 'resume_claims', 'jobs', 'consent_records'
  ]
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON public.%I USING ((select auth.uid()) = user_id)',
      t || '_owner_select', t
    );
    EXECUTE format(
      'ALTER POLICY %I ON public.%I WITH CHECK ((select auth.uid()) = user_id)',
      t || '_owner_insert', t
    );
    EXECUTE format(
      'ALTER POLICY %I ON public.%I USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id)',
      t || '_owner_update', t
    );
    EXECUTE format(
      'ALTER POLICY %I ON public.%I USING ((select auth.uid()) = user_id)',
      t || '_owner_delete', t
    );
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'workspace_versions', 'change_log', 'analysis_reports', 'resume_versions', 'audit_events'
  ]
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON public.%I USING ((select auth.uid()) = user_id)',
      t || '_owner_select', t
    );
    EXECUTE format(
      'ALTER POLICY %I ON public.%I WITH CHECK ((select auth.uid()) = user_id)',
      t || '_owner_insert', t
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Cover the four unindexed foreign keys (advisor 0001).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS resume_claims_user_id_idx
  ON public.resume_claims (user_id);
CREATE INDEX IF NOT EXISTS resume_versions_user_id_idx
  ON public.resume_versions (user_id);
CREATE INDEX IF NOT EXISTS skill_relations_user_id_idx
  ON public.skill_relations (user_id);
CREATE INDEX IF NOT EXISTS skill_relations_to_skill_id_idx
  ON public.skill_relations (to_skill_id);
