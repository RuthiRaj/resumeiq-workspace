-- ResumeIQ B2 import parsing (Supabase Postgres).
--
-- Adds the two tables that hold what a document upload produced, plus the
-- SECURITY INVOKER functions that make creation and confirm atomic.
--
-- What is NOT stored here: the uploaded file itself. B2 parses the document in
-- memory and discards it (PRD §11); only the extracted text (`source_text`) and
-- the candidate items (`extraction` / `values`) are persisted, and the user can
-- delete the whole session row to remove them.
--
-- Why functions (same reasoning as 0002_workspace_api.sql): PostgREST serves one
-- statement per request, so "create the session + every review item" and
-- "create the workspace item + mark the review item confirmed" must each happen
-- inside a single transaction. The functions are SECURITY INVOKER, so they run
-- as the caller (`authenticated`) and Row Level Security stays effective. The
-- service_role key is never used.
--
-- Forward-only: run after 0003_hardening.sql. Not applied by the repository.

-- ---------------------------------------------------------------------------
-- import_sessions — one row per uploaded document (the file itself is discarded)
-- ---------------------------------------------------------------------------

CREATE TABLE public.import_sessions (
  id                uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  file_name         text        NOT NULL,
  file_type         text        NOT NULL CHECK (file_type IN ('pdf', 'docx')),
  file_size         integer     NOT NULL CHECK (file_size >= 0),
  -- DOCX does not record a page count; 1 is stored rather than an invented value.
  page_count        integer     NOT NULL DEFAULT 1 CHECK (page_count >= 1),
  -- Real extracted text for the side-by-side preview; '' when nothing could be read.
  source_text       text        NOT NULL DEFAULT '',
  preview_available boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX import_sessions_user_created_idx
  ON public.import_sessions (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- import_review_items — one candidate item per extracted section entry
-- ---------------------------------------------------------------------------

CREATE TABLE public.import_review_items (
  id                uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  import_id         uuid        NOT NULL REFERENCES public.import_sessions (id) ON DELETE CASCADE,
  -- The wire id the parser assigned ("ext-experience-1"); stable and unique per session.
  wire_id           text        NOT NULL,
  position          integer     NOT NULL DEFAULT 0,
  section           text        NOT NULL CHECK (section IN (
    'personal', 'education', 'experience', 'internship', 'project', 'skill',
    'achievement', 'extracurricular', 'certificate', 'course', 'publication', 'training'
  )),
  -- What the parser read: immutable, per-field confidence + 1-based sourceLine.
  extraction        jsonb       NOT NULL,
  -- What the user has verified; confirmation copies this, never `extraction` (IM-2).
  values            jsonb       NOT NULL,
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'rejected'
  )),
  -- {kind:'file', name} or {kind:'link', url}; NULL means no certificate attached.
  support           jsonb,
  decided_at        timestamptz,
  -- Set once, by api_import_confirm. NULL until the item is confirmed.
  workspace_item_id uuid        REFERENCES public.workspace_items (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_review_items_wire_unique UNIQUE (import_id, wire_id)
);

CREATE INDEX import_review_items_user_import_idx
  ON public.import_review_items (user_id, import_id, position);
CREATE INDEX import_review_items_workspace_item_idx
  ON public.import_review_items (workspace_item_id)
  WHERE workspace_item_id IS NOT NULL;

CREATE TRIGGER import_sessions_set_updated_at
  BEFORE UPDATE ON public.import_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER import_review_items_set_updated_at
  BEFORE UPDATE ON public.import_review_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Keep the session's updated_at meaningful: an item edit touches its session.
CREATE OR REPLACE FUNCTION public.touch_import_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.import_sessions SET updated_at = now() WHERE id = NEW.import_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_review_items_touch_session
  AFTER UPDATE ON public.import_review_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_import_session();

-- ---------------------------------------------------------------------------
-- Row Level Security: owner-only, using the `(select auth.uid())` initplan form
-- established in 0003_hardening.sql (evaluated once per statement).
-- ---------------------------------------------------------------------------

ALTER TABLE public.import_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_review_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_sessions_owner_select ON public.import_sessions
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY import_sessions_owner_insert ON public.import_sessions
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY import_sessions_owner_update ON public.import_sessions
  FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY import_sessions_owner_delete ON public.import_sessions
  FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);

CREATE POLICY import_review_items_owner_select ON public.import_review_items
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY import_review_items_owner_insert ON public.import_review_items
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY import_review_items_owner_update ON public.import_review_items
  FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY import_review_items_owner_delete ON public.import_review_items
  FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);

REVOKE ALL ON public.import_sessions     FROM anon, PUBLIC;
REVOKE ALL ON public.import_review_items FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_sessions     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_review_items TO authenticated;

