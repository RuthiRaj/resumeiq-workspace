"""Claim validator v1: adversarial grounding cases (no LLM, no network)."""

from __future__ import annotations

import pytest

from app.ai.claims import ClaimValidator, numbers_in, technologies_in, titles_in
from app.ai.errors import AIGroundingError
from app.ai.schemas import (
    BulletRewriteResult,
    Claim,
    EvidenceItem,
    FieldClaim,
    JobRequirementsResult,
    RequirementClaim,
    ResumeFieldsResult,
)

VALIDATOR = ClaimValidator()

EVIDENCE = [
    EvidenceItem(
        id="ev1",
        kind="workspace_item",
        text=(
            "Built a Python service handling 12,000 requests per day with FastAPI and "
            "PostgreSQL. Wrote JavaScript and Kubernetes manifests. "
            "Worked as a Software Engineer at Northwind Labs from 2021 to 2023."
        ),
        technologies=["Python", "FastAPI", "PostgreSQL", "JavaScript", "Kubernetes"],
        organizations=["Northwind Labs"],
        titles=["Software Engineer"],
        dates=["2021", "2023"],
    )
]


def check(text: str, *, evidence=EVIDENCE, evidence_ids=("ev1",)):
    result = BulletRewriteResult(claims=[Claim(text=text, evidence_ids=list(evidence_ids))])
    return VALIDATOR.validate(result, evidence)


def codes(report) -> set[str]:
    return set(report.codes())


def test_grounded_claim_passes() -> None:
    report = check("Built a Python service handling 12,000 requests per day with FastAPI.")
    assert report.ok, report.violations
    assert report.claims_checked == 1


def test_rewording_is_allowed() -> None:
    # Same facts, different words, no new number or technology.
    report = check("Delivered a Python service that handled 12,000 requests per day.")
    assert report.ok, report.violations


def test_invented_metric_is_rejected() -> None:
    report = check("Improved service throughput by 40%.")
    assert not report.ok
    assert "invented_metric" in codes(report)
    assert any(violation.detail == "40%" for violation in report.violations)


def test_adjacent_skill_substitution_typescript_for_javascript() -> None:
    report = check("Wrote TypeScript services.")
    assert not report.ok
    assert "unsupported_technology" in codes(report)
    assert any(violation.detail == "typescript" for violation in report.violations)


def test_adjacent_skill_substitution_docker_for_kubernetes() -> None:
    report = check("Shipped Docker containers.")
    assert not report.ok
    assert "unsupported_technology" in codes(report)
    assert any(violation.detail == "docker" for violation in report.violations)


def test_declared_technology_is_accepted() -> None:
    assert check("Wrote Kubernetes manifests.").ok


def test_inflated_title_is_rejected() -> None:
    report = check("Worked as a Senior Software Engineer at Northwind Labs.")
    assert not report.ok
    assert "inflated_title" in codes(report)


def test_subset_title_is_not_inflation() -> None:
    # Evidence says "Software Engineer"; claiming exactly that is fine.
    assert check("Worked as a Software Engineer.").ok


def test_invented_organization_is_rejected() -> None:
    report = check("Worked as a Software Engineer at Acme Inc.")
    assert not report.ok
    assert "unsupported_organization" in codes(report)


def test_declared_organization_is_accepted() -> None:
    assert check("Worked as a Software Engineer at Northwind Labs.").ok


def test_invented_date_is_rejected() -> None:
    report = check("Worked there from 2015 to 2019.")
    assert not report.ok
    assert "unsupported_date" in codes(report)


def test_supported_date_is_accepted() -> None:
    assert check("Worked there from 2021 to 2023.").ok


def test_unknown_evidence_id_is_rejected() -> None:
    report = check("Built a Python service.", evidence_ids=("ev-unknown",))
    assert not report.ok
    assert "unknown_evidence_id" in codes(report)
    assert "missing_evidence" in codes(report)


def test_evidence_from_a_second_item_is_accepted() -> None:
    second = EvidenceItem(id="ev2", kind="workspace_item", text="Wrote GraphQL resolvers.")
    report = check("Wrote GraphQL resolvers.", evidence=[*EVIDENCE, second], evidence_ids=("ev2",))
    assert report.ok, report.violations


def test_claim_citing_the_wrong_evidence_is_rejected() -> None:
    second = EvidenceItem(id="ev2", kind="workspace_item", text="Wrote GraphQL resolvers.")
    report = check(
        "Built a Python service handling 12,000 requests per day.",
        evidence=[*EVIDENCE, second],
        evidence_ids=("ev2",),
    )
    assert not report.ok
    assert "invented_metric" in codes(report)


def test_enforce_raises_with_typed_violations() -> None:
    result = BulletRewriteResult(
        claims=[Claim(text="Wrote TypeScript services.", evidence_ids=["ev1"])]
    )
    with pytest.raises(AIGroundingError) as excinfo:
        VALIDATOR.enforce("rewrite_bullet", result, EVIDENCE)
    assert excinfo.value.task == "rewrite_bullet"
    assert excinfo.value.violations[0].code == "unsupported_technology"


def test_requirement_claims_are_validated_too() -> None:
    result = JobRequirementsResult(
        claims=[
            RequirementClaim(
                text="Must have 7 years of Kubernetes experience.",
                category="must_have",
                evidence_ids=["ev1"],
            )
        ]
    )
    report = VALIDATOR.validate(result, EVIDENCE)
    assert not report.ok
    assert "invented_metric" in codes(report)


def test_field_claims_are_validated_too() -> None:
    result = ResumeFieldsResult(
        claims=[FieldClaim(field="location", text="Springfield, IL", evidence_ids=["ev1"])]
    )
    report = VALIDATOR.validate(result, EVIDENCE)
    assert report.claims_checked == 1


def test_technology_lexicon_keeps_adjacent_skills_distinct() -> None:
    assert technologies_in("experience with TypeScript") == {"typescript"}
    assert technologies_in("experience with JavaScript") == {"javascript"}
    assert technologies_in("Docker and Kubernetes") == {"docker", "kubernetes"}


def test_number_and_title_extractors() -> None:
    assert "12000" in numbers_in("handled 12,000 requests")
    assert "40%" in numbers_in("up 40%")
    assert "software engineer" in titles_in("Software Engineer at Northwind Labs")
