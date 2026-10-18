"""Supabase import-repository tests.

``httpx.MockTransport`` exercises the PostgREST request/response mapping without
a live project or credentials: which RPC is called, what the row shapes map to,
and how not-found errors surface.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable

import httpx
import pytest

from app.extraction.engine import ParsedDocument
from app.repositories.errors import (
    ImportReviewItemNotFoundError,
    ImportSessionNotFoundError,
    RepositoryError,
)
from app.repositories.imports import (
    SupabaseImportRepository,
    initial_values,
    review_item_from_row,
    session_from_row,
    values_to_workspace_create,
)
from app.schemas.imports import (
    ExtractedField,
    ExtractionItem,
    ImportItemValues,
    ImportSupportFile,
    ImportSupportLink,
)

ITEM_ROW = {
    "wire_id": "ext-experience-1",
    "section": "experience",
    "extraction": {
        "id": "ext-experience-1",
        "section": "experience",
        "fields": [
            {
                "key": "title",
                "label": "Role",
                "value": "Backend Intern",
                "confidence": 0.9,
                "sourceLine": 6,
            }
        ],
        "bullets": [],
        "tags": [],
        "confidence": 0.9,
    },
    "values": {"title": "Backend Intern", "organization": "Example Payments Ltd"},
    "status": "pending",
    "support": None,
    "decided_at": None,
    "position": 1,
}

SESSION_ROW = {
    "id": "11111111-1111-1111-1111-111111111111",
    "file_name": "resume.pdf",
    "file_type": "pdf",
    "file_size": 2048,
    "page_count": 1,
    "source_text": "EXAMPLE CANDIDATE",
    "preview_available": True,
    "created_at": "2026-10-18T09:00:00Z",
    "updated_at": "2026-10-18T09:00:00Z",
    "import_review_items": [ITEM_ROW],
}

WORKSPACE_ROW = {
    "id": "ws-1",
    "section": "experience",
    "title": "Backend Intern",
    "organization": "Example Payments Ltd",
    "start_date": "2024-01-01",
    "end_date": "2024-09-01",
    "location": None,
    "bullets": [],
    "tags": [],
    "links": [],
    "evidence": "verified",
    "position": 0,
    "updated_at": "2026-10-18T09:00:00Z",
    "deleted_at": None,
    "evidence_links": [],
}

Handler = Callable[[httpx.Request], httpx.Response]


def repo(handler: Handler) -> SupabaseImportRepository:
    return SupabaseImportRepository(
        "https://project.supabase.co/rest/v1",
        "publishable-key",
        "user-jwt",
        transport=httpx.MockTransport(handler),
    )


def item(section: str = "experience") -> ExtractionItem:
    return ExtractionItem(
        id=f"ext-{section}-1",
        section=section,  # type: ignore[arg-type]
        fields=[
            ExtractedField(
                key="title", label="Role", value="Backend Intern", confidence=0.9, sourceLine=6
            )
        ],
        confidence=0.9,
    )


def parsed() -> ParsedDocument:
    return ParsedDocument(
        file_type="pdf",
        source_text="EXAMPLE CANDIDATE",
        page_count=1,
        preview_available=True,
        items=[item()],
    )


def test_initial_values_never_invents_a_month() -> None:
    bare_year = ExtractionItem(
        id="ext-experience-1",
        section="experience",
        fields=[
            ExtractedField(key="title", label="Role", value="Intern", confidence=0.9, sourceLine=2),
            ExtractedField(
                key="startDate", label="Start", value="2021", confidence=0.5, sourceLine=4
            ),
        ],
        confidence=0.5,
    )
    values = initial_values(bare_year)
    assert values.startDate == ""  # the year is shown in `extraction` only
    assert values.title == "Intern"


def test_values_to_workspace_create_marks_evidence() -> None:
    values = ImportItemValues(title="Backend Intern", organization="Example Payments Ltd")

    attested = values_to_workspace_create(
        section="experience", import_id="imp-1", item_id="ext-1", values=values, support=None
    )
    assert attested.evidence == "attested"
    assert attested.attachments == []
    assert attested.links == []

    linked = values_to_workspace_create(
        section="experience",
        import_id="imp-1",
        item_id="ext-1",
        values=values,
        support=ImportSupportLink(kind="link", url="https://example.com/cert"),
    )
    assert linked.evidence == "verified"
    assert linked.links == ["https://example.com/cert"]

    filed = values_to_workspace_create(
        section="experience",
        import_id="imp-1",
        item_id="ext-1",
        values=values,
        support=ImportSupportFile(kind="file", name="cert.pdf"),
    )
    assert filed.evidence == "verified"
    assert filed.attachments[0].name == "cert.pdf"
    assert filed.attachments[0].url == "import://imp-1/ext-1"


def test_values_to_workspace_create_rejects_a_missing_title() -> None:
    with pytest.raises(ValueError):
        values_to_workspace_create(
            section="experience",
            import_id="imp-1",
            item_id="ext-1",
            values=ImportItemValues(title="   "),
            support=None,
        )


def test_row_mappers_are_forgiving() -> None:
    review = review_item_from_row(ITEM_ROW)
    assert review.id == "ext-experience-1"
    assert review.status == "pending"
    assert review.support is None
    # A bare row still produces a valid session.
    session = session_from_row({"file_type": "docx"})
    assert session.fileType == "docx"
    assert session.pageCount == 1
    assert session.items == []


def test_create_session_calls_the_rpc_with_every_item() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/rpc/api_import_create_session"):
            return httpx.Response(200, json="imp-1")
        return httpx.Response(200, json=[SESSION_ROW])

    async def run() -> None:
        session = await repo(handler).create_session(
            "user-a",
            file_name="resume.pdf",
            file_type="pdf",
            file_size=2048,
            parsed=parsed(),
        )
        assert session.id == "11111111-1111-1111-1111-111111111111"
        assert session.items[0].extraction.section == "experience"
        assert session.items[0].values.title == "Backend Intern"

    asyncio.run(run())

    rpc = next(r for r in seen if r.url.path.endswith("/rpc/api_import_create_session"))
    payload = rpc.content.decode()
    assert "p_items" in payload and "wire_id" in payload
    # The caller's JWT is forwarded so Postgres enforces RLS as auth.uid().
    assert all(r.headers["authorization"] == "Bearer user-jwt" for r in seen)
    assert all(r.headers["apikey"] == "publishable-key" for r in seen)


def test_list_sessions_counts_statuses() -> None:
    rows = [
        {
            "id": "imp-1",
            "file_name": "resume.pdf",
            "file_type": "pdf",
            "created_at": "2026-10-18T09:00:00Z",
            "import_review_items": [{"status": "pending"}, {"status": "confirmed"}],
        },
        {
            "id": "imp-2",
            "file_name": "resume.docx",
            "file_type": "docx",
            "created_at": "2026-10-18T08:00:00Z",
            "import_review_items": [],
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["user_id"] == "eq.user-a"
        return httpx.Response(200, json=rows)

    async def run() -> None:
        summaries = await repo(handler).list_sessions("user-a")
        assert [s.id for s in summaries] == ["imp-1", "imp-2"]
        assert summaries[0].itemCount == 2
        assert summaries[0].pendingCount == 1
        assert summaries[0].confirmedCount == 1
        assert summaries[1].fileType == "docx"

    asyncio.run(run())


def test_get_session_scopes_the_query_to_the_caller() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[SESSION_ROW])

    async def run() -> None:
        session = await repo(handler).get_session("user-a", "imp-1")
        assert session is not None
        assert session.previewAvailable is True
        assert session.sourceText == "EXAMPLE CANDIDATE"
        assert (
            await repo(lambda _request: httpx.Response(200, json=[])).get_session("user-a", "imp-1")
            is None
        )

    asyncio.run(run())
    # RLS is only effective if the query is explicitly scoped by user_id.
    assert seen[0].url.params["user_id"] == "eq.user-a"
    assert seen[0].url.params["id"] == "eq.imp-1"


def test_update_item_patches_and_maps_the_row() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[{**ITEM_ROW, "status": "rejected"}])

    async def run() -> None:
        updated = await repo(handler).update_item(
            "user-a", "imp-1", "ext-experience-1", {"status": "rejected"}
        )
        assert updated.status == "rejected"

    asyncio.run(run())
    assert seen[0].method == "PATCH"
    assert seen[0].url.params["user_id"] == "eq.user-a"
    assert seen[0].headers["prefer"] == "return=representation"


def test_update_item_missing_row_is_item_not_found() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    async def run() -> None:
        with pytest.raises(ImportReviewItemNotFoundError):
            await repo(handler).update_item("user-a", "imp-1", "ext-nope-1", {"status": "rejected"})

    asyncio.run(run())


def test_confirm_calls_the_rpc_then_reads_the_created_item() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/rpc/api_import_confirm"):
            return httpx.Response(200, json="ws-1")
        if request.url.path.endswith("/import_review_items"):
            return httpx.Response(200, json=[{**ITEM_ROW, "status": "confirmed"}])
        return httpx.Response(200, json=[WORKSPACE_ROW])

    async def run() -> None:
        workspace_item, review = await repo(handler).confirm_item(
            "user-a", "imp-1", "ext-experience-1"
        )
        assert workspace_item.id == "ws-1"
        assert workspace_item.title == "Backend Intern"
        assert review.status == "confirmed"

    asyncio.run(run())

    rpc = next(r for r in seen if r.url.path.endswith("/rpc/api_import_confirm"))
    assert b"p_import_id" in rpc.content and b"p_item_id" in rpc.content


def test_confirm_reports_a_missing_item() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"code": "P0003", "message": "review item not found"})

    async def run() -> None:
        with pytest.raises(ImportReviewItemNotFoundError):
            await repo(handler).confirm_item("user-a", "imp-1", "ext-nope-1")

    asyncio.run(run())


def test_missing_session_surfaces_as_import_not_found() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"code": "P0002", "message": "session not found"})

    async def run() -> None:
        with pytest.raises(ImportSessionNotFoundError):
            await repo(handler).get_session("user-a", "imp-404")

    asyncio.run(run())


def test_other_data_api_errors_are_repository_errors() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"message": "boom"})

    async def run() -> None:
        with pytest.raises(RepositoryError):
            await repo(handler).list_sessions("user-a")

    asyncio.run(run())


def test_repository_refuses_to_build_without_data_api_config() -> None:
    with pytest.raises(RepositoryError):
        SupabaseImportRepository("", "publishable-key", "user-jwt")
