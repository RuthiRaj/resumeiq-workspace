"""Workspace service unit tests (fake repository, no network, no DB)."""

import asyncio

import pytest
from pydantic import ValidationError

from app.repositories.errors import InvalidReorderError, ItemNotFoundError
from app.repositories.memory import InMemoryWorkspaceRepository
from app.schemas.workspace import Attachment, WorkspaceItemCreate, WorkspaceItemUpdate
from app.services.workspace_service import WorkspaceService

USER = "user-a"
OTHER = "user-b"


def service() -> WorkspaceService:
    return WorkspaceService(InMemoryWorkspaceRepository(clock=lambda: "2026-10-17T12:00:00.000Z"))


def create_item(**kw: object) -> WorkspaceItemCreate:
    payload: dict[str, object] = {"section": "skill", "title": "TypeScript"}
    payload.update(kw)
    return WorkspaceItemCreate(**payload)  # type: ignore[arg-type]


def test_create_bumps_version_once_and_logs_label() -> None:
    async def run() -> None:
        svc = service()
        initial = await svc.get_workspace(USER)
        assert initial.version == 1

        created = await svc.create_item(USER, create_item())
        assert created.order == 0

        workspace = await svc.get_workspace(USER)
        assert workspace.version == 2
        assert [item.id for item in workspace.items] == [created.id]

        log = await svc.list_changelog(USER)
        assert len(log) == 1
        assert log[0].op == "add"
        assert log[0].label == "TypeScript"
        assert log[0].workspaceVersion == 2

    asyncio.run(run())


def test_reorder_bumps_version_once_and_logs_each_id() -> None:
    async def run() -> None:
        svc = service()
        a = await svc.create_item(USER, create_item(title="A"))
        b = await svc.create_item(USER, create_item(title="B"))
        before = (await svc.get_workspace(USER)).version

        workspace = await svc.reorder(USER, "skill", [b.id, a.id])
        assert workspace.version == before + 1
        order = {item.id: item.order for item in workspace.items}
        assert order[b.id] == 0 and order[a.id] == 1

        reorder_rows = [e for e in await svc.list_changelog(USER) if e.op == "reorder"]
        assert {e.itemId for e in reorder_rows} == {a.id, b.id}
        assert all(e.workspaceVersion == workspace.version for e in reorder_rows)

    asyncio.run(run())


def test_delete_is_soft_and_restore_is_logged_as_restore() -> None:
    async def run() -> None:
        svc = service()
        created = await svc.create_item(USER, create_item())
        await svc.soft_delete_item(USER, created.id)

        assert (await svc.get_workspace(USER)).items == []
        log = await svc.list_changelog(USER)
        assert log[0].op == "delete"
        assert log[0].label == "TypeScript"  # readable after the soft delete

        restored = await svc.restore_item(USER, created.id)
        assert restored.deletedAt is None
        assert [i.id for i in (await svc.get_workspace(USER)).items] == [created.id]
        # An undo is its own op, not an edit (ADR-019).
        assert (await svc.list_changelog(USER))[0].op == "restore"

    asyncio.run(run())


def test_update_on_a_soft_deleted_item_is_not_found() -> None:
    async def run() -> None:
        svc = service()
        created = await svc.create_item(USER, create_item())
        await svc.soft_delete_item(USER, created.id)

        # PATCH on a soft-deleted item must behave like an unknown item: 404,
        # and it must not resurrect or edit it.
        with pytest.raises(ItemNotFoundError):
            await svc.update_item(USER, created.id, WorkspaceItemUpdate(title="Zombie"))
        with pytest.raises(ItemNotFoundError):
            await svc.get_item(USER, created.id)
        assert (await svc.get_workspace(USER)).items == []

    asyncio.run(run())


def test_update_may_not_leave_verified_without_support() -> None:
    async def run() -> None:
        svc = service()
        created = await svc.create_item(USER, create_item())
        with pytest.raises(ValueError, match="Verified needs a supporting"):
            await svc.update_item(USER, created.id, WorkspaceItemUpdate(evidence="verified"))

    asyncio.run(run())


def test_update_accepts_verified_with_an_attachment() -> None:
    async def run() -> None:
        svc = service()
        created = await svc.create_item(USER, create_item())
        updated = await svc.update_item(
            USER,
            created.id,
            WorkspaceItemUpdate(
                evidence="verified",
                attachments=[Attachment(id="att-1", name="cert.pdf", url="https://ex.com/c")],
            ),
        )
        assert updated.evidence == "verified"
        assert updated.attachments[0].name == "cert.pdf"

    asyncio.run(run())


def test_create_verified_without_support_is_rejected_by_schema() -> None:
    with pytest.raises(ValidationError):
        create_item(evidence="verified")


def test_update_unknown_item_raises_not_found() -> None:
    async def run() -> None:
        svc = service()
        with pytest.raises(ItemNotFoundError):
            await svc.update_item(USER, "missing", WorkspaceItemUpdate(title="x"))

    asyncio.run(run())


def test_reorder_outside_section_is_rejected() -> None:
    async def run() -> None:
        svc = service()
        a = await svc.create_item(USER, create_item(section="skill", title="A"))
        with pytest.raises(InvalidReorderError):
            await svc.reorder(USER, "project", [a.id])

    asyncio.run(run())


def test_workspaces_are_isolated_per_user() -> None:
    async def run() -> None:
        svc = service()
        created = await svc.create_item(USER, create_item())
        assert (await svc.get_workspace(OTHER)).items == []
        with pytest.raises(ItemNotFoundError):
            await svc.get_item(OTHER, created.id)

    asyncio.run(run())
