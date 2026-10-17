"""Supabase repository mapping tests.

Uses an ``httpx.MockTransport`` so the PostgREST request/response handling is
exercised without a live project or any credentials.
"""

import asyncio

import httpx
import pytest

from app.repositories.errors import ItemNotFoundError
from app.repositories.workspace import (
    SupabaseWorkspaceRepository,
    from_db_date,
    to_db_date,
)
from app.schemas.workspace import Attachment, WorkspaceItemCreate

ITEM_ROW = {
    "id": "i1",
    "section": "skill",
    "title": "TypeScript",
    "organization": None,
    "start_date": "2022-09-01",
    "end_date": None,
    "location": None,
    "bullets": ["b1"],
    "tags": ["tag"],
    "links": ["https://example.com"],
    "evidence": "attested",
    "position": 3,
    "updated_at": "2026-10-17T12:00:00Z",
    "deleted_at": None,
    "evidence_links": [{"id": "a1", "url": "https://example.com/cert", "label": "cert.pdf"}],
}


def repo(handler: "callable[[httpx.Request], httpx.Response]") -> SupabaseWorkspaceRepository:
    return SupabaseWorkspaceRepository(
        "https://project.supabase.co/rest/v1",
        "publishable-key",
        "user-jwt",
        transport=httpx.MockTransport(handler),
    )


def test_date_fields_round_trip_month_precision() -> None:
    assert to_db_date("2022-09") == "2022-09-01"
    assert to_db_date("2022") == "2022-01-01"
    assert to_db_date("2022-09-15") == "2022-09-15"
    assert to_db_date("") is None
    assert from_db_date("2022-09-01") == "2022-09"
    assert from_db_date(None) is None


def test_get_workspace_maps_row_and_headers() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/workspace_versions"):
            return httpx.Response(200, json=[{"version": 5, "created_at": "2026-10-17T11:00:00Z"}])
        return httpx.Response(200, json=[ITEM_ROW])

    async def run() -> None:
        workspace = await repo(handler).get_workspace("user-a")
        assert workspace.version == 5
        assert workspace.updatedAt == "2026-10-17T11:00:00Z"
        item = workspace.items[0]
        assert item.order == 3  # DB position -> wire order
        assert item.startDate == "2022-09"
        assert item.attachments[0].name == "cert.pdf"
        assert item.links == ["https://example.com"]

    asyncio.run(run())
    # The caller's JWT is forwarded so Postgres enforces RLS as auth.uid().
    assert all(r.headers["authorization"] == "Bearer user-jwt" for r in seen)
    assert all(r.headers["apikey"] == "publishable-key" for r in seen)


def test_create_calls_rpc_then_reads_item_back() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/rpc/api_workspace_create"):
            return httpx.Response(200, json="new-id")
        return httpx.Response(200, json=[{**ITEM_ROW, "id": "new-id"}])

    async def run() -> None:
        created = await repo(handler).create_item(
            "user-a",
            WorkspaceItemCreate(
                section="skill",
                title="TypeScript",
                evidence="verified",
                links=["https://example.com"],
                attachments=[Attachment(id="a1", name="cert.pdf", url="https://example.com/cert")],
            ),
        )
        assert created.id == "new-id"

    asyncio.run(run())


def test_update_maps_order_to_position_and_normalizes_dates() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/rpc/api_workspace_update"):
            import json

            captured.update(json.loads(request.content))
            return httpx.Response(204)
        return httpx.Response(200, json=[ITEM_ROW])

    async def run() -> None:
        await repo(handler).update_item(
            "user-a", "i1", {"order": 1, "startDate": "2023-04", "title": "Renamed"}
        )

    asyncio.run(run())
    patch = captured["p_patch"]
    assert patch == {"position": 1, "start_date": "2023-04-01", "title": "Renamed"}  # type: ignore[index]


def test_postgrest_p0002_raises_item_not_found() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"code": "P0002", "message": "item not found"})

    async def run() -> None:
        with pytest.raises(ItemNotFoundError):
            await repo(handler).soft_delete_item("user-a", "missing")

    asyncio.run(run())


def test_list_changelog_maps_every_action_including_restore() -> None:
    actions = ["create", "update", "delete", "restore", "reorder"]
    rows = [
        {
            "seq": 5 - index,
            "workspace_version": 10 - index,
            "entity_id": "i1",
            "action": action,
            "created_at": f"t{index}",
            "label": "A",
        }
        for index, action in enumerate(actions)
    ]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=rows)

    async def run() -> None:
        entries = await repo(handler).list_changelog("user-a")
        # DB ``restore`` now surfaces as ``restore`` (ADR-019), not ``edit``.
        assert [entry.op for entry in entries] == [
            "add",
            "edit",
            "delete",
            "restore",
            "reorder",
        ]

    asyncio.run(run())


def test_update_on_a_soft_deleted_item_returns_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/rpc/api_workspace_update")
        # The SQL function filters ``deleted_at IS NULL`` and raises P0002, so a
        # PATCH on a soft-deleted item must not mutate anything.
        return httpx.Response(404, json={"code": "P0002", "message": "item not found"})

    async def run() -> None:
        with pytest.raises(ItemNotFoundError):
            await repo(handler).update_item("user-a", "gone", {"title": "Zombie"})

    asyncio.run(run())
