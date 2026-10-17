"""Opt-in integration tests against a real Supabase dev project.

Skipped by default. To run them, export (never commit) — all values are read
from the environment and never printed:

    RUN_SUPABASE_INTEGRATION=1
    SUPABASE_URL=https://<project>.supabase.co
    SUPABASE_PUBLISHABLE_KEY=<publishable/anon key>
    SUPABASE_TEST_TOKEN_A=<access token of a real signed-up user>
    SUPABASE_TEST_TOKEN_B=<access token of a second user>   # optional: isolation test

These exercise the Data API + the ``api_workspace_*`` functions with a real JWT,
so they also prove RLS and the transactional versioning end to end.
"""

import asyncio
import os
from datetime import UTC, datetime

import pytest

from app.repositories.errors import ItemNotFoundError
from app.repositories.workspace import SupabaseWorkspaceRepository
from app.schemas.workspace import WorkspaceItemCreate

RUN = os.environ.get("RUN_SUPABASE_INTEGRATION", "").lower() not in ("", "0", "false", "no")
URL = os.environ.get("SUPABASE_URL", "")
KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
TOKEN_A = os.environ.get("SUPABASE_TEST_TOKEN_A", "")
TOKEN_B = os.environ.get("SUPABASE_TEST_TOKEN_B", "")

pytestmark = pytest.mark.skipif(
    not (RUN and URL and KEY and TOKEN_A),
    reason="integration disabled: set RUN_SUPABASE_INTEGRATION=1 and Supabase credentials",
)


def repo_for(token: str) -> SupabaseWorkspaceRepository:
    return SupabaseWorkspaceRepository(f"{URL.rstrip('/')}/rest/v1", KEY, token)


def unique_title() -> str:
    return f"integration-{datetime.now(UTC).isoformat()}"


def test_full_mutation_lifecycle() -> None:
    async def run() -> None:
        repository = repo_for(TOKEN_A)
        before = (await repository.get_workspace("")).version

        created = await repository.create_item(
            "", WorkspaceItemCreate(section="skill", title=unique_title())
        )
        assert created.id

        fetched = await repository.get_item("", created.id)
        assert fetched is not None and fetched.id == created.id

        updated = await repository.update_item("", created.id, {"title": "renamed"})
        assert updated.title == "renamed"

        await repository.soft_delete_item("", created.id)
        assert await repository.get_item("", created.id) is not None  # still readable by id
        listing = await repository.get_workspace("")
        assert all(i.id != created.id for i in listing.items)

        await repository.restore_item("", created.id)
        after = await repository.get_workspace("")
        assert after.version > before
        assert any(i.id == created.id for i in after.items)

        await repository.soft_delete_item("", created.id)  # tidy up

    asyncio.run(run())


@pytest.mark.skipif(not TOKEN_B, reason="set SUPABASE_TEST_TOKEN_B for the isolation test")
def test_user_b_cannot_read_or_modify_user_a_rows() -> None:
    async def run() -> None:
        a = repo_for(TOKEN_A)
        b = repo_for(TOKEN_B)
        created = await a.create_item(
            "", WorkspaceItemCreate(section="skill", title=unique_title())
        )
        try:
            assert await b.get_item("", created.id) is None  # RLS hides it
            with pytest.raises(ItemNotFoundError):
                await b.update_item("", created.id, {"title": "hijacked"})
        finally:
            await a.soft_delete_item("", created.id)

    asyncio.run(run())
