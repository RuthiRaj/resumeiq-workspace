"""B6 resume deletion and purge tests (in-memory repositories, no network).

The B5 rule is append-only history. B6 adds explicit user actions on top of it:
delete a tailored resume, delete one saved version, and purge claims that cite a
workspace item deleted after the snapshot. These tests assert the contract in
``docs/api/contract-proposals.md`` §6.5 plus the summary/version warnings added
in §6.2 and §6.5.
"""

from __future__ import annotations

import asyncio
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from app.ai.consent import InMemoryConsentStore
from app.api.deps import (
    get_resume_repository,
    get_target_repository,
    get_workspace_repository,
)
from app.core.config import Settings
from app.main import create_app
from app.repositories.memory import InMemoryWorkspaceRepository
from app.repositories.resume_memory import InMemoryResumeRepository
from app.repositories.target_memory import InMemoryTargetRepository
from tests.conftest import FIXED_CLOCK, TEST_SUBJECT
from tests.test_resumes_api import (
    BASE,
    generate,
    headers_for,
    prepare,
    seed_items,
    seed_workspace,
    workspace_item,
)

USER_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


@pytest.fixture()
def resume_repo() -> InMemoryResumeRepository:
    return InMemoryResumeRepository(clock=lambda: FIXED_CLOCK)


@pytest.fixture()
def target_repo() -> InMemoryTargetRepository:
    return InMemoryTargetRepository(clock=lambda: FIXED_CLOCK)


@pytest.fixture()
def client(
    settings: Settings,
    fake_repo: InMemoryWorkspaceRepository,
    target_repo: InMemoryTargetRepository,
    resume_repo: InMemoryResumeRepository,
) -> TestClient:
    app = create_app(settings)
    app.dependency_overrides[get_workspace_repository] = lambda: fake_repo
    app.dependency_overrides[get_target_repository] = lambda: target_repo
    app.dependency_overrides[get_resume_repository] = lambda: resume_repo
    app.state.ai_consent_store = InMemoryConsentStore(granted={TEST_SUBJECT, USER_B})
    app.state.analysis_enricher = None
    app.state.resume_reworder = None
    return TestClient(app)


def all_claims(resume: dict[str, Any]) -> list[dict[str, Any]]:
    return [claim for section in resume["sections"] for claim in section["claims"]]


def edit_experience(
    client: TestClient, headers: dict[str, str], resume_id: str, text: str, item_id: str
) -> dict[str, Any]:
    response = client.patch(
        f"{BASE}/resumes/{resume_id}/sections/experience",
        json={"claims": [{"text": text, "evidenceIds": [item_id]}]},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return cast(dict[str, Any], response.json())


def test_summary_and_versions_warn_about_removed_evidence(
    client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(client, headers)
    resume = generate(client, headers, target_id)
    experience = workspace_item(client, headers, "Senior Frontend Engineer")

    edit_experience(
        client,
        headers,
        resume["id"],
        "Built the design system and internal tooling.",
        experience["id"],
    )
    edit_experience(
        client,
        headers,
        resume["id"],
        "Mentored two engineers on accessibility.",
        experience["id"],
    )

    versions = client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers)
    assert versions.status_code == 200
    rows = versions.json()
    assert len(rows) == 3  # generated + two edits
    # Newest first: the first row is the latest edit.
    assert "Mentored two engineers on accessibility." in [
        claim["text"] for claim in all_claims(rows[0])
    ]

    asyncio.run(fake_repo.soft_delete_item(TEST_SUBJECT, experience["id"]))

    listed = client.get(f"{BASE}/resumes", headers=headers).json()
    tailored = next(row for row in listed if row["id"] == resume["id"])
    assert tailored["removedEvidenceIds"] == [experience["id"]]
    assert tailored["stale"] is True

    rows = client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers).json()
    assert [row["removedEvidenceIds"] for row in rows] == [[experience["id"]]] * 3
    assert all(row["stale"] is True for row in rows)
    assert any(claim["removed"] for claim in all_claims(rows[0]))


