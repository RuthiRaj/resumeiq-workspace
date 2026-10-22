"""Text-level checks for forward-only migrations (no database required)."""

from __future__ import annotations

import re
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "db" / "migrations"
FIXES = MIGRATIONS / "0006_fixes.sql"
PRIVACY = MIGRATIONS / "0008_privacy.sql"


def normalized(sql: str) -> str:
    """Collapse whitespace so a statement can be matched across line breaks."""
    return re.sub(r"\s+", " ", sql).strip()


def test_0006_sets_target_length_default_to_the_wire_value() -> None:
    sql = normalized(FIXES.read_text(encoding="utf-8"))

    statement = (
        r"ALTER TABLE public\.targets "
        r"ALTER COLUMN length SET DEFAULT 'one_page' ?;"
    )
    assert re.search(statement, sql, re.IGNORECASE), (
        "0006 must set targets.length to the wire value 'one_page'"
    )
    # The old default is invalid under targets_length_check and must be gone.
    assert not re.search(
        r"ALTER TABLE public\.targets ALTER COLUMN length SET DEFAULT 'one-page'",
        sql,
        re.IGNORECASE,
    )


def test_0006_indexes_jobs_target_id_with_target_id_first() -> None:
    sql = normalized(FIXES.read_text(encoding="utf-8"))

    statement = (
        r"CREATE INDEX IF NOT EXISTS jobs_target_idx "
        r"ON public\.jobs \(target_id\) ?;"
    )
    assert len(re.findall(statement, sql, re.IGNORECASE)) == 1, (
        "0006 must add exactly one index whose leading column is jobs.target_id"
    )


def test_0008_allows_only_owner_deletion_of_saved_versions() -> None:
    sql = normalized(PRIVACY.read_text(encoding="utf-8"))

    policy = (
        r"CREATE POLICY resume_versions_owner_delete ON public\.resume_versions "
        r"FOR DELETE TO authenticated USING \(\(select auth\.uid\(\)\) = user_id\);"
    )
    assert re.search(policy, sql, re.IGNORECASE), (
        "0008 must add an owner-scoped DELETE policy for resume_versions"
    )
    # The history table still has no UPDATE policy: purge goes through the RPC.
    assert not re.search(
        r"CREATE POLICY [a-z_]+ ON public\.resume_versions FOR UPDATE", sql, re.IGNORECASE
    )


def test_0008_version_purge_is_narrow_and_security_definer() -> None:
    sql = normalized(PRIVACY.read_text(encoding="utf-8"))

    assert re.search(
        r"CREATE OR REPLACE FUNCTION public\.api_resume_version_purge\( "
        r"p_resume_id uuid, p_version_id uuid, p_snapshot jsonb \).*?"
        r"SECURITY DEFINER SET search_path = public, pg_temp",
        sql,
        re.IGNORECASE,
    )
    # It rewrites only the snapshot and checks both the owner and the resume.
    assert "SET snapshot = p_snapshot" in sql
    assert re.search(
        r"WHERE id = p_version_id AND resume_id = p_resume_id AND user_id = v_user",
        sql,
        re.IGNORECASE,
    )
    assert not re.search(r"UPDATE public\.resume_versions SET (?!snapshot)", sql, re.IGNORECASE)
    assert "REVOKE EXECUTE ON FUNCTION public.api_resume_version_purge(uuid, uuid, jsonb)" in sql
    assert (
        "GRANT EXECUTE ON FUNCTION public.api_resume_version_purge(uuid, uuid, jsonb)"
        " TO authenticated" in sql
    )


def test_0008_account_delete_takes_no_user_id_and_stays_in_public() -> None:
    sql = normalized(PRIVACY.read_text(encoding="utf-8"))

    assert re.search(
        r"CREATE OR REPLACE FUNCTION public\.api_account_delete_data\(\) "
        r"RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp",
        sql,
        re.IGNORECASE,
    )
    # The auth identity is never deleted by this function.
    assert not re.search(r"DELETE FROM auth\.", sql, re.IGNORECASE)
    assert "REVOKE EXECUTE ON FUNCTION public.api_account_delete_data() FROM PUBLIC, anon;" in sql
    assert "GRANT EXECUTE ON FUNCTION public.api_account_delete_data() TO authenticated" in sql


def test_0008_deletes_children_before_parents() -> None:
    sql = normalized(PRIVACY.read_text(encoding="utf-8"))

    def position(table: str) -> int:
        match = re.search(rf"DELETE FROM public\.{table} WHERE user_id = v_user;", sql)
        assert match is not None, f"0008 must delete {table}"
        return match.start()

    assert position("resume_claims") < position("resume_versions") < position("resumes")
    assert position("import_review_items") < position("import_sessions")
    assert position("jd_requirements") < position("targets")
    assert position("evidence_links") < position("workspace_items")
    assert position("skill_relations") < position("skills")
    assert position("profiles") == max(
        position(table)
        for table in (
            "resume_claims",
            "resume_versions",
            "resumes",
            "evidence_links",
            "import_review_items",
            "import_sessions",
            "jd_requirements",
            "analysis_reports",
            "jobs",
            "targets",
            "change_log",
            "workspace_versions",
            "workspace_items",
            "skill_relations",
            "skills",
            "consent_records",
            "audit_events",
            "profiles",
        )
    )
