"""Full report assembly (port of ``report.ts``, PRD §6.6).

Everything is derived, never invented: the text of a requirement comes from the
posting you pasted, the label of a skill comes from the taxonomy, and every
claim of a match points at a workspace item. Given the same target, workspace
version and timestamp this function is pure, so reports are byte-identical run
to run (PRD §6.4 JD-5).
"""

from __future__ import annotations

from app.analysis.ats import compute_ats_report
from app.analysis.matching import (
    EvidenceIndex,
    build_evidence_index,
    match_requirements,
)
from app.analysis.requirements import extract_requirements
from app.analysis.scoring import compute_factors, weighted_score
from app.analysis.taxonomy import SKILL_TAXONOMY
from app.analysis.weights import is_supporting_evidence
from app.schemas.analysis import (
    DEFAULT_METHODOLOGY,
    AnalysisReport,
    ContentDecision,
    ContentReport,
    JobTarget,
    Requirement,
    RoadmapStep,
    SectionToImprove,
    SkillAnalysis,
    SkillFinding,
    SkillGap,
)
from app.schemas.workspace import WorkspaceItemResponse, WorkspaceSection

#: Sections a skill gap would most likely be closed in.
_GAP_SECTION: dict[str, WorkspaceSection] = {
    "experience": "experience",
    "seniority": "experience",
    "education": "education",
}

SECTION_PRIORITY: tuple[WorkspaceSection, ...] = (
    "experience",
    "education",
    "project",
    "internship",
    "skill",
    "certificate",
    "course",
    "achievement",
    "publication",
    "training",
    "personal",
    "extracurricular",
)

MAX_ROADMAP_STEPS = 6
MAX_SECTION_FIXES = 4


def _sorted_by_name(findings: list[SkillFinding]) -> list[SkillFinding]:
    """Name order that matches the reference engine's ``localeCompare``."""
    return sorted(findings, key=lambda finding: finding.name.lower())


def grouped_skills(index: EvidenceIndex, sections: list[WorkspaceSection]) -> list[SkillFinding]:
    by_name: dict[str, list[str]] = {}
    for item in index.items:
        if item.section not in sections:
            continue
        key = item.title.strip()
        if not key:
            continue
        by_name.setdefault(key, []).append(item.id)
    return _sorted_by_name(
        [SkillFinding(name=name, itemIds=item_ids) for name, item_ids in by_name.items()]
    )


def build_skills(index: EvidenceIndex, requirements: list[Requirement]) -> SkillAnalysis:
    documented = grouped_skills(index, ["skill"])

    # Skills demonstrated by something other than a bare skill listing.
    demonstration_sections = (
        "project",
        "experience",
        "internship",
        "certificate",
        "course",
        "achievement",
        "publication",
        "training",
    )
    demonstrated: list[SkillFinding] = []
    for skill in SKILL_TAXONOMY:
        ids = [
            item_id
            for item_id in index.items_for_skill.get(skill.key, [])
            if (
                (item := next((c for c in index.items if c.id == item_id), None)) is not None
                and item.section in demonstration_sections
                and is_supporting_evidence(item.evidence)
            )
        ]
        if ids:
            demonstrated.append(SkillFinding(name=skill.label, itemIds=ids[:6]))
    demonstrated = _sorted_by_name(demonstrated)

    not_evidenced = [
        SkillGap(name=requirement.text, reason=requirement.explanation)
        for requirement in requirements
        if requirement.status == "unsupported" and requirement.gapType == "not_evidenced"
    ]

    # What to develop: real gaps first (a genuine miss is the most valuable to
    # close), then undocumented-but-adjacent, then requirements only partly
    # backed by evidence.
    def rank(requirement: Requirement) -> int:
        if requirement.status == "unsupported":
            return 0 if requirement.gapType == "genuinely_missing" else 1
        return 2

    ranked = sorted(
        (
            (rank(requirement), requirement)
            for requirement in requirements
            if requirement.status != "matched"
        ),
        key=lambda entry: entry[0],
    )
    to_develop = [
        SkillGap(name=requirement.text, reason=requirement.explanation)
        for _, requirement in ranked[:8]
    ]

    return SkillAnalysis(
        documented=documented,
        demonstrated=demonstrated,
        notEvidenced=not_evidenced,
        toDevelop=to_develop,
    )


