-- ResumeIQ B1 workspace API (Supabase Postgres).
--
-- Adds the two readable fields the F3 wire changelog needs (ADR-017) and the
-- SECURITY INVOKER functions that make each workspace mutation atomic.
--
-- Why functions: the wire requires "increment the per-user workspace version
-- and append the change_log row in the same transaction". PostgREST serves one
-- statement per request, so multi-row versioning must happen inside a single
-- database transaction — hence these functions. They are SECURITY INVOKER, so
-- they run as the calling role (`authenticated`) and Row Level Security stays
-- effective. The service_role key is never used.
--
-- Forward-only: run after 0001_initial.sql.

-- ---------------------------------------------------------------------------
-- change_log: readable label + per-user monotonic seq (ADR-017)
-- ---------------------------------------------------------------------------

ALTER TABLE public.change_log ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.change_log ADD COLUMN IF NOT EXISTS seq   integer;

-- Backfill any pre-existing rows (none on a fresh project) with a stable order.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn
  FROM public.change_log
)
UPDATE public.change_log AS c
   SET seq = o.rn
  FROM ordered AS o
 WHERE c.id = o.id AND c.seq IS NULL;

ALTER TABLE public.change_log ALTER COLUMN seq SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS change_log_user_seq_idx
  ON public.change_log (user_id, seq);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.api_workspace_next_seq(p_user uuid)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(seq), 0) + 1 FROM public.change_log WHERE user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.api_workspace_next_version(p_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next
    FROM public.workspace_versions WHERE user_id = p_user;
  INSERT INTO public.workspace_versions (user_id, version) VALUES (p_user, v_next);
  RETURN v_next;
END;
$$;

-- ---------------------------------------------------------------------------
-- create
-- ---------------------------------------------------------------------------

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

  v_version := public.api_workspace_next_version(v_user);

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

  INSERT INTO public.change_log (
    user_id, workspace_version, action, entity, entity_id, label, diff, seq
  ) VALUES (
    v_user, v_version, 'create', 'workspace_item', v_id, p_title,
    jsonb_build_object('section', p_section), public.api_workspace_next_seq(v_user)
  );

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- update
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.api_workspace_update(p_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_version  integer;
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

  v_version := public.api_workspace_next_version(v_user);

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

  INSERT INTO public.change_log (
    user_id, workspace_version, action, entity, entity_id, label, diff, seq
  ) VALUES (
    v_user, v_version, 'update', 'workspace_item', p_id, v_title,
    '{}'::jsonb, public.api_workspace_next_seq(v_user)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- soft delete
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.api_workspace_delete(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_version integer;
  v_title   text;
BEGIN
  UPDATE public.workspace_items
     SET deleted_at = now()
   WHERE id = p_id AND user_id = v_user AND deleted_at IS NULL
   RETURNING title INTO v_title;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found' USING ERRCODE = 'P0002';
  END IF;

  v_version := public.api_workspace_next_version(v_user);

  INSERT INTO public.change_log (
    user_id, workspace_version, action, entity, entity_id, label, diff, seq
  ) VALUES (
    v_user, v_version, 'delete', 'workspace_item', p_id, v_title,
    '{}'::jsonb, public.api_workspace_next_seq(v_user)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- restore (undo a soft delete) — logged as action 'restore' (surfaced as 'restore')
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.api_workspace_restore(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_version integer;
  v_title   text;
BEGIN
  UPDATE public.workspace_items
     SET deleted_at = NULL
   WHERE id = p_id AND user_id = v_user AND deleted_at IS NOT NULL
   RETURNING title INTO v_title;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found' USING ERRCODE = 'P0002';
  END IF;

  v_version := public.api_workspace_next_version(v_user);

  INSERT INTO public.change_log (
    user_id, workspace_version, action, entity, entity_id, label, diff, seq
  ) VALUES (
    v_user, v_version, 'restore', 'workspace_item', p_id, v_title,
    '{}'::jsonb, public.api_workspace_next_seq(v_user)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- reorder (one version bump, one change_log row per moved id)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.api_workspace_reorder(p_section text, p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_version integer;
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

  v_version := public.api_workspace_next_version(v_user);

  FOR v_idx IN 1..array_length(p_ids, 1) LOOP
    v_id := p_ids[v_idx];
    UPDATE public.workspace_items
       SET position = v_idx - 1
     WHERE id = v_id AND user_id = v_user AND deleted_at IS NULL
     RETURNING title INTO v_title;
    INSERT INTO public.change_log (
      user_id, workspace_version, action, entity, entity_id, label, diff, seq
    ) VALUES (
      v_user, v_version, 'reorder', 'workspace_item', v_id, v_title,
      '{}'::jsonb, public.api_workspace_next_seq(v_user)
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: expose the functions to signed-in users only. RLS still applies
-- (SECURITY INVOKER); EXECUTE is granted explicitly because Supabase is moving
-- to opt-in default privileges.
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.api_workspace_next_seq(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_workspace_next_version(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_workspace_create(
  text, text, text, text, text, text, jsonb, text[], text[], jsonb, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_workspace_update(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_workspace_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_workspace_restore(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_workspace_reorder(text, uuid[]) TO authenticated;
