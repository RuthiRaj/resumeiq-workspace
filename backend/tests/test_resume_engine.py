"""Deterministic tailored-resume engine tests (B5, no network)."""

from __future__ import annotations

from app.schemas.analysis import Requirement
from app.schemas.resume import Claim, ResumeEvidence, ResumeResponse, ResumeSection
from app.schemas.workspace import (
    EvidenceState,
    WorkspaceItemResponse,
    WorkspaceResponse,
    WorkspaceSection,
)
from app.services.resume_engine import (
    build_diff,
    claim_is_grounded,
    evidence_from_item,
    generate_tailored_resume,
)


def item(
    item_id: str,
    section: WorkspaceSection,
    *,
    title: str,
    organization: str | None = None,
    start: str | None = None,
    end: str | None = None,
    bullets: list[str] | None = None,
    tags: list[str] | None = None,
    evidence: EvidenceState = "attested",
    order: int = 0,
    deleted_at: str | None = None,
) -> WorkspaceItemResponse:
    return WorkspaceItemResponse(
        id=item_id,
        section=section,
        title=title,
        organization=organization,
        startDate=start,
        endDate=end,
        bullets=bullets or [],
        tags=tags or [],
        evidence=evidence,
        order=order,
        deletedAt=deleted_at,
    )


def workspace(items: list[WorkspaceItemResponse], version: int = 3) -> WorkspaceResponse:
    return WorkspaceResponse(
        version=version,
        items=items,
        updatedAt="2026-10-21T10:00:00.000Z",
    )


def requirement(
    requirement_id: str,
    text: str,
    *,
    kind: str = "required",
    status: str = "matched",
    evidence_ids: list[str] | None = None,
) -> Requirement:
    return Requirement(
        id=requirement_id,
        text=text,
        kind=kind,
        status=status,
        evidenceIds=evidence_ids or [],
    )


def base_items() -> list[WorkspaceItemResponse]:
    return [
        item(
            "p1",
            "personal",
            title="Alex Doe",
            organization="alex@example.com",
            evidence="attested",
            order=0,
        ),
        item(
            "e-react",
            "experience",
            title="Senior Frontend Engineer",
            organization="Acme",
            start="2021-01",
            end="2024-01",
            bullets=[
                "Built the design system and internal tooling.",
                "Led the React migration for the customer dashboard.",
                "Mentored two engineers on accessibility.",
            ],
            tags=["React", "TypeScript"],
            evidence="verified",
            order=1,
        ),
        item(
            "e-python",
            "experience",
            title="Backend Engineer",
            organization="Beta",
            start="2019-01",
            end="2021-01",
            bullets=[
                "Built Python services for billing.",
                "Automated weekly reconciliation reports.",
            ],
            tags=["Python"],
            evidence="attested",
            order=2,
        ),
        item(
            "pr1",
            "project",
            title="Inventory dashboard",
            bullets=["Visualised stock levels with React charts."],
            tags=["React"],
            evidence="related",
            order=3,
        ),
        item(
            "sk1",
            "skill",
            title="Python",
            tags=["Python"],
            evidence="attested",
            order=4,
        ),
    ]


def test_generation_copies_only_the_users_own_text_and_evidence() -> None:
    ws = workspace(base_items())
    requirements = [
        requirement("r1", "Strong React experience", evidence_ids=["e-react", "pr1"]),
        requirement(
            "r2",
            "Python services",
            kind="preferred",
            status="partial",
            evidence_ids=["e-python", "sk1"],
        ),
    ]

    generated = generate_tailored_resume(ws, requirements, length="one_page")

    allowed = {
        "Alex Doe",
        "Alex Doe · alex@example.com",
        "alex@example.com",
        "Senior Frontend Engineer · Acme · 2021-01 – 2024-01",
        "Backend Engineer · Beta · 2019-01 – 2021-01",
        "Inventory dashboard",
        "Python",
    }
    bullets = {bullet for source in base_items() for bullet in [source.title, *source.bullets]}
    allowed |= bullets
    assert generated.item_ids
    for section in generated.sections:
        assert section.claims
        for claim in section.claims:
            assert claim.text in allowed
            assert claim.evidenceIds
            assert len(claim.evidenceIds) == 1
    # Every rendered item has a matching evidence snapshot.
    assert {entry.itemId for entry in generated.evidence} == set(generated.item_ids)