def build_content(
    index: EvidenceIndex, requirements: list[Requirement]
) -> tuple[list[ContentDecision], list[ContentDecision], ContentReport]:
    uses: dict[str, list[str]] = {}
    for requirement in requirements:
        if requirement.status == "unsupported":
            continue
        for item_id in requirement.evidenceIds:
            uses.setdefault(item_id, []).append(requirement.text)

    included: list[ContentDecision] = []
    excluded: list[ContentDecision] = []
    for item in index.items:
        used_for = uses.get(item.id)
        if used_for:
            labels = list(dict.fromkeys(used_for))[:3]
            more = " and more" if len(used_for) > len(labels) else ""
            included.append(
                ContentDecision(
                    itemId=item.id,
                    reason=f"Evidence for {', '.join(labels)}{more}.",
                )
            )
            continue
        if item.evidence == "missing":
            excluded.append(
                ContentDecision(
                    itemId=item.id,
                    reason=(
                        "Marked Missing — there's nothing backing it yet, so it can't support "
                        "a claim in this resume."
                    ),
                )
            )
            continue
        if item.section == "skill":
            excluded.append(
                ContentDecision(
                    itemId=item.id,
                    reason="No requirement in this posting mentions this skill.",
                )
            )
            continue
        excluded.append(
            ContentDecision(
                itemId=item.id,
                reason="Not used as evidence for any requirement in this posting.",
            )
        )

    fixes: dict[WorkspaceSection, list[str]] = {}
    for requirement in requirements:
        if requirement.status == "matched":
            continue
        section: WorkspaceSection = _GAP_SECTION.get(requirement.pattern or "") or (
            "skill" if requirement.gapType == "not_evidenced" else "project"
        )
        status_text = (
            "evidence still needs verifying"
            if requirement.status == "partial"
            else "not evidenced yet"
        )
        fixes.setdefault(section, []).append(f"{requirement.text} — {status_text}.")

    weak_by_section: dict[WorkspaceSection, int] = {}
    for item in index.items:
        if item.evidence in ("verified", "attested"):
            continue
        weak_by_section[item.section] = weak_by_section.get(item.section, 0) + 1

    sections_to_improve: list[SectionToImprove] = []
    for section in SECTION_PRIORITY:
        if len(sections_to_improve) >= MAX_SECTION_FIXES:
            break
        gaps = fixes.get(section, [])
        weak = weak_by_section.get(section, 0)
        if not gaps and weak == 0:
            continue
        reasons: list[str] = []
        if gaps:
            reasons.append(
                f"{len(gaps)} {section.replace('_', ' ')} requirement(s) from this job aren't "
                f"backed yet: {', '.join(entry.split(' — ')[0] for entry in gaps[:3])}."
            )
        if weak > 0:
            reasons.append(
                f"{weak} {section} item(s) are marked related or missing, so they can't support "
                "a claim yet."
            )
        sections_to_improve.append(SectionToImprove(section=section, reason=" ".join(reasons)))

    content = ContentReport(
        supportedRequirementIds=[
            requirement.id for requirement in requirements if requirement.status != "unsupported"
        ],
        needsEvidenceRequirementIds=[
            requirement.id for requirement in requirements if requirement.status == "unsupported"
        ],
        sectionsToImprove=sections_to_improve,
    )
    return included, excluded, content


def unfilled_step(requirement: Requirement) -> tuple[str, str]:
    """One roadmap action for a requirement that isn't fully covered.

    The action depends on *what kind* of requirement it is: you can attach a
    certificate for a skill, but a "Senior" title or a degree is evidenced
    differently -- the roadmap never asks for proof that couldn't exist.
    """
    quoted = f"The posting asks: “{requirement.text}”."
    if requirement.status == "unsupported":
        adjacent = requirement.gapType == "not_evidenced"
        if requirement.pattern == "experience":
            return (
                (
                    "Add month-precision dates to your roles so the length can be counted"
                    if adjacent
                    else "Add your work history — roles, months and what you owned"
                ),
                requirement.explanation,
            )
        if requirement.pattern == "education":
            return (
                (
                    "Record your courses or training as education entries"
                    if adjacent
                    else "Add your education, courses or training"
                ),
                requirement.explanation,
            )
        if requirement.pattern == "seniority":
            return (
                "Show the level you work at through scope and outcomes",
                f"{requirement.explanation} {quoted}",
            )
        return (
            (
                f"Document where you used {requirement.text}"
                if adjacent
                else f"Learn {requirement.text} and build a small project that proves it"
            ),
            requirement.explanation,
        )

    if requirement.pattern == "experience":
        return (
            "Record any earlier roles you haven't added yet, and show how the months you have "
            "overlap this one",
            f"{requirement.explanation} {quoted}",
        )
    if requirement.pattern == "seniority":
        return (
            "Make the level visible in your role titles and the scope you owned",
            f"{requirement.explanation} {quoted}",
        )
    if requirement.pattern == "education":
        return (
            "Record the qualification you hold, or the one you're studying for",
            f"{requirement.explanation} {quoted}",
        )
    return (
        f"Attach a certificate or link that backs up {requirement.text}",
        requirement.explanation,
    )