def test_delete_one_version_leaves_the_current_resume_untouched(
    client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(client, headers)
    resume = generate(client, headers, target_id)
    experience = workspace_item(client, headers, "Senior Frontend Engineer")
    edit_experience(
        client,
        headers,
        resume["id"],
        "Built the design system and internal tooling.",
        experience["id"],
    )
    current = edit_experience(
        client,
        headers,
        resume["id"],
        "Mentored two engineers on accessibility.",
        experience["id"],
    )

    rows = client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers).json()
    assert len(rows) == 3
    removed_id = rows[1]["id"]

    response = client.delete(
        f"{BASE}/resumes/{resume['id']}/versions/{removed_id}", headers=headers
    )
    assert response.status_code == 204, response.text
    assert response.content == b""

    remaining = client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers).json()
    assert [row["id"] for row in remaining] == [rows[0]["id"], rows[2]["id"]]
    fetched = client.get(f"{BASE}/resumes/{resume['id']}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json() == current

    # Deleting it again is a clean 404, not a silent success.
    again = client.delete(f"{BASE}/resumes/{resume['id']}/versions/{removed_id}", headers=headers)
    assert again.status_code == 404
    assert again.json()["detail"]["code"] == "resume_version_not_found"


def test_delete_resume_removes_history_and_is_user_scoped(
    client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(client, headers)
    resume = generate(client, headers, target_id)
    experience = workspace_item(client, headers, "Senior Frontend Engineer")
    edit_experience(
        client,
        headers,
        resume["id"],
        "Built the design system and internal tooling.",
        experience["id"],
    )

    # Another user cannot delete it and gets the same 404 as a missing resume.
    other = headers_for(USER_B)
    assert client.delete(f"{BASE}/resumes/{resume['id']}", headers=other).status_code == 404
    assert client.get(f"{BASE}/resumes/{resume['id']}", headers=headers).status_code == 200

    response = client.delete(f"{BASE}/resumes/{resume['id']}", headers=headers)
    assert response.status_code == 204, response.text
    assert client.get(f"{BASE}/resumes/{resume['id']}", headers=headers).status_code == 404
    assert client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers).status_code == 404
    listed = client.get(f"{BASE}/resumes", headers=headers).json()
    assert [row["id"] for row in listed] == ["resume-standard"]

    # The derived standard resume can never be deleted.
    standard = client.delete(f"{BASE}/resumes/resume-standard", headers=headers)
    assert standard.status_code == 409
    assert standard.json()["detail"]["code"] == "resume_not_tailored"


def test_purge_rewrites_current_and_saved_versions_and_is_idempotent(
    client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(client, headers)
    resume = generate(client, headers, target_id)
    experience = workspace_item(client, headers, "Senior Frontend Engineer")

    before = client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers).json()
    assert len(before) == 1

    asyncio.run(fake_repo.soft_delete_item(TEST_SUBJECT, experience["id"]))

    response = client.post(f"{BASE}/resumes/{resume['id']}/purge", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["removedClaims"] >= 2  # the role header and at least one bullet
    assert body["purgedVersions"] == 1
    assert body["removedEvidenceIds"] == [experience["id"]]
    assert not any(experience["id"] in claim["evidenceIds"] for claim in all_claims(body["resume"]))
    assert body["resume"]["removedEvidenceIds"] == []

    after = client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers).json()
    assert len(after) == 2  # generated (rewritten) + purged
    assert after[0]["reason"] == "purged"
    assert after[1]["reason"] == "generated"
    assert all(row["removedEvidenceIds"] == [] for row in after)
    assert not any(
        experience["id"] in claim["evidenceIds"] for row in after for claim in all_claims(row)
    )

    second = client.post(f"{BASE}/resumes/{resume['id']}/purge", headers=headers)
    assert second.status_code == 200
    assert second.json()["removedClaims"] == 0
    assert second.json()["purgedVersions"] == 0
    assert len(client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers).json()) == 2


def test_purge_one_version_does_not_touch_the_others_or_the_current_resume(
    client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(client, headers)
    resume = generate(client, headers, target_id)
    experience = workspace_item(client, headers, "Senior Frontend Engineer")
    edit_experience(
        client,
        headers,
        resume["id"],
        "Built the design system and internal tooling.",
        experience["id"],
    )
    edit_experience(
        client,
        headers,
        resume["id"],
        "Mentored two engineers on accessibility.",
        experience["id"],
    )
    rows = client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers).json()
    assert len(rows) == 3
    chosen = rows[1]["id"]

    asyncio.run(fake_repo.soft_delete_item(TEST_SUBJECT, experience["id"]))

    response = client.post(
        f"{BASE}/resumes/{resume['id']}/versions/{chosen}/purge", headers=headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version"]["id"] == chosen
    assert body["removedClaims"] >= 1
    assert body["version"]["removedEvidenceIds"] == []
    assert not any(
        experience["id"] in claim["evidenceIds"] for claim in all_claims(body["version"])
    )

    # Only that snapshot changed.
    updated = client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers).json()
    by_id = {row["id"]: row for row in updated}
    assert by_id[chosen]["removedEvidenceIds"] == []
    assert by_id[rows[0]["id"]]["removedEvidenceIds"] == [experience["id"]]
    assert by_id[rows[2]["id"]]["removedEvidenceIds"] == [experience["id"]]
    current = client.get(f"{BASE}/resumes/{resume['id']}", headers=headers).json()
    assert current["removedEvidenceIds"] == [experience["id"]]

    # The standard resume has no versions to purge.
    standard = client.post(
        f"{BASE}/resumes/resume-standard/versions/{chosen}/purge", headers=headers
    )
    assert standard.status_code == 409
    assert standard.json()["detail"]["code"] == "resume_not_tailored"


def test_other_user_cannot_delete_or_purge_a_resume_or_version(
    client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(client, headers)
    resume = generate(client, headers, target_id)
    version_id = client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers).json()[0][
        "id"
    ]
    experience = workspace_item(client, headers, "Senior Frontend Engineer")
    asyncio.run(fake_repo.soft_delete_item(TEST_SUBJECT, experience["id"]))

    other = headers_for(USER_B)
    purge = client.post(f"{BASE}/resumes/{resume['id']}/purge", headers=other)
    assert purge.status_code == 404
    assert purge.json()["detail"]["code"] == "resume_not_found"
    purge_version = client.post(
        f"{BASE}/resumes/{resume['id']}/versions/{version_id}/purge", headers=other
    )
    assert purge_version.status_code == 404
    assert purge_version.json()["detail"]["code"] == "resume_not_found"
    delete_version = client.delete(
        f"{BASE}/resumes/{resume['id']}/versions/{version_id}", headers=other
    )
    assert delete_version.status_code == 404

    # A's data is untouched and still warns about the deleted item.
    owned = client.get(f"{BASE}/resumes/{resume['id']}", headers=headers)
    assert owned.status_code == 200
    assert owned.json()["removedEvidenceIds"] == [experience["id"]]
    versions = client.get(f"{BASE}/resumes/{resume['id']}/versions", headers=headers).json()
    assert [row["id"] for row in versions] == [version_id]
    assert versions[0]["removedEvidenceIds"] == [experience["id"]]