-- ---------------------------------------------------------------------------
-- create session + its items (one transaction, caller's identity)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.api_import_create_session(
  p_file_name         text,
  p_file_type         text,
  p_file_size         integer,
  p_page_count        integer,
  p_source_text       text,
  p_preview_available boolean,
  p_items             jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_id      uuid;
  v_item    jsonb;
  v_pos     integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.import_sessions (
    user_id, file_name, file_type, file_size, page_count, source_text, preview_available
  ) VALUES (
    v_user, p_file_name, p_file_type, p_file_size, p_page_count, p_source_text, p_preview_available
  )
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    v_pos := v_pos + 1;
    INSERT INTO public.import_review_items (
      user_id, import_id, wire_id, position, section, extraction, values, status, support
    ) VALUES (
      v_user,
      v_id,
      v_item->>'wire_id',
      v_pos,
      v_item->>'section',
      COALESCE(v_item->'extraction', '{}'::jsonb),
      COALESCE(v_item->'values', '{}'::jsonb),
      'pending',
      CASE WHEN v_item ? 'support' THEN v_item->'support' ELSE NULL END
    );
  END LOOP;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- confirm one review item into the workspace (atomic + idempotent)
--
-- Nothing enters the workspace by any other path: this is the only function that
-- writes a workspace_items row from an import. A confirmed item is 'attested'
-- unless a certificate file or link was attached, in which case it is 'verified'
-- (IM-3). Calling it twice returns the same workspace item.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.api_import_confirm(
  p_import_id uuid,
  p_item_id   text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user         uuid := auth.uid();
  v_item         public.import_review_items%ROWTYPE;
  v_title        text;
  v_organization text;
  v_location     text;
  v_start        date;
  v_end          date;
  v_bullets      jsonb;
  v_tags         text[];
  v_links        text[];
  v_evidence     text;
  v_version      integer;
  v_seq          integer;
  v_position     integer;
  v_workspace_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_item
    FROM public.import_review_items
   WHERE import_id = p_import_id AND wire_id = p_item_id AND user_id = v_user
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review item not found' USING ERRCODE = 'P0003';
  END IF;

  -- Idempotent: a confirmed item keeps pointing at the item it created.
  IF v_item.status = 'confirmed' AND v_item.workspace_item_id IS NOT NULL THEN
    RETURN v_item.workspace_item_id;
  END IF;

  v_title := btrim(COALESCE(v_item.values->>'title', ''));
  IF v_title = '' THEN
    RAISE EXCEPTION 'a title is required to confirm an item' USING ERRCODE = 'P0001';
  END IF;

  v_organization := NULLIF(btrim(COALESCE(v_item.values->>'organization', '')), '');
  v_location     := NULLIF(btrim(COALESCE(v_item.values->>'location', '')), '');
  -- The wire rule is month precision ("YYYY-MM") or nothing. A value that does
  -- not match is dropped rather than coerced: never invent a date (ADR-028).
  v_start := CASE
    WHEN COALESCE(v_item.values->>'startDate', '') ~ '^\d{4}-(0[1-9]|1[0-2])$'
      THEN to_date(v_item.values->>'startDate' || '-01', 'YYYY-MM-DD')
    ELSE NULL
  END;
  v_end := CASE
    WHEN COALESCE(v_item.values->>'endDate', '') ~ '^\d{4}-(0[1-9]|1[0-2])$'
      THEN to_date(v_item.values->>'endDate' || '-01', 'YYYY-MM-DD')
    ELSE NULL
  END;

  v_bullets := COALESCE(v_item.values->'bullets', '[]'::jsonb);
  v_tags    := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(v_item.values->'tags', '[]'::jsonb))
  );

  -- A link becomes a link; a certificate file becomes a 'certificate' evidence
  -- link. The file itself is not stored in B2, so its url is an internal
  -- reference (B6 replaces it with a private-Storage signed URL, ADR-028).
  v_links := CASE
    WHEN v_item.support->>'kind' = 'link' THEN ARRAY[v_item.support->>'url']
    ELSE ARRAY[]::text[]
  END;
  v_evidence := CASE WHEN v_item.support IS NULL THEN 'attested' ELSE 'verified' END;

  SELECT COALESCE(MAX(position), -1) + 1 INTO v_position
    FROM public.workspace_items
   WHERE user_id = v_user AND section = v_item.section AND deleted_at IS NULL;

  -- Version bump + change_log append, inlined (ADR-018 dropped the
  -- api_workspace_next_version / _next_seq helpers). The version row and its
  -- change_log row land in this one transaction, which is what the deferred
  -- workspace_versions_require_changelog trigger checks at commit.
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.workspace_versions WHERE user_id = v_user;
  INSERT INTO public.workspace_versions (user_id, version) VALUES (v_user, v_version);

  INSERT INTO public.workspace_items (
    user_id, section, title, organization, start_date, end_date, location,
    bullets, tags, links, evidence, position, workspace_version
  ) VALUES (
    v_user, v_item.section, v_title, v_organization, v_start, v_end, v_location,
    v_bullets, v_tags, v_links, v_evidence, v_position, v_version
  )
  RETURNING id INTO v_workspace_id;

  IF v_item.support->>'kind' = 'file' THEN
    INSERT INTO public.evidence_links (user_id, workspace_item_id, url, label, kind)
    VALUES (
      v_user,
      v_workspace_id,
      'import://' || p_import_id::text || '/' || p_item_id,
      v_item.support->>'name',
      'certificate'
    );
  END IF;

  SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.change_log WHERE user_id = v_user;

  INSERT INTO public.change_log (
    user_id, workspace_version, action, entity, entity_id, label, diff, seq
  ) VALUES (
    v_user, v_version, 'create', 'workspace_item', v_workspace_id, v_title,
    jsonb_build_object('section', v_item.section, 'source', 'import'),
    v_seq
  );

  UPDATE public.import_review_items
     SET status = 'confirmed', decided_at = now(), workspace_item_id = v_workspace_id
   WHERE id = v_item.id;

  RETURN v_workspace_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: signed-in users only. PUBLIC/anon lose EXECUTE explicitly, because
-- Postgres grants EXECUTE to PUBLIC by default (same hardening as 0003).
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.api_import_create_session(
  text, text, integer, integer, text, boolean, jsonb
) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.api_import_confirm(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.touch_import_session() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.api_import_create_session(
  text, text, integer, integer, text, boolean, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_import_confirm(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_import_session() TO authenticated;
