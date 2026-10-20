"""Text-level checks for forward-only migrations (no database required)."""

from __future__ import annotations

import re
from pathlib import Path

FIXES = Path(__file__).resolve().parents[1] / "db" / "migrations" / "0006_fixes.sql"


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
