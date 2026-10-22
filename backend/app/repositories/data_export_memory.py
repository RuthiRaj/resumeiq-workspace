"""In-memory data-export/account-deletion repository (B6 tests, no network).

The double mirrors the two rules the Supabase implementation relies on:

* every read and delete is filtered by ``user_id`` (so a caller can never see or
  remove another user's rows, even if a bug forgets a filter upstream);
* deletion runs in dependency order (children before parents), so a real
  Postgres deployment behaves the same way as this double.

Rows are opaque dictionaries, exactly like the stored JSON the real export
returns. Tests seed them directly.
"""

from __future__ import annotations

from app.repositories.data_export import (
    EXPORT_TABLES,
    DataExportRepository,
    ExportSnapshot,
)

#: Child rows first. The list is also the order used by migration 0008.
DELETE_ORDER: tuple[str, ...] = (
    "resumeClaims",
    "resumeVersions",
    "resumes",
    "evidenceLinks",
    "importReviewItems",
    "imports",
    "jdRequirements",
    "reports",
    "analysisRuns",
    "targets",
    "changeLog",
    "workspaceVersions",
    "workspace",
    "skillRelations",
    "skills",
    "consentRecords",
    "auditEvents",
)


class InMemoryDataExportRepository(DataExportRepository):
    """Per-user rows held in memory; only the caller's rows are ever returned."""

    def __init__(self, tables: dict[str, list[dict[str, object]]] | None = None) -> None:
        self.tables: dict[str, list[dict[str, object]]] = {field: [] for field in DELETE_ORDER}
        self.profiles: list[dict[str, object]] = []
        for field, rows in (tables or {}).items():
            self.tables[field] = [dict(row) for row in rows]

    # -- test helpers --------------------------------------------------------

    def add(self, field: str, row: dict[str, object]) -> dict[str, object]:
        """Seed one row; ``field`` is an export key such as ``workspace``."""
        if field == "profile":
            self.profiles.append(dict(row))
        else:
            self.tables.setdefault(field, []).append(dict(row))
        return row

    def rows_for(self, field: str, user_id: str) -> list[dict[str, object]]:
        return [row for row in self.tables.get(field, []) if str(row.get("user_id")) == user_id]

    # -- protocol ------------------------------------------------------------

    async def export_user(self, user_id: str) -> ExportSnapshot:
        tables = {
            field: [dict(row) for row in rows if str(row.get("user_id")) == user_id]
            for field, rows in self.tables.items()
        }
        profile = next(
            (dict(row) for row in self.profiles if str(row.get("user_id")) == user_id),
            None,
        )
        return ExportSnapshot(tables=tables, profile=profile)

    async def delete_user_data(self, user_id: str) -> dict[str, int]:
        # Counts use the public table names, matching the 0008 RPC's jsonb keys
        # (``resume_claims``, not the export field ``resumeClaims``).
        counts: dict[str, int] = {}
        for field in DELETE_ORDER:
            rows = self.tables.get(field, [])
            kept = [row for row in rows if str(row.get("user_id")) != user_id]
            counts[EXPORT_TABLES.get(field, field)] = len(rows) - len(kept)
            self.tables[field] = kept
        kept_profiles = [row for row in self.profiles if str(row.get("user_id")) != user_id]
        counts["profiles"] = len(self.profiles) - len(kept_profiles)
        self.profiles = kept_profiles
        return counts
