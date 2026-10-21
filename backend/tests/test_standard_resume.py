"""Standard-resume derivation tests (deterministic, AI-free; PRD SYN-1..3)."""

from app.schemas.workspace import (
    EvidenceState,
    WorkspaceItemResponse,
    WorkspaceResponse,
    WorkspaceSection,
)
from app.services.standard_resume import build_standard_resume


def item(
    item_id: str,
    section: WorkspaceSection,
    *,
    title: str = "Title",
    organization: str | None = None,
    start: str | None = None,
    end: str | None = None,
    bullets: list[str] | None = None,
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
        evidence=evidence,
        order=order,
        deletedAt=deleted_at,
    )


def workspace(items: list[WorkspaceItemResponse], version: int = 7) -> WorkspaceResponse:
    return WorkspaceResponse(version=version, items=items, updatedAt="2026-10-17T12:00:00.000Z")


def test_deleted_items_never_appear() -> None:
    resume = build_standard_resume(
        workspace(
            [
                item("keep", "skill", title="React"),
                item("gone", "skill", title="Ghost", deleted_at="2026-10-17T00:00:00Z"),
            ]
        )
    )
    evidence_ids = {
        cid for section in resume.sections for claim in section.claims for cid in claim.evidenceIds
    }
    assert evidence_ids == {"keep"}
    assert all("Ghost" not in claim.text for section in resume.sections for claim in section.claims)


def test_claims_reference_evidence_item_ids() -> None:
    resume = build_standard_resume(
        workspace([item("e1", "experience", title="Engineer", bullets=["Did a thing"])])
    )
    section = resume.sections[0]
    assert section.key == "experience"
    assert all(claim.evidenceIds == ["e1"] for claim in section.claims)
    assert [claim.text for claim in section.claims] == ["Engineer", "Did a thing"]


def test_confirmed_flag_tracks_evidence_state() -> None:
    resume = build_standard_resume(
        workspace(
            [
                item("v", "skill", title="Verified", evidence="verified"),
                item("a", "skill", title="Attested", evidence="attested", order=1),
                item("r", "skill", title="Related", evidence="related", order=2),
                item("m", "skill", title="Missing", evidence="missing", order=3),
            ]
        )
    )
    by_text = {claim.text: claim.confirmed for claim in resume.sections[0].claims}
    assert by_text == {
        "Verified": True,
        "Attested": True,
        "Related": False,
        "Missing": False,
    }


def test_sections_follow_canonical_order_and_report_version() -> None:
    resume = build_standard_resume(
        workspace(
            [item("p", "project", title="Proj"), item("s", "skill", title="Skill")], version=9
        )
    )
    assert [section.key for section in resume.sections] == ["project", "skill"]
    assert resume.workspaceVersion == 9
    assert resume.kind == "standard"
    assert resume.stale is False
