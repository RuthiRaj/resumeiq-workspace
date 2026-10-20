"""Analysis API contract tests (in-memory repositories, no network).

These assert the wire contract in ``docs/api/contract-proposals.md`` §3-§5:
status codes, error ``code``s, the six-stage run shape, and the two privacy
rules the brief calls out:

* the analysis only reads the *caller's* workspace, and
* a caller can never see another user's target, run or report.

Everything here uses the deterministic engine; no AI provider is configured, so
the full report must still be produced (PRD §6.9).
"""

from __future__ import annotations

import asyncio
from typing import cast

import pytest
from fastapi.testclient import TestClient

from app.ai.consent import InMemoryConsentStore
from app.api.deps import get_target_repository, get_workspace_repository
from app.core.config import Settings
from app.main import create_app
from app.repositories.memory import InMemoryWorkspaceRepository
from app.repositories.target_memory import InMemoryTargetRepository
from app.schemas.analysis import AnalysisRun
from app.schemas.workspace import WorkspaceItemCreate
from tests.conftest import (
    FIXED_CLOCK,
    TEST_SUBJECT,
    make_token,
)

BASE = "/api/v1"

JD = (
    "Senior Frontend Engineer — Halcyon Systems\n\n"
    "Requirements\n"
    "- Strong TypeScript and React skills\n"
    "- 3+ years of experience building web applications\n"
    "- Bachelor's degree in Computer Science\n"
)

USER_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def headers_for(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub=user_id)}"}


def seed_workspace(repo: InMemoryWorkspaceRepository, user_id: str, items: list) -> None:
    async def run() -> None:
        for item in items:
            await repo.create_item(user_id, item)

    asyncio.run(run())


def seed_items() -> list[WorkspaceItemCreate]:
    return [
        WorkspaceItemCreate(
            section="skill",
            title="TypeScript",
            tags=["TypeScript"],
            evidence="verified",
            links=["https://example.com/ts"],
        ),
        WorkspaceItemCreate(
            section="experience",
            title="Senior Frontend Engineer",
            organization="Acme",
            startDate="2021-01",
            endDate="2024-01",
            tags=["TypeScript", "React"],
            bullets=["Built the design system and internal tooling."],
            evidence="attested",
        ),
        WorkspaceItemCreate(
            section="education",
            title="BSc Computer Science",
            organization="Example University",
            evidence="verified",
            links=["https://example.com/degree"],
        ),
    ]


@pytest.fixture()
def target_repo() -> InMemoryTargetRepository:
    return InMemoryTargetRepository(clock=lambda: FIXED_CLOCK)


@pytest.fixture()
def consent_store() -> InMemoryConsentStore:
    return InMemoryConsentStore(granted={TEST_SUBJECT, USER_B})


@pytest.fixture()
def analysis_client(
    settings: Settings,
    fake_repo: InMemoryWorkspaceRepository,
    target_repo: InMemoryTargetRepository,
    consent_store: InMemoryConsentStore,
) -> TestClient:
    app = create_app(settings)
    app.dependency_overrides[get_workspace_repository] = lambda: fake_repo
    app.dependency_overrides[get_target_repository] = lambda: target_repo
    app.state.ai_consent_store = consent_store
    return TestClient(app)