def test_matched_required_evidence_ranks_before_preferred_partial() -> None:
    ws = workspace(base_items())
    requirements = [
        requirement(
            "r1",
            "Python services",
            kind="preferred",
            status="partial",
            evidence_ids=["e-python"],
        ),
        requirement("r2", "React", evidence_ids=["e-react"]),
    ]

    generated = generate_tailored_resume(ws, requirements)
    experience = next(section for section in generated.sections if section.key == "experience")
    # The matched required item is the first experience item even though the
    # partial preferred requirement appears first in the report.
    assert experience.claims[0].evidenceIds == ["e-react"]
    header_index = next(
        index for index, claim in enumerate(experience.claims) if claim.evidenceIds == ["e-python"]
    )
    assert header_index > 0


def test_different_jds_produce_visibly_different_selections_and_order() -> None:
    ws = workspace(base_items())
    react_first = [
        requirement("r1", "React frontend", evidence_ids=["e-react"]),
        requirement("r2", "Python backend", evidence_ids=["e-python"]),
    ]
    python_first = [
        requirement("r1", "Python backend", evidence_ids=["e-python"]),
        requirement("r2", "React frontend", evidence_ids=["e-react"]),
    ]

    one = generate_tailored_resume(ws, react_first, length="one_page")
    two = generate_tailored_resume(ws, python_first, length="one_page")

    one_experience = next(s for s in one.sections if s.key == "experience")
    two_experience = next(s for s in two.sections if s.key == "experience")
    assert one_experience.claims[0].evidenceIds == ["e-react"]
    assert two_experience.claims[0].evidenceIds == ["e-python"]
    assert [c.text for c in one_experience.claims] != [c.text for c in two_experience.claims]


def test_bullets_inside_an_item_are_ranked_by_target_terms() -> None:
    ws = workspace(base_items())
    requirements = [requirement("r1", "React migration", evidence_ids=["e-react"])]
    generated = generate_tailored_resume(ws, requirements, length="one_page")
    experience = next(section for section in generated.sections if section.key == "experience")
    react_bullet = "Led the React migration for the customer dashboard."
    text = [claim.text for claim in experience.claims]
    assert text.index(react_bullet) < text.index("Built the design system and internal tooling.")


def test_relevance_can_outrank_a_later_section_when_the_budget_is_tight() -> None:
    projects = [
        item(
            f"pr{index}",
            "project",
            title=f"Project {index}",
            bullets=[f"Shipped project {index}."],
            evidence="attested",
            order=index,
        )
        for index in range(30)
    ]
    skills = [
        item(
            f"sk{index}",
            "skill",
            title=f"Skill {index}",
            tags=[f"Skill {index}"],
            evidence="attested",
            order=100 + index,
        )
        for index in range(5)
    ]
    ws = workspace([*projects, *skills])
    requirements = [requirement("r1", "Skill", evidence_ids=[skill.id for skill in skills])]

    generated = generate_tailored_resume(ws, requirements, length="one_page")

    # The five matched skills make the cut even though the project section
    # comes first in the resume; the remaining budget goes to projects.
    assert set(skill.id for skill in skills).issubset(set(generated.item_ids))
    assert sum(1 for item_id in generated.item_ids if item_id.startswith("pr")) == 23


