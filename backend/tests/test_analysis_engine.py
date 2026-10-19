"""Deterministic analysis engine unit tests (B4).

Golden parity with the TypeScript engine lives in ``test_analysis_parity.py``;
these tests pin the behaviour each part promises on its own, including the
product rules that must never regress:

* adjacent skills are *related, never equivalent* (PRD §4.3);
* a claim needs verified or user-attested evidence -- related is a gap;
* the score is a weighted factor sum with renormalisation, never a hiring
  probability; an empty workspace never gets a fabricated score;
* the ATS report is deterministic and always explained.
"""

from __future__ import annotations

import pytest

from app.analysis.matching import build_evidence_index, classify_requirement, match_requirements
from app.analysis.numeric import js_round, round_fixed
from app.analysis.report import assemble_report, build_roadmap
from app.analysis.requirements import RequirementDraft, extract_requirements
from app.analysis.scoring import compute_factors, weighted_score
from app.analysis.taxonomy import (
    find_skill_by_term,
    implementer_skills,
    mentions_skill,
    related_skills,
)
from app.schemas.analysis import (
    ATS_DISCLAIMER,
    SCORE_DISCLAIMER,
    JobTarget,
    Requirement,
)
from app.schemas.workspace import WorkspaceItemResponse

UPDATED = "2026-10-17T12:00:00.000Z"