def create_target(client: TestClient, headers: dict[str, str]) -> dict[str, object]:
    response = client.post(
        f"{BASE}/targets",
        json={
            "role": "Senior Frontend Engineer",
            "company": "Halcyon Systems",
            "jobDescription": JD,
            "requiredSkills": ["TypeScript", "React"],
            "template": "precision",
            "length": "one_page",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return cast(dict[str, object], response.json())


# --- auth & targets ---------------------------------------------------------


def test_targets_require_authentication(analysis_client: TestClient) -> None:
    assert analysis_client.get(f"{BASE}/targets").status_code == 401


def test_create_list_and_get_round_trip(analysis_client: TestClient) -> None:
    headers = headers_for(TEST_SUBJECT)
    created = create_target(analysis_client, headers)

    assert created["id"]
    assert created["status"] == "draft"
    assert created["analysis"] is None  # never a placeholder score
    assert created["template"] == "precision"
    assert created["length"] == "one_page"
    assert created["sample"] is False

    listed = analysis_client.get(f"{BASE}/targets", headers=headers)
    assert listed.status_code == 200
    assert [target["id"] for target in listed.json()] == [created["id"]]

    fetched = analysis_client.get(f"{BASE}/targets/{created['id']}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["role"] == "Senior Frontend Engineer"


def test_create_with_bad_body_returns_target_invalid(analysis_client: TestClient) -> None:
    response = analysis_client.post(
        f"{BASE}/targets",
        json={"role": "", "jobDescription": "too short"},
        headers=headers_for(TEST_SUBJECT),
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "target_invalid"


def test_unknown_target_returns_target_not_found(analysis_client: TestClient) -> None:
    response = analysis_client.get(
        f"{BASE}/targets/00000000-0000-0000-0000-000000000000",
        headers=headers_for(TEST_SUBJECT),
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "target_not_found"


# --- consent ----------------------------------------------------------------


def test_analysis_without_consent_is_forbidden(
    analysis_client: TestClient, consent_store: InMemoryConsentStore
) -> None:
    headers = headers_for(TEST_SUBJECT)
    target = create_target(analysis_client, headers)
    consent_store.revoke(TEST_SUBJECT)

    response = analysis_client.post(f"{BASE}/targets/{target['id']}/analysis", headers=headers)
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "consent_required"


# --- run lifecycle ----------------------------------------------------------


def test_run_lifecycle_produces_a_full_deterministic_report(
    analysis_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
    target_repo: InMemoryTargetRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target = create_target(analysis_client, headers)

    started = analysis_client.post(f"{BASE}/targets/{target['id']}/analysis", headers=headers)
    assert started.status_code == 202, started.text
    body = started.json()
    # The response reflects the run as it was started, before the background work.
    assert body["run"]["status"] == "running"
    assert body["run"]["stageCount"] == 6
    assert body["run"]["stage"] == "reading"
    assert body["report"] is None

    polled = analysis_client.get(f"{BASE}/targets/{target['id']}/analysis/run", headers=headers)
    assert polled.status_code == 200
    run = polled.json()["run"]
    assert run["status"] == "succeeded"
    assert run["progress"] == 100
    assert run["stage"] == "writing"
    assert run["failure"] is None

    report = polled.json()["report"]
    assert report is not None
    assert report["targetId"] == target["id"]
    assert report["aiUsed"] is False
    assert 0 <= report["score"] <= 100
    assert report["methodology"]["scoreDisclaimer"]
    assert report["requirements"]

    fetched_report = analysis_client.get(f"{BASE}/targets/{target['id']}/analysis", headers=headers)
    assert fetched_report.status_code == 200
    assert fetched_report.json()["score"] == report["score"]

    refreshed = analysis_client.get(f"{BASE}/targets/{target['id']}", headers=headers).json()
    assert refreshed["status"] == "ready"
    assert refreshed["analysis"]["score"] == report["score"]
    assert refreshed["analysis"]["stale"] is False

    # The requirements snapshot is mirrored into jd_requirements.
    stored = target_repo.stored_requirements(TEST_SUBJECT, cast(str, target["id"]))
    assert [requirement.id for requirement in stored] == [
        requirement["id"] for requirement in report["requirements"]
    ]


def test_report_not_ready_before_any_run(analysis_client: TestClient) -> None:
    headers = headers_for(TEST_SUBJECT)
    target = create_target(analysis_client, headers)
    response = analysis_client.get(f"{BASE}/targets/{target['id']}/analysis", headers=headers)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "report_not_ready"


def test_run_not_found_before_any_start(analysis_client: TestClient) -> None:
    headers = headers_for(TEST_SUBJECT)
    target = create_target(analysis_client, headers)
    response = analysis_client.get(f"{BASE}/targets/{target['id']}/analysis/run", headers=headers)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "analysis_run_not_found"


def test_starting_twice_returns_conflict(
    analysis_client: TestClient, target_repo: InMemoryTargetRepository
) -> None:
    headers = headers_for(TEST_SUBJECT)
    target = create_target(analysis_client, headers)

    async def seed_running() -> None:
        await target_repo.create_run(
            TEST_SUBJECT,
            AnalysisRun(
                id="run-in-flight",
                targetId=target["id"],
                status="running",
                stage="reading",
                stageIndex=0,
                stageCount=6,
                progress=0,
                workspaceVersion=1,
                startedAt=FIXED_CLOCK,
                updatedAt=FIXED_CLOCK,
            ),
        )

    asyncio.run(seed_running())
    response = analysis_client.post(f"{BASE}/targets/{target['id']}/analysis", headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "analysis_already_running"


def test_stale_flag_tracks_the_workspace_version(
    analysis_client: TestClient, fake_repo: InMemoryWorkspaceRepository
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target = create_target(analysis_client, headers)
    analysis_client.post(f"{BASE}/targets/{target['id']}/analysis", headers=headers)

    fresh = analysis_client.get(f"{BASE}/targets/{target['id']}", headers=headers).json()
    assert fresh["analysis"]["stale"] is False

    # A new workspace item bumps the version, so the report is now stale.
    seed_workspace(
        fake_repo,
        TEST_SUBJECT,
        [WorkspaceItemCreate(section="project", title="New project", evidence="attested")],
    )
    stale = analysis_client.get(f"{BASE}/targets/{target['id']}", headers=headers).json()
    assert stale["analysis"]["stale"] is True


# --- isolation --------------------------------------------------------------


def test_another_user_cannot_see_targets_runs_or_reports(
    analysis_client: TestClient, fake_repo: InMemoryWorkspaceRepository
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    owner = headers_for(TEST_SUBJECT)
    intruder = headers_for(USER_B)

    target = create_target(analysis_client, owner)
    analysis_client.post(f"{BASE}/targets/{target['id']}/analysis", headers=owner)

    # The intruder's list is empty and every direct read is a 404, not a leak.
    assert analysis_client.get(f"{BASE}/targets", headers=intruder).json() == []
    for path in (
        f"{BASE}/targets/{target['id']}",
        f"{BASE}/targets/{target['id']}/analysis",
        f"{BASE}/targets/{target['id']}/analysis/run",
    ):
        response = analysis_client.get(path, headers=intruder)
        assert response.status_code == 404, path

    # The intruder cannot run an analysis against the owner's target either.
    blocked = analysis_client.post(f"{BASE}/targets/{target['id']}/analysis", headers=intruder)
    assert blocked.status_code == 404
    assert blocked.json()["detail"]["code"] == "target_not_found"


def test_analysis_uses_only_the_callers_workspace(
    analysis_client: TestClient, fake_repo: InMemoryWorkspaceRepository
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    owner = headers_for(TEST_SUBJECT)
    user_b = headers_for(USER_B)

    owner_target = create_target(analysis_client, owner)
    analysis_client.post(f"{BASE}/targets/{owner_target['id']}/analysis", headers=owner)

    # User B creates the same target but has an empty workspace.
    b_target = create_target(analysis_client, user_b)
    analysis_client.post(f"{BASE}/targets/{b_target['id']}/analysis", headers=user_b)
    b_report = analysis_client.get(f"{BASE}/targets/{b_target['id']}/analysis", headers=user_b)
    b_report.raise_for_status()
    payload = b_report.json()

    # B's report may only cite B's workspace: no item ids from A, and no matches.
    assert payload["included"] == []
    assert all(not requirement["evidenceIds"] for requirement in payload["requirements"])
    assert {requirement["status"] for requirement in payload["requirements"]} == {"unsupported"}
