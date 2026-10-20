"""Optional AI enrichment tests (B4).

The deterministic engine must never depend on a model (PRD §6.9): these tests
pin the three guarantees that make that true even when enrichment runs:

* refinement can only add a *taxonomy-known skill the posting literally
  mentions* -- it can never invent a requirement;
* gap explanations may change prose, but never a status, an evidence link or
  the score;
* any gateway failure falls back silently to the deterministic report, and the
  refinement cache keeps the same posting deterministic across runs.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, cast

from fastapi.testclient import TestClient

from app.ai.consent import ConsentGrant, InMemoryConsentStore
from app.ai.errors import AINotConfiguredError
from app.ai.gateway import AIGateway
from app.ai.schemas import Claim, GapExplanationResult, JobRequirementsResult, RequirementClaim
from app.analysis.enrichment import AnalysisEnricher
from app.analysis.matching import (
    EvidenceIndex,
    build_evidence_index,
    match_requirements,
)
from app.analysis.requirements import RequirementDraft, extract_requirements
from app.api.deps import get_target_repository, get_workspace_repository
from app.core.config import Settings
from app.main import create_app
from app.repositories.memory import InMemoryWorkspaceRepository
from app.repositories.target_memory import InMemoryTargetRepository
from app.schemas.analysis import Requirement
from app.schemas.workspace import EvidenceState, WorkspaceItemResponse, WorkspaceSection
from tests.conftest import FIXED_CLOCK, TEST_SUBJECT
from tests.test_targets_api import JD, headers_for, seed_items, seed_workspace

BASE = "/api/v1"
CONSENT = ConsentGrant(user_id=TEST_SUBJECT)
JD_WITH_GAP = JD + "- Kubernetes orchestration experience\n"


@dataclass
class _Result:
    value: object


class FakeGateway:
    """Minimal stand-in for :class:`~app.ai.gateway.AIGateway`."""

    def __init__(
        self,
        *,
        requirements: list[str] | None = None,
        explanation: str = "",
        fail: bool = False,
    ) -> None:
        self._requirements = requirements or []
        self._explanation = explanation
        self._fail = fail
        self.calls: list[str] = []

    async def run(
        self,
        task: str,
        payload: object,
        evidence: list[object],
        *,
        consent: object = None,
        profile: object = None,
        grounding: str = "fail",
    ) -> _Result:
        self.calls.append(task)
        if self._fail:
            raise AINotConfiguredError()
        if task == "parse_job_requirements":
            claims = [
                RequirementClaim(text=text, evidence_ids=["jd"], category="must_have")
                for text in self._requirements
            ]
            return _Result(JobRequirementsResult(claims=claims))
        return _Result(
            GapExplanationResult(
                claims=[Claim(text=self._explanation, evidence_ids=["req-skill-rust"])]
            )
        )


def ws_item(
    item_id: str,
    *,
    title: str,
    section: WorkspaceSection = "skill",
    evidence: EvidenceState = "verified",
) -> WorkspaceItemResponse:
    return WorkspaceItemResponse(
        id=item_id,
        section=section,
        title=title,
        tags=[title],
        links=["https://example.com/proof"] if evidence == "verified" else [],
        evidence=evidence,
        order=0,
    )


# --- refinement -------------------------------------------------------------


def test_refinement_adds_only_taxonomy_skills_the_posting_mentions() -> None:
    jd = "We orchestrate services with Kubernetes and Docker."
    gateway = FakeGateway(requirements=["Experience with Kubernetes", "A warm personality"])
    enricher = AnalysisEnricher(cast(AIGateway, gateway))

    drafts, used = asyncio.run(enricher.refine(job_description=jd, drafts=[], consent=CONSENT))

    keys = {draft.skillKey for draft in drafts}
    assert "kubernetes" in keys  # named in the claim *and* the posting
    # "A warm personality" maps to no taxonomy skill, so nothing is invented.
    assert all(draft.skillKey is not None for draft in drafts)
    assert used is True
    assert gateway.calls == ["parse_job_requirements"]


def test_refinement_never_adds_a_skill_the_posting_omits() -> None:
    jd = "We build web applications in TypeScript."
    gateway = FakeGateway(requirements=["Deep Kubernetes and Terraform experience"])
    enricher = AnalysisEnricher(cast(AIGateway, gateway))

    drafts, used = asyncio.run(enricher.refine(job_description=jd, drafts=[], consent=CONSENT))
    assert drafts == []
    assert used is False


def test_refinement_does_not_duplicate_an_existing_requirement() -> None:
    jd = "Requirements: TypeScript and React."
    gateway = FakeGateway(requirements=["TypeScript", "React"])
    enricher = AnalysisEnricher(cast(AIGateway, gateway))

    existing = extract_requirements(job_description=jd, required_skills=[])
    drafts, used = asyncio.run(
        enricher.refine(job_description=jd, drafts=existing, consent=CONSENT)
    )
    assert [draft.id for draft in drafts] == [draft.id for draft in existing]
    assert used is False


def test_refinement_is_cached_per_job_description() -> None:
    jd = "Requirements: Kubernetes."
    gateway = FakeGateway(requirements=["Kubernetes"])
    enricher = AnalysisEnricher(cast(AIGateway, gateway))

    asyncio.run(enricher.refine(job_description=jd, drafts=[], consent=CONSENT))
    asyncio.run(enricher.refine(job_description=jd, drafts=[], consent=CONSENT))
    assert gateway.calls == ["parse_job_requirements"]  # second call served from cache


def test_refinement_failure_falls_back_to_the_deterministic_drafts() -> None:
    jd = "Requirements: Kubernetes."
    enricher = AnalysisEnricher(
        cast(AIGateway, FakeGateway(requirements=["Kubernetes"], fail=True))
    )
    baseline = extract_requirements(job_description=jd, required_skills=[])

    drafts, used = asyncio.run(
        enricher.refine(job_description=jd, drafts=baseline, consent=CONSENT)
    )
    assert drafts == baseline
    assert used is False


# --- gap explanations -------------------------------------------------------


def _unsupported_requirement() -> tuple[Requirement, EvidenceIndex]:
    index = build_evidence_index(
        [ws_item("i-docker", title="Docker", evidence="attested")], FIXED_CLOCK
    )
    draft = RequirementDraft(id="req-skill-rust", text="Rust", kind="required", skillKey="rust")
    return match_requirements([draft], index).requirements[0], index


def test_gap_explanation_changes_prose_only() -> None:
    requirement, index = _unsupported_requirement()
    gateway = FakeGateway(explanation="No Rust evidence; Docker is the closest tooling.")
    enricher = AnalysisEnricher(cast(AIGateway, gateway))

    updated, used = asyncio.run(
        enricher.explain(
            job_description="Rust",
            requirements=[requirement],
            items=index.items,
            consent=CONSENT,
        )
    )
    changed = updated[0]
    assert used is True
    assert changed.explanation == "No Rust evidence; Docker is the closest tooling."
    # Status, evidence and gap type are untouched by the model.
    assert changed.status == requirement.status
    assert changed.evidenceIds == requirement.evidenceIds
    assert changed.gapType == requirement.gapType


def test_gap_explanation_failure_keeps_the_deterministic_text() -> None:
    requirement, index = _unsupported_requirement()
    enricher = AnalysisEnricher(cast(AIGateway, FakeGateway(explanation="ignored", fail=True)))

    updated, used = asyncio.run(
        enricher.explain(
            job_description="Rust",
            requirements=[requirement],
            items=index.items,
            consent=CONSENT,
        )
    )
    assert used is False
    assert updated[0].explanation == requirement.explanation


# --- end-to-end (deterministic score preserved) -----------------------------


def _client_with(enricher: AnalysisEnricher | None) -> TestClient:
    settings = Settings(
        environment="test",
        cors_origins=["http://localhost:3000"],
        supabase_url="https://test.supabase.co",
        supabase_jwt_secret="test-legacy-secret-that-is-not-real",
        supabase_jwt_audience="authenticated",
        supabase_jwt_issuer="https://test.supabase.co/auth/v1",
        rate_limit_per_minute=1000,
    )
    app = create_app(settings)
    workspace = InMemoryWorkspaceRepository(clock=lambda: FIXED_CLOCK)
    targets = InMemoryTargetRepository(clock=lambda: FIXED_CLOCK)
    app.dependency_overrides[get_workspace_repository] = lambda: workspace
    app.dependency_overrides[get_target_repository] = lambda: targets
    app.state.ai_consent_store = InMemoryConsentStore(granted={TEST_SUBJECT})
    app.state.analysis_enricher = enricher
    seed_workspace(workspace, TEST_SUBJECT, seed_items())
    return TestClient(app)


def _run_and_report(client: TestClient) -> dict[str, Any]:
    headers = headers_for(TEST_SUBJECT)
    target = client.post(
        f"{BASE}/targets",
        json={
            "role": "Senior Frontend Engineer",
            "company": "Halcyon Systems",
            "jobDescription": JD_WITH_GAP,
            "requiredSkills": ["TypeScript", "React"],
            "template": "precision",
            "length": "one_page",
        },
        headers=headers,
    )
    assert target.status_code == 201, target.text
    target_id = target.json()["id"]
    client.post(f"{BASE}/targets/{target_id}/analysis", headers=headers).raise_for_status()
    report = client.get(f"{BASE}/targets/{target_id}/analysis", headers=headers)
    report.raise_for_status()
    return cast(dict[str, Any], report.json())


def test_ai_enrichment_leaves_the_deterministic_score_untouched() -> None:
    plain = _run_and_report(_client_with(None))
    enriched = _run_and_report(
        _client_with(
            AnalysisEnricher(
                cast(
                    AIGateway,
                    FakeGateway(
                        requirements=["TypeScript"],
                        explanation="Gap explained by the model.",
                    ),
                )
            )
        )
    )

    assert enriched["score"] == plain["score"]
    assert [r["id"] for r in enriched["requirements"]] == [r["id"] for r in plain["requirements"]]
    assert [r["status"] for r in enriched["requirements"]] == [
        r["status"] for r in plain["requirements"]
    ]
    assert enriched["aiUsed"] is True
    assert plain["aiUsed"] is False
