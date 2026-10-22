"""Complete user-data export and account data deletion (B6, PRD §6.9 EX-2).

Same data-access rule as every other repository (ADR-016): PostgREST is called
with the *caller's* JWT, so RLS evaluates as ``auth.uid()`` and the service_role
key is never present in this process.

Reads use one ``select=*`` query per public table, filtered by ``user_id``.
Nothing from ``auth`` is read. The account-deletion write calls one narrowly
scoped ``SECURITY DEFINER`` function from migration 0008; the function takes no
user id, resolves the caller with ``auth.uid()`` and deletes only public rows.
The resulting auth-user remaining step is documented in ADR-043 and surfaced in
the API response, never hidden.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx

from app.repositories.errors import (
    AccountDeletionUnavailableError,
    DataApiNotConfiguredError,
    DataExportUnavailableError,
)
from app.repositories.workspace import _as_dict, _as_list, _safe_json

#: Export field -> public table. Keep this list explicit: a new user-owned table
#: must be added here and in ``docs/api/contract-proposals.md`` §9 so the export
#: cannot silently omit it.
EXPORT_TABLES: dict[str, str] = {
    "workspace": "workspace_items",
    "workspaceVersions": "workspace_versions",
    "evidenceLinks": "evidence_links",
    "changeLog": "change_log",
    "targets": "targets",
    "jdRequirements": "jd_requirements",
    "reports": "analysis_reports",
    "analysisRuns": "jobs",
    "resumes": "resumes",
    "resumeVersions": "resume_versions",
    "resumeClaims": "resume_claims",
    "consentRecords": "consent_records",
    "imports": "import_sessions",
    "importReviewItems": "import_review_items",
    "skills": "skills",
    "skillRelations": "skill_relations",
    "auditEvents": "audit_events",
}

PROFILE_TABLE = "profiles"


@dataclass(frozen=True)
class ExportSnapshot:
    """Raw rows keyed by exported field name (plus the optional profile row)."""

    tables: dict[str, list[dict[str, object]]]
    profile: dict[str, object] | None = None


@runtime_checkable
class DataExportRepository(Protocol):
    async def export_user(self, user_id: str) -> ExportSnapshot: ...

    async def delete_user_data(self, user_id: str) -> dict[str, int]: ...


class SupabaseDataExportRepository:
    """PostgREST-backed export/deletion repository bound to one JWT."""

    def __init__(
        self,
        rest_url: str,
        publishable_key: str,
        access_token: str,
        *,
        timeout: float = 20.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not rest_url or not publishable_key:
            raise DataApiNotConfiguredError("Supabase Data API is not configured.")
        self._base = rest_url.rstrip("/")
        self._headers = {
            "apikey": publishable_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        self._timeout = timeout
        self._transport = transport

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: object | None = None,
    ) -> httpx.Response:
        async with httpx.AsyncClient(
            base_url=self._base,
            headers=self._headers,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            return await client.request(method, path, params=params, json=json)

    @staticmethod
    def _rows(response: httpx.Response, table: str) -> list[dict[str, object]]:
        if not response.is_success:
            body = _as_dict(_safe_json(response))
            raise DataExportUnavailableError(
                f"Reading {table} failed ({response.status_code}): {body.get('message', 'unknown')}"
            )
        return [_as_dict(row) for row in _as_list(_safe_json(response))]

    async def _table(self, table: str, user_id: str) -> list[dict[str, object]]:
        response = await self._request(
            "GET",
            f"/{table}",
            params={"user_id": f"eq.{user_id}", "select": "*"},
        )
        return self._rows(response, table)

    async def export_user(self, user_id: str) -> ExportSnapshot:
        tables: dict[str, list[dict[str, object]]] = {}
        for field, table in EXPORT_TABLES.items():
            tables[field] = await self._table(table, user_id)
        profile_rows = await self._table(PROFILE_TABLE, user_id)
        return ExportSnapshot(tables=tables, profile=profile_rows[0] if profile_rows else None)

    async def delete_user_data(self, user_id: str) -> dict[str, int]:
        # ``user_id`` is intentionally not sent: the RPC uses auth.uid(), so a
        # forged id cannot delete another user's rows.
        response = await self._request("POST", "/rpc/api_account_delete_data", json={})
        if not response.is_success:
            body = _as_dict(_safe_json(response))
            raise AccountDeletionUnavailableError(
                f"Account data deletion is unavailable: {body.get('message', response.status_code)}"
            )
        payload = _as_dict(_safe_json(response))
        counts: dict[str, int] = {}
        for key, value in payload.items():
            if isinstance(value, bool) or not isinstance(value, int | float | str):
                continue
            try:
                counts[str(key)] = int(value)
            except ValueError:
                continue
        return counts
