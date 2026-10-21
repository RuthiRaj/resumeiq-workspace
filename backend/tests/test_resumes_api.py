"""Resume API contract tests (B5, in-memory repositories, no network).

These assert the wire contract in ``docs/api/contract-proposals.md`` §6 and the
product rules the brief calls out:

* generation needs a current analysis and only copies the user's own text;
* the standard resume is always derived, so a deleted item never appears there;
* edits and AI rewrites are grounded in cited evidence (an invented metric is
  rejected and falls back to the original text);
* versions are insert-only and restore is non-destructive;
* refresh leaves hand-edited sections alone unless named explicitly, and flags
  removed workspace items for removal.
"""

from __future__ import annotations

import asyncio
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.ai.consent import ConsentGrant, InMemoryConsentStore
from app.ai.schemas import EvidenceItem
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
from app.schemas.workspace import WorkspaceItemCreate
from tests.conftest import FIXED_CLOCK, TEST_SUBJECT, make_token

BASE = "/api/v1"
USER_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

JD = (
    "Senior Frontend Engineer — Halcyon Systems\n\n"
    "Requirements\n"
    "- Strong TypeScript and React skills\n"
    "- 3+ years of experience building web applications\n"
    "- Bachelor's degree in Computer Science\n"
)


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
            section="personal",
            title="Alex Doe",
            organization="alex@example.com",
            evidence="attested",
        ),
        WorkspaceItemCreate(
            section="skill",
            title="TypeScript",
            tags=["TypeScript", "React"],
            evidence="verified",
            links=["https://example.com/typescript"],
        ),
        WorkspaceItemCreate(
            section="experience",
            title="Senior Frontend Engineer",
            organization="Acme",
            startDate="2021-01",
            endDate="2024-01",
            bullets=[
                "Built the design system and internal tooling.",
                "Led the React migration for the customer dashboard.",
                "Mentored two engineers on accessibility.",
            ],
            tags=["TypeScript", "React"],
            evidence="verified",
            links=["https://example.com/acme"],
        ),
        WorkspaceItemCreate(
            section="project",
            title="Inventory dashboard",
            bullets=["Visualised stock levels with React charts."],
            tags=["React"],
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
def resume_repo() -> InMemoryResumeRepository:
    return InMemoryResumeRepository(clock=lambda: FIXED_CLOCK)


@pytest.fixture()
def target_repo() -> InMemoryTargetRepository:
    return InMemoryTargetRepository(clock=lambda: FIXED_CLOCK)


@pytest.fixture()
def consent_store() -> InMemoryConsentStore:
    return InMemoryConsentStore(granted={TEST_SUBJECT, USER_B})


@pytest.fixture()
def resume_client(
    settings: Settings,
    fake_repo: InMemoryWorkspaceRepository,
    target_repo: InMemoryTargetRepository,
    resume_repo: InMemoryResumeRepository,
    consent_store: InMemoryConsentStore,
) -> TestClient:
    app = create_app(settings)
    app.dependency_overrides[get_workspace_repository] = lambda: fake_repo
    app.dependency_overrides[get_target_repository] = lambda: target_repo
    app.dependency_overrides[get_resume_repository] = lambda: resume_repo
    app.state.ai_consent_store = consent_store
    # Keep the suite deterministic and offline: no analysis enrichment and no
    # reworder unless a test pins a fake. (The runtime .env may configure real
    # provider keys; tests must never call them.)
    app.state.analysis_enricher = None
    app.state.resume_reworder = None
    return TestClient(app)


def create_target(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
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
    return cast(dict[str, Any], response.json())


def analyze(client: TestClient, headers: dict[str, str], target_id: str) -> None:
    started = client.post(f"{BASE}/targets/{target_id}/analysis", headers=headers)
    assert started.status_code == 202, started.text
    polled = client.get(f"{BASE}/targets/{target_id}/analysis/run", headers=headers)
    assert polled.status_code == 200
    assert polled.json()["run"]["status"] == "succeeded", polled.text


def prepare(client: TestClient, headers: dict[str, str]) -> str:
    target = create_target(client, headers)
    analyze(client, headers, str(target["id"]))
    return str(target["id"])


def generate(
    client: TestClient,
    headers: dict[str, str],
    target_id: str,
    **body: object,
) -> dict[str, Any]:
    response = client.post(f"{BASE}/targets/{target_id}/resume", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return cast(dict[str, Any], response.json())


def all_claims(resume: dict[str, Any]) -> list[dict[str, Any]]:
    return [claim for section in resume["sections"] for claim in section["claims"]]


def workspace_item(client: TestClient, headers: dict[str, str], title: str) -> dict[str, Any]:
    response = client.get(f"{BASE}/workspace", headers=headers)
    assert response.status_code == 200
    for item in response.json()["items"]:
        if item["title"] == title:
            return cast(dict[str, Any], item)
    raise AssertionError(f"missing workspace item {title}")


class FakeReworder:
    """Deterministic stand-in for the B3 gateway (no network, no prompts)."""

    def __init__(self, text: str) -> None:
        self.text = text
        self.calls = 0

    async def reword(
        self,
        *,
        text: str,
        target_role: str,
        evidence: EvidenceItem,
        consent: ConsentGrant,
    ) -> str:
        self.calls += 1
        return self.text


# --- auth and generation ---------------------------------------------------


def test_resumes_require_authentication(resume_client: TestClient) -> None:
    assert resume_client.get(f"{BASE}/resumes").status_code == 401
    response = resume_client.post(f"{BASE}/targets/x/resume", json={})
    assert response.status_code == 401


def test_generation_requires_a_current_analysis(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target = create_target(resume_client, headers)

    response = resume_client.post(f"{BASE}/targets/{target['id']}/resume", json={}, headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "analysis_required"

    analyze(resume_client, headers, str(target["id"]))
    resume = generate(resume_client, headers, str(target["id"]))
    assert resume["kind"] == "tailored"
    assert resume["targetId"] == target["id"]
    assert resume["title"] == "Senior Frontend Engineer at Halcyon Systems"
    assert resume["aiUsed"] is False
    assert resume["ats"] is not None
    assert resume["editedSections"] == []

    claims = all_claims(resume)
    assert claims
    assert all(claim["evidenceIds"] for claim in claims)
    assert any(section["key"] == "experience" for section in resume["sections"])
    assert resume["workspaceVersion"] == 6  # five seeded items + one
    # Deterministic generation: every claim is the user's own text.
    texts = [claim["text"] for claim in claims]
    assert "Invented achievement" not in texts


def test_generation_is_stale_after_a_workspace_move(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(resume_client, headers)

    async def add() -> None:
        await fake_repo.create_item(
            TEST_SUBJECT,
            WorkspaceItemCreate(
                section="skill", title="GraphQL", tags=["GraphQL"], evidence="attested"
            ),
        )

    asyncio.run(add())
    response = resume_client.post(f"{BASE}/targets/{target_id}/resume", json={}, headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "analysis_stale"


def test_standard_resume_is_derived_and_never_keeps_deleted_items(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(resume_client, headers)
    tailored = generate(resume_client, headers, target_id)

    experience = workspace_item(resume_client, headers, "Senior Frontend Engineer")
    asyncio.run(fake_repo.soft_delete_item(TEST_SUBJECT, experience["id"]))

    standard = resume_client.get(f"{BASE}/resumes/resume-standard", headers=headers)
    assert standard.status_code == 200
    assert standard.json()["kind"] == "standard"
    standard_texts = [claim["text"] for claim in all_claims(standard.json())]
    assert not any("Senior Frontend Engineer" in text for text in standard_texts)
    assert not any("Acme" in text for text in standard_texts)

    # The tailored snapshot still cites the old item, but it is flagged.
    fetched = resume_client.get(f"{BASE}/resumes/{tailored['id']}", headers=headers)
    assert fetched.status_code == 200
    body = fetched.json()
    assert experience["id"] in body["removedEvidenceIds"]
    assert any(claim["removed"] for claim in all_claims(body))
    assert body["stale"] is True


def test_list_contains_standard_and_tailored_summaries(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(resume_client, headers)
    tailored = generate(resume_client, headers, target_id)

    listed = resume_client.get(f"{BASE}/resumes", headers=headers)
    assert listed.status_code == 200
    rows = listed.json()
    assert [row["id"] for row in rows] == ["resume-standard", tailored["id"]]
    assert rows[0]["title"] == "Standard resume"
    assert rows[0]["stale"] is False
    assert rows[1]["title"] == tailored["title"]


# --- edits, grounding and versions ----------------------------------------


def test_edit_section_is_grounded_and_appends_a_version(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
    resume_repo: InMemoryResumeRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(resume_client, headers)
    tailored = generate(resume_client, headers, target_id)
    experience = workspace_item(resume_client, headers, "Senior Frontend Engineer")

    edited = resume_client.patch(
        f"{BASE}/resumes/{tailored['id']}/sections/experience",
        json={
            "claims": [
                {
                    "text": "Led the React migration for the customer dashboard.",
                    "evidenceIds": [experience["id"]],
                },
                {
                    "text": "Mentored two engineers on accessibility.",
                    "evidenceIds": [experience["id"]],
                },
            ]
        },
        headers=headers,
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert body["editedSections"] == ["experience"]
    assert [claim["text"] for claim in body["sections"][1]["claims"]] == [
        "Led the React migration for the customer dashboard.",
        "Mentored two engineers on accessibility.",
    ]
    assert resume_repo.version_count(TEST_SUBJECT, tailored["id"]) == 2

    ungrounded = resume_client.patch(
        f"{BASE}/resumes/{tailored['id']}/sections/experience",
        json={"claims": [{"text": "Increased revenue by 42%.", "evidenceIds": [experience["id"]]}]},
        headers=headers,
    )
    assert ungrounded.status_code == 422
    assert ungrounded.json()["detail"]["code"] == "resume_claim_ungrounded"

    unknown = resume_client.patch(
        f"{BASE}/resumes/{tailored['id']}/sections/experience",
        json={"claims": [{"text": "Built it.", "evidenceIds": ["nope"]}]},
        headers=headers,
    )
    assert unknown.status_code == 422
    assert unknown.json()["detail"]["code"] == "resume_evidence_not_found"

    missing = resume_client.patch(
        f"{BASE}/resumes/{tailored['id']}/sections/volunteering",
        json={"claims": [{"text": "Built it.", "evidenceIds": [experience["id"]]}]},
        headers=headers,
    )
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "resume_section_not_found"


def test_restore_is_non_destructive_and_keeps_history(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
    resume_repo: InMemoryResumeRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(resume_client, headers)
    tailored = generate(resume_client, headers, target_id)
    original_sections = tailored["sections"]
    experience = workspace_item(resume_client, headers, "Senior Frontend Engineer")

    resume_client.patch(
        f"{BASE}/resumes/{tailored['id']}/sections/experience",
        json={"claims": [{"text": "Mentored two engineers.", "evidenceIds": [experience["id"]]}]},
        headers=headers,
    )

    versions = resume_client.get(f"{BASE}/resumes/{tailored['id']}/versions", headers=headers)
    assert versions.status_code == 200
    rows = versions.json()
    assert [row["reason"] for row in rows] == ["edited", "generated"]
    generated_version = rows[-1]

    restored = resume_client.post(
        f"{BASE}/resumes/{tailored['id']}/versions/{generated_version['id']}/restore",
        headers=headers,
    )
    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert body["sections"] == original_sections
    assert body["editedSections"] == []
    assert resume_repo.version_count(TEST_SUBJECT, tailored["id"]) == 3

    after = resume_client.get(f"{BASE}/resumes/{tailored['id']}/versions", headers=headers).json()
    assert len(after) == 3
    assert {row["id"] for row in after} >= {row["id"] for row in rows}
    assert after[0]["reason"] == "restored"

    stale = resume_client.post(f"{BASE}/resumes/{tailored['id']}/stale", headers=headers)
    assert stale.status_code == 200
    assert stale.json()["stale"] is True

    read_only = resume_client.post(f"{BASE}/resumes/resume-standard/stale", headers=headers)
    assert read_only.status_code == 409
    assert read_only.json()["detail"]["code"] == "resume_not_tailored"
    assert (
        resume_client.get(f"{BASE}/resumes/resume-standard/versions", headers=headers).json() == []
    )


# --- diff and refresh ------------------------------------------------------


def test_diff_and_default_refresh_follow_the_workspace(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(resume_client, headers)
    tailored = generate(resume_client, headers, target_id)
    experience = workspace_item(resume_client, headers, "Senior Frontend Engineer")
    project = workspace_item(resume_client, headers, "Inventory dashboard")

    async def mutate() -> None:
        await fake_repo.update_item(
            TEST_SUBJECT, experience["id"], {"title": "Staff Frontend Engineer"}
        )
        await fake_repo.soft_delete_item(TEST_SUBJECT, project["id"])
        await fake_repo.create_item(
            TEST_SUBJECT,
            WorkspaceItemCreate(
                section="project",
                title="Design system",
                bullets=["Shipped a token-driven component library."],
                tags=["React"],
                evidence="verified",
                links=["https://example.com/design-system"],
            ),
        )

    asyncio.run(mutate())

    diff = resume_client.get(f"{BASE}/resumes/{tailored['id']}/diff", headers=headers)
    assert diff.status_code == 200, diff.text
    body = diff.json()
    assert body["stale"] is True
    assert body["workspaceVersion"] < body["currentWorkspaceVersion"]
    assert experience["id"] in [entry["itemId"] for entry in body["edited"]]
    assert project["id"] in [entry["itemId"] for entry in body["removed"]]
    assert "experience" in body["changedSections"]
    assert "project" in body["changedSections"]

    refreshed = resume_client.post(
        f"{BASE}/resumes/{tailored['id']}/refresh", json={}, headers=headers
    )
    assert refreshed.status_code == 200, refreshed.text
    result = refreshed.json()
    assert result["skippedSections"] == []
    assert "experience" in result["refreshedSections"]
    assert result["resume"]["stale"] is False
    assert result["resume"]["removedEvidenceIds"] == []
    texts = [claim["text"] for claim in all_claims(result["resume"])]
    assert "Staff Frontend Engineer · Acme · 2021-01 – 2024-01" in texts
    assert not any("Inventory dashboard" in text for text in texts)
    assert any("Design system" in text for text in texts)
    assert result["resume"]["ats"] is not None


def test_refresh_skips_hand_edited_sections_until_explicitly_named(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(resume_client, headers)
    tailored = generate(resume_client, headers, target_id)
    experience = workspace_item(resume_client, headers, "Senior Frontend Engineer")

    resume_client.patch(
        f"{BASE}/resumes/{tailored['id']}/sections/experience",
        json={
            "claims": [
                {
                    "text": "Led the React migration for the customer dashboard.",
                    "evidenceIds": [experience["id"]],
                }
            ]
        },
        headers=headers,
    )
    asyncio.run(
        fake_repo.update_item(TEST_SUBJECT, experience["id"], {"title": "Staff Frontend Engineer"})
    )

    skipped = resume_client.post(
        f"{BASE}/resumes/{tailored['id']}/refresh", json={}, headers=headers
    )
    assert skipped.status_code == 200, skipped.text
    body = skipped.json()
    assert body["skippedSections"] == [{"section": "experience", "reason": "edited"}]
    experience_section = next(
        section for section in body["resume"]["sections"] if section["key"] == "experience"
    )
    assert [claim["text"] for claim in experience_section["claims"]] == [
        "Led the React migration for the customer dashboard."
    ]

    overwritten = resume_client.post(
        f"{BASE}/resumes/{tailored['id']}/refresh",
        json={"sections": ["experience"], "overwriteEditedSections": ["experience"]},
        headers=headers,
    )
    assert overwritten.status_code == 200, overwritten.text
    result = overwritten.json()
    assert result["skippedSections"] == []
    assert result["refreshedSections"] == ["experience"]
    assert result["resume"]["editedSections"] == []
    texts = [claim["text"] for claim in all_claims(result["resume"])]
    assert "Staff Frontend Engineer · Acme · 2021-01 – 2024-01" in texts

    bad_section = resume_client.post(
        f"{BASE}/resumes/{tailored['id']}/refresh",
        json={"sections": ["volunteering"]},
        headers=headers,
    )
    assert bad_section.status_code == 422
    assert bad_section.json()["detail"]["code"] == "resume_section_invalid"


# --- AI rewording ----------------------------------------------------------


def test_ungrounded_ai_rewrite_falls_back_to_the_original_text(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(resume_client, headers)
    reworder = FakeReworder("Increased revenue by 42%.")
    cast(FastAPI, resume_client.app).state.resume_reworder = reworder

    resume = generate(resume_client, headers, target_id, rewordWithAi=True)
    assert reworder.calls > 0
    assert resume["aiUsed"] is False
    assert not any("42%" in claim["text"] for claim in all_claims(resume))
    assert not any(claim["aiRewritten"] for claim in all_claims(resume))
    # The original bullets are still there.
    assert any(
        claim["text"] == "Built the design system and internal tooling."
        for claim in all_claims(resume)
    )


def test_grounded_ai_rewrite_is_used_and_recorded(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(resume_client, headers)
    resume_client_app = cast(FastAPI, resume_client.app)
    resume_client_app.state.resume_reworder = FakeReworder(
        "Delivered the design system and internal tooling."
    )

    resume = generate(resume_client, headers, target_id, rewordWithAi=True)
    assert resume["aiUsed"] is True
    rewritten = [claim for claim in all_claims(resume) if claim["aiRewritten"]]
    assert rewritten
    assert any(
        claim["text"] == "Delivered the design system and internal tooling." for claim in rewritten
    )


def test_ai_requires_configuration_and_consent(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
    consent_store: InMemoryConsentStore,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(resume_client, headers)

    # No provider configured and no test override: refuse before any call.
    response = resume_client.post(
        f"{BASE}/targets/{target_id}/resume",
        json={"rewordWithAi": True},
        headers=headers,
    )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "ai_not_configured"

    cast(FastAPI, resume_client.app).state.resume_reworder = FakeReworder(
        "Built the design system."
    )
    consent_store.revoke(TEST_SUBJECT)
    response = resume_client.post(
        f"{BASE}/targets/{target_id}/resume",
        json={"rewordWithAi": True},
        headers=headers,
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ai_consent_required"


# --- isolation -------------------------------------------------------------


def test_resumes_are_user_scoped(
    resume_client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(resume_client, headers)
    tailored = generate(resume_client, headers, target_id)

    other = headers_for(USER_B)
    assert resume_client.get(f"{BASE}/resumes/{tailored['id']}", headers=other).status_code == 404
    assert (
        resume_client.get(f"{BASE}/resumes/{tailored['id']}/versions", headers=other).status_code
        == 404
    )
    assert (
        resume_client.patch(
            f"{BASE}/resumes/{tailored['id']}/sections/experience",
            json={"claims": [{"text": "Built it.", "evidenceIds": ["x"]}]},
            headers=other,
        ).status_code
        == 404
    )

    listed = resume_client.get(f"{BASE}/resumes", headers=other)
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == ["resume-standard"]
