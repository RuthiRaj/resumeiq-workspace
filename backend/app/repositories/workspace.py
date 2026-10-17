"""Workspace repository: interface + Supabase Data API implementation.

Data access note (see ``docs/DECISIONS.md`` ADR-016): the backend talks to
Supabase through the **Data API (PostgREST)** passing the *caller's* JWT.
PostgREST sets ``request.jwt.claims`` / role ``authenticated`` for the request,
so every statement runs as ``auth.uid()`` and Row Level Security is enforced by
Postgres itself — the ``service_role`` key (which bypasses RLS) is never used.

Mutations run through ``SECURITY INVOKER`` SQL functions (``db/migrations/
0002_workspace_api.sql``). Because the function runs as the caller, RLS stays
effective; because it runs inside the single PostgREST request transaction, the
version bump and the append-only ``change_log`` row commit atomically with the
item change. The ``service_role`` key is never used.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import httpx

from app.repositories.errors import (
    DataApiNotConfiguredError,
    InvalidReorderError,
    ItemNotFoundError,
    RepositoryError,
)
from app.schemas.workspace import (
    Attachment,
    ChangeLogEntryResponse,
    WorkspaceItemCreate,
    WorkspaceItemResponse,
    WorkspaceResponse,
)

# DB ``change_log.action`` -> wire ``ChangeLogEntryResponse.op`` (ADR-017):
# the mapping is 1:1, including ``restore`` — the frontend enum now carries it
# (ADR-019), so an undo is no longer collapsed into an ``edit``.
_ACTION_TO_OP = {
    "create": "add",
    "update": "edit",
    "restore": "restore",
    "delete": "delete",
    "reorder": "reorder",
}

_WIRE_TO_DB = {
    "title": "title",
    "organization": "organization",
    "location": "location",
    "evidence": "evidence",
    "bullets": "bullets",
    "tags": "tags",
    "links": "links",
    "section": "section",
    "order": "position",
}


@runtime_checkable
class WorkspaceRepository(Protocol):
    """Per-user workspace persistence. Implementations must scope every call to
    ``user_id`` *and* rely on RLS where a database is involved."""

    async def get_workspace(self, user_id: str) -> WorkspaceResponse: ...

    async def get_item(self, user_id: str, item_id: str) -> WorkspaceItemResponse | None: ...

    async def list_changelog(self, user_id: str) -> list[ChangeLogEntryResponse]: ...

    async def create_item(
        self, user_id: str, item: WorkspaceItemCreate
    ) -> WorkspaceItemResponse: ...

    async def update_item(
        self, user_id: str, item_id: str, patch: dict[str, object]
    ) -> WorkspaceItemResponse: ...

    async def soft_delete_item(self, user_id: str, item_id: str) -> None: ...

    async def restore_item(self, user_id: str, item_id: str) -> WorkspaceItemResponse: ...

    async def reorder(
        self, user_id: str, section: str, ordered_ids: list[str]
    ) -> WorkspaceResponse: ...


def to_db_date(value: str | None) -> str | None:
    """Normalize a wire ``YYYY`` / ``YYYY-MM`` value to a DB ``date`` string.

    The editor uses ``<input type="month">`` so values are month precision; the
    ``date`` column needs a day, so we store the first of the month. Full dates
    and empty strings pass through (``""`` becomes ``None``).
    """
    if value is None or value.strip() == "":
        return None
    text = value.strip()
    if len(text) == 4 and text.isdigit():
        return f"{text}-01-01"
    if len(text) == 7 and text[4] == "-":
        return f"{text}-01"
    return text


def from_db_date(value: object) -> str | None:
    """DB ``date`` -> wire month-precision string (round-trips client values)."""
    if value is None:
        return None
    text = str(value)
    return text[:7] if len(text) >= 7 else text


def _as_dict(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return {str(k): v for k, v in value.items()}
    return {}


def _as_list(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


class SupabaseWorkspaceRepository:
    """PostgREST-backed repository. One instance per request, bound to one JWT."""

    def __init__(
        self,
        rest_url: str,
        publishable_key: str,
        access_token: str,
        *,
        timeout: float = 10.0,
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
        json: dict[str, object] | None = None,
    ) -> httpx.Response:
        async with httpx.AsyncClient(
            base_url=self._base,
            headers=self._headers,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            return await client.request(method, path, params=params, json=json)

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.is_success:
            return
        body = _as_dict(_safe_json(response))
        code = str(body.get("code", ""))
        if code == "P0002" or response.status_code == 404:
            raise ItemNotFoundError(str(body.get("details", "")))
        raise RepositoryError(
            f"Data API error {response.status_code}: {body.get('message', 'unknown')}"
        )

    def _row_to_item(self, row: dict[str, object]) -> WorkspaceItemResponse:
        links = [str(link) for link in _as_list(row.get("links"))]
        attachments = [
            Attachment(
                id=str(_as_dict(link).get("id", "")),
                name=str(_as_dict(link).get("label") or _as_dict(link).get("url") or ""),
                url=str(_as_dict(link).get("url", "")),
            )
            for link in _as_list(row.get("evidence_links"))
        ]
        return WorkspaceItemResponse(
            id=str(row.get("id")),
            section=str(row.get("section")),
            title=str(row.get("title", "")),
            organization=_opt_str(row.get("organization")),
            startDate=from_db_date(row.get("start_date")),
            endDate=from_db_date(row.get("end_date")),
            location=_opt_str(row.get("location")),
            bullets=[str(b) for b in _as_list(row.get("bullets"))],
            tags=[str(t) for t in _as_list(row.get("tags"))],
            links=links,
            attachments=attachments,
            evidence=str(row.get("evidence", "attested")),
            order=_as_int(row.get("position", 0)),
            deletedAt=_opt_str(row.get("deleted_at")),
        )

    async def _current_version(self, user_id: str) -> tuple[int, str | None]:
        response = await self._request(
            "GET",
            "/workspace_versions",
            params={
                "user_id": f"eq.{user_id}",
                "select": "version,created_at",
                "order": "version.desc",
                "limit": "1",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(r) for r in _as_list(_safe_json(response))]
        if not rows:
            return 1, None
        return _as_int(rows[0].get("version", 1)), _opt_str(rows[0].get("created_at"))

    async def get_workspace(self, user_id: str) -> WorkspaceResponse:
        response = await self._request(
            "GET",
            "/workspace_items",
            params={
                "user_id": f"eq.{user_id}",
                "deleted_at": "is.null",
                "select": (
                    "id,section,title,organization,start_date,end_date,location,"
                    "bullets,tags,links,evidence,position,updated_at,"
                    "evidence_links(id,url,label)"
                ),
                "order": "position.asc,created_at.asc",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(r) for r in _as_list(_safe_json(response))]
        items = [self._row_to_item(row) for row in rows]
        version, version_at = await self._current_version(user_id)
        updated_at = version_at or _latest_updated_at(rows) or _now_iso()
        return WorkspaceResponse(version=version, items=items, updatedAt=updated_at)

    async def get_item(self, user_id: str, item_id: str) -> WorkspaceItemResponse | None:
        response = await self._request(
            "GET",
            "/workspace_items",
            params={
                "id": f"eq.{item_id}",
                "user_id": f"eq.{user_id}",
                "select": (
                    "id,section,title,organization,start_date,end_date,location,"
                    "bullets,tags,links,evidence,position,deleted_at,updated_at,"
                    "evidence_links(id,url,label)"
                ),
                "limit": "1",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(r) for r in _as_list(_safe_json(response))]
        return self._row_to_item(rows[0]) if rows else None

    async def list_changelog(self, user_id: str) -> list[ChangeLogEntryResponse]:
        response = await self._request(
            "GET",
            "/change_log",
            params={
                "user_id": f"eq.{user_id}",
                "entity": "eq.workspace_item",
                "select": "seq,workspace_version,entity_id,action,created_at,label",
                "order": "seq.desc",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(r) for r in _as_list(_safe_json(response))]
        entries: list[ChangeLogEntryResponse] = []
        for row in rows:
            action = str(row.get("action", ""))
            entries.append(
                ChangeLogEntryResponse(
                    seq=_as_int(row.get("seq", 0)),
                    workspaceVersion=_as_int(row.get("workspace_version", 0)),
                    itemId=str(row.get("entity_id", "")),
                    op=_ACTION_TO_OP.get(action, "edit"),
                    at=str(row.get("created_at", "")),
                    label=_opt_str(row.get("label")),
                )
            )
        return entries

    async def create_item(self, user_id: str, item: WorkspaceItemCreate) -> WorkspaceItemResponse:
        body: dict[str, object] = {
            "p_section": item.section,
            "p_title": item.title,
            "p_organization": item.organization,
            "p_start_date": to_db_date(item.startDate),
            "p_end_date": to_db_date(item.endDate),
            "p_location": item.location,
            "p_bullets": item.bullets,
            "p_tags": item.tags,
            "p_links": item.links,
            "p_attachments": [a.model_dump() for a in item.attachments],
            "p_evidence": item.evidence,
        }
        response = await self._request("POST", "/rpc/api_workspace_create", json=body)
        self._raise_for_status(response)
        created_id = _as_uuid(_safe_json(response))
        if not created_id:
            raise RepositoryError("create_item returned no id")
        created = await self.get_item(user_id, created_id)
        if created is None:
            raise RepositoryError("create_item created an item that could not be read back")
        return created

    async def update_item(
        self, user_id: str, item_id: str, patch: dict[str, object]
    ) -> WorkspaceItemResponse:
        db_patch: dict[str, object] = {}
        for key, value in patch.items():
            db_column = _WIRE_TO_DB.get(key)
            if db_column is None:
                continue
            if key in ("startDate", "endDate"):
                continue
            db_patch[db_column] = value
        if "startDate" in patch:
            db_patch["start_date"] = to_db_date(_opt_str(patch["startDate"]))
        if "endDate" in patch:
            db_patch["end_date"] = to_db_date(_opt_str(patch["endDate"]))
        attachments = patch.get("attachments")
        if isinstance(attachments, list):
            converted: list[object] = [
                entry.model_dump() if isinstance(entry, Attachment) else entry
                for entry in attachments
            ]
            db_patch["attachments"] = converted
        response = await self._request(
            "POST",
            "/rpc/api_workspace_update",
            json={"p_id": item_id, "p_patch": db_patch},
        )
        self._raise_for_status(response)
        updated = await self.get_item(user_id, item_id)
        if updated is None or updated.deletedAt is not None:
            raise ItemNotFoundError(item_id)
        return updated

    async def soft_delete_item(self, user_id: str, item_id: str) -> None:
        response = await self._request("POST", "/rpc/api_workspace_delete", json={"p_id": item_id})
        self._raise_for_status(response)

    async def restore_item(self, user_id: str, item_id: str) -> WorkspaceItemResponse:
        response = await self._request("POST", "/rpc/api_workspace_restore", json={"p_id": item_id})
        self._raise_for_status(response)
        restored = await self.get_item(user_id, item_id)
        if restored is None:
            raise ItemNotFoundError(item_id)
        return restored

    async def reorder(
        self, user_id: str, section: str, ordered_ids: list[str]
    ) -> WorkspaceResponse:
        response = await self._request(
            "POST",
            "/rpc/api_workspace_reorder",
            json={"p_section": section, "p_ids": ordered_ids},
        )
        if not response.is_success:
            body = _as_dict(_safe_json(response))
            if str(body.get("code", "")) == "P0001":
                raise InvalidReorderError(str(body.get("message", "invalid reorder")))
            self._raise_for_status(response)
        return await self.get_workspace(user_id)


def _opt_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


def _as_int(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return default
    return default


def _now_iso() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat()


def _latest_updated_at(rows: list[dict[str, object]]) -> str | None:
    values = [str(r["updated_at"]) for r in rows if r.get("updated_at")]
    return max(values) if values else None


def _safe_json(response: httpx.Response) -> object:
    try:
        return response.json()
    except ValueError:
        return None


def _as_uuid(value: object) -> str | None:
    if isinstance(value, str) and value:
        return value
    if isinstance(value, dict):
        return _opt_str(value.get("api_workspace_create"))
    return None