def build_roadmap(
    index: EvidenceIndex, requirements: list[Requirement], target: JobTarget
) -> list[RoadmapStep]:
    role = f"{target.role} at {target.company}" if target.company else target.role
    steps: list[tuple[str, str]] = []

    required = [r for r in requirements if r.kind == "required"]
    genuinely_missing = [
        r for r in required if r.status == "unsupported" and r.gapType == "genuinely_missing"
    ]
    not_evidenced = [
        r for r in required if r.status == "unsupported" and r.gapType == "not_evidenced"
    ]
    partial = [r for r in required if r.status == "partial"]
    preferred_gaps = [r for r in requirements if r.kind == "preferred" and r.status != "matched"]

    for requirement in genuinely_missing:
        steps.append(unfilled_step(requirement))
    for requirement in not_evidenced:
        steps.append(unfilled_step(requirement))
    for requirement in partial:
        steps.append(unfilled_step(requirement))

    # Weakly-evidenced items in the sections this job cares about.
    weak_items = [
        item
        for item in index.items
        if item.evidence in ("related", "missing")
        and item.section in ("experience", "project", "education")
    ]
    if weak_items:
        titles = " and ".join(item.title for item in weak_items[:2])
        steps.append(
            (
                f"Verify {titles}",
                f"{len(weak_items)} item(s) in the sections this posting cares about are marked "
                f"related or missing, so they weaken the resume for {role}.",
            )
        )

    for requirement in preferred_gaps:
        steps.append(
            (
                f"Optional: strengthen {requirement.text}",
                f"Listed as a nice-to-have for {role}. {requirement.explanation}",
            )
        )

    no_detail = next(
        (
            item
            for item in index.items
            if item.section in ("experience", "project") and not item.bullets
        ),
        None,
    )
    if no_detail is not None:
        steps.append(
            (
                f"Add one detail line to {no_detail.title}",
                "Job-specific reports read better when every role and project says what changed. "
                "Use numbers you can defend.",
            )
        )

    return [
        RoadmapStep(priority=index + 1, action=action, reason=reason)
        for index, (action, reason) in enumerate(steps[:MAX_ROADMAP_STEPS])
    ]


def assemble_report(
    *,
    target: JobTarget,
    items: list[WorkspaceItemResponse],
    workspace_version: int,
    workspace_updated_at: str,
    generated_at: str,
    requirements: list[Requirement],
    ai_used: bool = False,
) -> AnalysisReport:
    """Assemble the full report from already-classified requirements.

    Split out from :func:`build_analysis_report` so B4's optional AI enrichment
    can refine the requirement drafts (and gap explanations) *without* touching
    the deterministic scoring path: the same requirements always produce the same
    factors, skills, content, roadmap and ATS output.
    """
    index = build_evidence_index(items, workspace_updated_at)
    factors = compute_factors(requirements, index)
    skills = build_skills(index, requirements)
    included, excluded, content = build_content(index, requirements)
    roadmap = build_roadmap(index, requirements, target)
    ats = compute_ats_report(index.items, requirements)

    return AnalysisReport(
        targetId=target.id,
        workspaceVersion=workspace_version,
        generatedAt=generated_at,
        score=weighted_score(factors),
        factors=factors,
        methodology=DEFAULT_METHODOLOGY,
        requirements=requirements,
        skills=skills,
        included=included,
        excluded=excluded,
        content=content,
        roadmap=roadmap,
        ats=ats,
        aiUsed=ai_used,
    )


def build_analysis_report(
    *,
    target: JobTarget,
    items: list[WorkspaceItemResponse],
    workspace_version: int,
    workspace_updated_at: str,
    generated_at: str,
    ai_used: bool = False,
) -> AnalysisReport:
    index = build_evidence_index(items, workspace_updated_at)
    drafts = extract_requirements(
        job_description=target.jobDescription,
        required_skills=target.requiredSkills,
    )
    requirements = match_requirements(drafts, index).requirements

    return assemble_report(
        target=target,
        items=items,
        workspace_version=workspace_version,
        workspace_updated_at=workspace_updated_at,
        generated_at=generated_at,
        requirements=requirements,
        ai_used=ai_used,
    )
