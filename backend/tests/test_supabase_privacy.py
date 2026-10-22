"""PostgREST contract tests for B6 privacy/resume deletion (no live project).

``httpx.MockTransport`` exercises the exact requests the repository sends, so a
missing user filter, a user id passed to a destructive RPC, or a wrong table
name fails here instead of in production.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable

import httpx
import pytest

from app.repositories.data_export import (
    EXPORT_TABLES,
    PROFILE_TABLE,
    SupabaseDataExportRepository,
)
from app.repositories.errors import (
    AccountDeletionUnavailableError,
    DataExportUnavailableError,
)
from app.repositories.resumes import SupabaseResumeRepository
from app.schemas.resume import Claim, ResumeEvidence, ResumeSection, ResumeVersionResponse

USER = "user-a"


def export_repo(
    handler: Callable[[httpx.Request], httpx.Response],
) -> SupabaseDataExportRepository:
    return SupabaseDataExportRepository(
        "https://project.supabase.co/rest/v1",
        "publishable-key",
        "user-jwt",
        transport=httpx.MockTransport(handler),
    )


def resume_repo(
    handler: Callable[[httpx.Request], httpx.Response],
) -> SupabaseResumeRepository:
    return SupabaseResumeRepository(
        "https://project.supabase.co/rest/v1",
        "publishable-key",
        "user-jwt",
        transport=httpx.MockTransport(handler),
    )


def test_export_reads_every_table_with_the_caller_filter() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith(f"/{PROFILE_TABLE}"):
            return httpx.Response(200, json=[{"user_id": USER, "headline": "A"}])
        return httpx.Response(200, json=[])

    async def run() -> None:
        snapshot = await export_repo(handler).export_user(USER)
        assert snapshot.profile == {"user_id": USER, "headline": "A"}
        assert set(snapshot.tables) == set(EXPORT_TABLES)

    asyncio.run(run())

    tables = {request.url.path.rsplit("/", 1)[-1] for request in seen}
    assert tables == {*EXPORT_TABLES.values(), PROFILE_TABLE}
    assert "auth.users" not in json.dumps([request.url.path for request in seen])
    for request in seen:
        assert request.method == "GET"
        assert request.url.params["user_id"] == f"eq.{USER}"
        assert request.url.params["select"] == "*"
        assert request.headers["authorization"] == "Bearer user-jwt"


def test_export_failure_raises_the_typed_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"message": "boom"})

    async def run() -> None:
        with pytest.raises(DataExportUnavailableError):
            await export_repo(handler).export_user(USER)

    asyncio.run(run())


def test_account_delete_rpc_takes_no_user_id() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["method"] = request.method
        captured["body"] = json.loads(request.content or b"{}")
        return httpx.Response(
            200,
            json={"workspace_items": 2, "resumes": 1, "not_a_count": "ignored"},
        )

    async def run() -> None:
        counts = await export_repo(handler).delete_user_data(USER)
        assert counts == {"workspace_items": 2, "resumes": 1}

    asyncio.run(run())

    assert str(captured["path"]).endswith("/rpc/api_account_delete_data")
    assert captured["method"] == "POST"
    # The RPC resolves auth.uid(); the caller id must never travel in the body.
    assert captured["body"] == {}
    assert "user" not in json.dumps(captured["body"])


def test_account_delete_failure_is_typed_and_safe() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "function not found"})

    async def run() -> None:
        with pytest.raises(AccountDeletionUnavailableError):
            await export_repo(handler).delete_user_data(USER)

    asyncio.run(run())


def test_resume_delete_and_version_delete_are_owner_scoped() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[{"id": "x"}])

    async def run() -> None:
        repo = resume_repo(handler)
        assert await repo.delete_resume(USER, "resume-1") is True
        assert await repo.delete_version(USER, "resume-1", "version-1") is True

    asyncio.run(run())

    assert all(request.method == "DELETE" for request in seen)
    assert all(request.url.params["user_id"] == f"eq.{USER}" for request in seen)
    assert seen[0].url.params["id"] == "eq.resume-1"
    assert seen[1].url.params["id"] == "eq.version-1"
    assert seen[1].url.params["resume_id"] == "eq.resume-1"


def test_version_purge_calls_the_narrow_rpc_without_a_user_id() -> None:
    captured: dict[str, object] = {}
    version = ResumeVersionResponse(
        id="version-1",
        resumeId="resume-1",
        workspaceVersion=3,
        createdAt="2026-10-17T12:00:00.000Z",
        reason="generated",
        title="Tailored",
        sections=[
            ResumeSection(
                key="experience",
                claims=[Claim(text="Kept", evidenceIds=["item-1"], confirmed=True)],
            )
        ],
    )
    evidence = [
        ResumeEvidence(
            itemId="item-1",
            section="experience",
            title="Engineer",
            evidence="attested",
            fingerprint="f1",
        )
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content)
        return httpx.Response(204)

    async def run() -> None:
        stored = await resume_repo(handler).purge_version(USER, "resume-1", version, evidence)
        assert stored.version.id == "version-1"
        assert stored.evidence[0].itemId == "item-1"

    asyncio.run(run())

    assert str(captured["path"]).endswith("/rpc/api_resume_version_purge")
    body = captured["body"]
    assert isinstance(body, dict)
    assert set(body) == {"p_resume_id", "p_version_id", "p_snapshot"}
    assert body["p_resume_id"] == "resume-1"
    assert body["p_version_id"] == "version-1"
    snapshot = body["p_snapshot"]
    assert isinstance(snapshot, dict)
    assert snapshot["reason"] == "generated"
    assert snapshot["resume"]["sections"][0]["claims"][0]["text"] == "Kept"
    assert "user_id" not in json.dumps(body)