def make_item(
    item_id: str,
    *,
    section: str = "skill",
    title: str = "TypeScript",
    evidence: str = "verified",
    tags: list[str] | None = None,
    bullets: list[str] | None = None,
    organization: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> WorkspaceItemResponse:
    return WorkspaceItemResponse(
        id=item_id,
        section=section,  # type: ignore[arg-type]
        title=title,
        organization=organization,
        startDate=start,
        endDate=end,
        bullets=bullets or [],
        tags=tags or [],
        links=["https://example.com/proof"] if evidence == "verified" else [],
        evidence=evidence,  # type: ignore[arg-type]
        order=0,
    )


def make_index(*items: WorkspaceItemResponse):
    return build_evidence_index(list(items), UPDATED)


def skill_draft(key: str, kind: str = "required") -> RequirementDraft:
    return RequirementDraft(id=f"req-skill-{key}", text=key, kind=kind, skillKey=key)


def make_target(**overrides: object) -> JobTarget:
    base: dict[str, object] = {
        "id": "tgt-1",
        "role": "Senior Frontend Engineer",
        "company": "Halcyon Systems",
        "jobDescription": "Senior Frontend Engineer\n\nRequirements\n- TypeScript\n- React",
        "requiredSkills": ["TypeScript", "React"],
        "template": "precision",
        "length": "one_page",
        "status": "draft",
        "createdAt": "2026-10-16T09:00:00.000Z",
        "updatedAt": "2026-10-16T09:00:00.000Z",
    }
    base.update(overrides)
    return JobTarget.model_validate(base)


# --- taxonomy ---------------------------------------------------------------


def test_taxonomy_terms_and_aliases_resolve_to_one_skill() -> None:
    assert find_skill_by_term("TypeScript") is not None
    assert find_skill_by_term("typescript").key == "typescript"  # type: ignore[union-attr]
    assert find_skill_by_term("Postgres").key == "postgresql"  # type: ignore[union-attr]
    assert find_skill_by_term("React.js").key == "react"  # type: ignore[union-attr]


def test_adjacent_skills_are_related_never_equivalent() -> None:
    docker = find_skill_by_term("Docker")
    kubernetes = find_skill_by_term("Kubernetes")
    assert docker is not None and kubernetes is not None
    assert kubernetes.key in [skill.key for skill in related_skills(docker.key)]
    assert docker.key in [skill.key for skill in related_skills(kubernetes.key)]


def test_one_directional_implementer_rule() -> None:
    # PostgreSQL is a concrete SQL engine: postgres evidence answers "SQL".
    implementers = [skill.key for skill in implementer_skills("sql")]
    assert "postgresql" in implementers
    assert "mysql" in implementers
    # ... but SQL is not a PostgreSQL engine: the reverse never holds.
    assert implementer_skills("postgresql") == []


def test_short_terms_need_whole_word_matches() -> None:
    java = find_skill_by_term("Java")
    assert java is not None
    assert mentions_skill("senior javascript engineer", java) is False
    assert mentions_skill("senior java engineer", java) is True


# --- extraction -------------------------------------------------------------


def test_extraction_recognises_skills_experience_education_and_seniority() -> None:
    jd = (
        "Senior Frontend Engineer — Halcyon Systems\n"
        "Requirements\n"
        "- 5+ years of experience building web applications\n"
        "- Strong TypeScript and React skills\n"
        "- Bachelor's degree in Computer Science\n"
    )
    drafts = extract_requirements(job_description=jd, required_skills=["GraphQL"])
    by_id = {draft.id: draft for draft in drafts}

    assert by_id["req-skill-typescript"].kind == "required"
    assert by_id["req-skill-react"].kind == "required"
    assert by_id["req-skill-graphql"].kind == "required"
    assert by_id["req-experience"].pattern == "experience"
    assert by_id["req-experience"].years == 5
    assert by_id["req-education"].pattern == "education"
    assert by_id["req-seniority"].pattern == "seniority"
    assert by_id["req-seniority"].term == "senior"


def test_extraction_is_stable_for_identical_inputs() -> None:
    jd = "- TypeScript\n- 3 years of experience\n- Bachelor degree"
    first = extract_requirements(job_description=jd, required_skills=[])
    second = extract_requirements(job_description=jd, required_skills=[])
    assert first == second


# --- classification ---------------------------------------------------------


def test_verified_evidence_matches_and_related_evidence_is_partial() -> None:
    index = make_index(
        make_item("i-ts", title="TypeScript", tags=["TypeScript"], evidence="verified"),
        make_item("i-react", title="React contract work", tags=["React"], evidence="related"),
    )
    matched = classify_requirement(skill_draft("typescript"), index)
    partial = classify_requirement(skill_draft("react"), index)

    assert matched.status == "matched"
    assert matched.evidenceIds == ["i-ts"]
    assert partial.status == "partial"
    assert partial.gapType is None


def test_unsupported_splits_into_not_evidenced_and_genuinely_missing() -> None:
    index = make_index(
        make_item("i-docker", title="Docker", tags=["Docker"], evidence="attested"),
    )
    not_evidenced = classify_requirement(skill_draft("kubernetes"), index)
    genuinely_missing = classify_requirement(skill_draft("rust"), index)

    assert not_evidenced.status == "unsupported"
    assert not_evidenced.gapType == "not_evidenced"
    assert not_evidenced.evidenceIds == ["i-docker"]
    assert genuinely_missing.status == "unsupported"
    assert genuinely_missing.gapType == "genuinely_missing"
    assert genuinely_missing.evidenceIds == []


def test_concrete_engine_answers_the_general_skill_only_one_way() -> None:
    index = make_index(
        make_item("i-sql", title="SQL reporting queries", tags=["SQL"], evidence="attested"),
    )
    sql = classify_requirement(skill_draft("sql"), index)
    postgresql = classify_requirement(skill_draft("postgresql"), index)

    assert sql.status == "matched"
    assert sql.evidenceIds == ["i-sql"]
    # SQL is not a PostgreSQL engine -- the reverse never holds.
    assert postgresql.status == "unsupported"
    assert postgresql.gapType == "not_evidenced"


def test_match_counts_mirror_statuses() -> None:
    index = make_index(
        make_item("i-ts", title="TypeScript", tags=["TypeScript"], evidence="verified"),
    )
    result = match_requirements(
        [skill_draft("typescript"), skill_draft("react"), skill_draft("rust")], index
    )
    assert result.counts == {"matched": 1, "partial": 0, "unsupported": 2}
    assert [r.status for r in result.requirements] == ["matched", "unsupported", "unsupported"]


# --- scoring ----------------------------------------------------------------


def test_factors_renormalise_when_a_factor_has_no_requirements() -> None:
    index = make_index(
        make_item(
            "i-exp",
            section="experience",
            title="Frontend Engineer",
            organization="Acme",
            tags=["TypeScript"],
            start="2021-01",
            end="2024-01",
            evidence="attested",
        ),
        make_item(
            "i-edu",
            section="education",
            title="BSc Computer Science",
            organization="Example University",
            evidence="verified",
        ),
    )
    requirements = [
        Requirement(
            id="req-skill-typescript",
            text="TypeScript",
            kind="required",
            status="matched",
            evidenceIds=["i-exp"],
            explanation="matched",
        ),
        Requirement(
            id="req-experience",
            text="4 years",
            kind="required",
            pattern="experience",
            status="matched",
            evidenceIds=["i-exp"],
            explanation="matched",
        ),
    ]
    factors = compute_factors(requirements, index)
    names = [factor.name for factor in factors]
    # No preferred-skill requirement and no project items: those factors drop.
    assert "Preferred skills" not in names
    assert "Projects & achievements" not in names
    assert pytest.approx(sum(factor.weight for factor in factors), abs=1e-4) == 1.0
    assert weighted_score(factors) == js_round(
        sum(factor.weight * factor.value for factor in factors)
        / sum(factor.weight for factor in factors)
    )


def test_empty_workspace_never_gets_a_fabricated_score() -> None:
    index = make_index()
    requirements = [
        Requirement(
            id="req-skill-typescript",
            text="TypeScript",
            kind="required",
            status="unsupported",
            gapType="genuinely_missing",
            evidenceIds=[],
            explanation="missing",
        )
    ]
    factors = compute_factors(requirements, index)
    assert weighted_score(factors) == 0
    assert all(factor.value == 0 for factor in factors)


def test_no_requirements_drops_skill_factors_and_scores_zero() -> None:
    factors = compute_factors([], make_index())
    names = [factor.name for factor in factors]
    assert "Required skills" not in names
    assert "Preferred skills" not in names
    assert weighted_score(factors) == 0


# --- ATS / roadmap / assembly ----------------------------------------------


def test_ats_report_is_deterministic_and_explained() -> None:
    items = [
        make_item(
            "i-exp",
            section="experience",
            title="Frontend Engineer",
            organization="Acme",
            bullets=["Built the design system"] * 6,
            start="2021-01",
            end="2024-01",
            evidence="attested",
        ),
        make_item("i-skill", title="TypeScript", tags=["TypeScript"]),
    ]
    requirements = [skill_draft("typescript")]
    first = assemble_report(
        target=make_target(),
        items=items,
        workspace_version=3,
        workspace_updated_at=UPDATED,
        generated_at="2026-10-17T12:00:00.000Z",
        requirements=[
            classify_requirement(draft, build_evidence_index(items, UPDATED))
            for draft in requirements
        ],
    )
    second = assemble_report(
        target=make_target(),
        items=items,
        workspace_version=3,
        workspace_updated_at=UPDATED,
        generated_at="2026-10-17T12:00:00.000Z",
        requirements=first.requirements,
    )
    assert first.ats == second.ats
    assert first.score == second.score
    assert first.methodology.atsNote
    assert first.methodology.scoreDisclaimer == SCORE_DISCLAIMER
    assert first.methodology.atsDisclaimer == ATS_DISCLAIMER
    assert first.aiUsed is False


def test_roadmap_prioritises_gaps_without_fabricating_evidence() -> None:
    index = make_index(
        make_item("i-react", title="React", tags=["React"], evidence="related"),
    )
    requirements = match_requirements(
        [skill_draft("typescript"), skill_draft("react"), skill_draft("rust")], index
    ).requirements
    steps = build_roadmap(index, requirements, make_target())
    assert [step.priority for step in steps] == list(range(1, len(steps) + 1))
    assert all(step.action and step.reason for step in steps)


# --- numeric parity helpers -------------------------------------------------


def test_numeric_helpers_match_javascript_semantics() -> None:
    assert js_round(0.5) == 1
    assert js_round(2.5) == 3
    assert js_round(1.499) == 1
    assert js_round(-0.5) == 0
    assert round_fixed(0.5714285, 4) == 0.5714