def test_claim_budgets_are_deterministic_and_never_exceeded() -> None:
    many = [
        item(
            f"e{index}",
            "experience",
            title=f"Role {index}",
            organization=f"Org {index}",
            bullets=[f"Built thing {index}.{bullet}." for bullet in range(6)],
            evidence="attested",
            order=index,
        )
        for index in range(20)
    ]
    ws = workspace(many)
    requirements = [requirement("r1", "Role", evidence_ids=[f"e{index}" for index in range(20)])]

    one = generate_tailored_resume(ws, requirements, length="one_page")
    two = generate_tailored_resume(ws, requirements, length="two_page")
    assert sum(len(section.claims) for section in one.sections) <= 28
    assert sum(len(section.claims) for section in two.sections) <= 44
    assert sum(len(section.claims) for section in two.sections) > sum(
        len(section.claims) for section in one.sections
    )
    # Deterministic: the same inputs give byte-identical claims.
    again = generate_tailored_resume(ws, requirements, length="one_page")
    assert [s.model_dump() for s in one.sections] == [s.model_dump() for s in again.sections]


def _resume_from(ws: WorkspaceResponse, evidence: list[ResumeEvidence]) -> ResumeResponse:
    # Build a minimal resume with one claim per evidence item, grouped by section.
    by_section: dict[str, list[ResumeEvidence]] = {}
    for entry in evidence:
        by_section.setdefault(entry.section, []).append(entry)

    sections = [
        ResumeSection(
            key=key,
            claims=[
                Claim(
                    text=entry.title,
                    evidenceIds=[entry.itemId],
                    confirmed=True,
                )
                for entry in entries
            ],
        )
        for key, entries in by_section.items()
    ]
    return ResumeResponse(
        id="r1",
        kind="tailored",
        targetId="t1",
        workspaceVersion=ws.version,
        stale=False,
        sections=sections,
        createdAt="2026-10-21T10:00:00.000Z",
        updatedAt="2026-10-21T10:00:00.000Z",
    )


def test_diff_detects_added_removed_and_edited_items_but_not_reordering() -> None:
    items = base_items()
    ws = workspace(items)
    evidence = [evidence_from_item(entry) for entry in items]
    resume = _resume_from(ws, evidence)

    edited_items = [entry.model_copy(deep=True) for entry in items]
    edited_items[1] = edited_items[1].model_copy(update={"title": "Staff Engineer"})
    edited_items[2] = edited_items[2].model_copy(update={"deletedAt": "2026-10-21T11:00:00Z"})
    edited_items.append(
        item("new", "project", title="New project", bullets=["Shipped it."], order=9)
    )
    changed = workspace(edited_items, version=4)

    diff = build_diff(resume, evidence, changed)
    assert diff.currentWorkspaceVersion == 4
    assert diff.workspaceVersion == 3
    assert diff.stale is True
    assert [entry.itemId for entry in diff.edited] == ["e-react"]
    assert [entry.itemId for entry in diff.removed] == ["e-python"]
    assert [entry.itemId for entry in diff.added] == ["new"]
    assert "experience" in diff.changedSections
    assert "project" in diff.changedSections

    reordered = [
        entry.model_copy(update={"order": 50 - index}) for index, entry in enumerate(items)
    ]
    reorder_diff = build_diff(resume, evidence, workspace(reordered, version=3))
    assert reorder_diff.edited == []
    assert reorder_diff.added == []
    assert reorder_diff.removed == []


def test_claim_grounding_rejects_new_metrics_and_employers() -> None:
    source = item(
        "e1",
        "experience",
        title="Engineer",
        organization="Acme",
        start="2021-01",
        end="2024-01",
        bullets=["Built the design system."],
        tags=["React"],
    )
    evidence = evidence_from_item(source)

    assert claim_is_grounded("Built the design system.", evidence)
    assert claim_is_grounded("Built the design system with React.", evidence)
    assert not claim_is_grounded("Increased revenue by 42%.", evidence)
    assert not claim_is_grounded("Built the design system with Kubernetes.", evidence)
