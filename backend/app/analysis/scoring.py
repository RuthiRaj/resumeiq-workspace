"""Factor computation for the job-match score (port of ``scoring.ts``).

Each factor maps to a slice of the posting's requirements. Requirement status
converts to a factor value with matched = 1, partially matched = 0.5,
unsupported = 0. When a posting says nothing about an area (or the reading
finds no requirements for it), the factor falls back to how deep the workspace
is in that area, and if there is nothing at all to compare the factor is
dropped and the remaining weights are renormalised -- so the number on screen
always stands for something the methodology text can explain (PRD §6.5).
"""

from __future__ import annotations

from app.analysis.matching import EvidenceIndex
from app.analysis.numeric import js_round, round_fixed
from app.analysis.weights import mean_evidence_quality
from app.schemas.analysis import SCORE_WEIGHTS, Requirement, ScoreFactor

_SECTION_LABELS = {
    "required_skills": "required skill",
    "preferred_skills": "preferred skill",
    "experience": "experience",
    "education": "education",
    "projects": "project & achievement",
}


def status_value(status: str) -> float:
    """0-1 value for a single requirement status."""
    if status == "matched":
        return 1.0
    if status == "partial":
        return 0.5
    return 0.0


def _mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _requirements_for(requirements: list[Requirement], key: str) -> list[Requirement]:
    if key == "required_skills":
        return [r for r in requirements if r.kind == "required" and not r.pattern]
    if key == "preferred_skills":
        return [r for r in requirements if r.kind == "preferred" and not r.pattern]
    if key == "experience":
        return [r for r in requirements if r.pattern in ("experience", "seniority")]
    if key == "education":
        return [r for r in requirements if r.pattern == "education"]
    return []


def _base_weight(key: str) -> tuple[str, float]:
    for entry in SCORE_WEIGHTS:
        if entry["key"] == key:
            return str(entry["name"]), float(entry["weight"])  # type: ignore[arg-type]
    return key, 0.0


def _depth_value(
    index: EvidenceIndex, sections: list[str], scale_by_count: bool
) -> tuple[float, int, float]:
    items = [item for item in index.items if item.section in sections]
    quality = mean_evidence_quality([item.evidence for item in items])
    if scale_by_count:
        breadth = min(1.0, len(items) / 2)
    else:
        breadth = 1.0 if items else 0.0
    return js_round(quality * breadth * 100), len(items), quality


def _factor_detail(key: str, relevant: list[Requirement]) -> str:
    matched = sum(1 for r in relevant if r.status == "matched")
    partial = sum(1 for r in relevant if r.status == "partial")
    unsupported = len(relevant) - matched - partial
    label = _SECTION_LABELS[key]
    return (
        f"{matched} matched, {partial} partially matched, {unsupported} unsupported "
        f"of {len(relevant)} {label} requirement(s)."
    )


def _build_skill_factor(key: str, requirements: list[Requirement]) -> tuple[bool, float, str]:
    relevant = _requirements_for(requirements, key)
    if not relevant:
        return False, 0.0, ""
    value = js_round(_mean([status_value(r.status) for r in relevant]) * 100)
    return True, value, _factor_detail(key, relevant)


def _build_mapped_factor(
    key: str, requirements: list[Requirement], fallback_value: float, fallback_detail: str
) -> tuple[bool, float, str]:
    relevant = _requirements_for(requirements, key)
    if not relevant:
        # Nothing in the posting covers this area: say so, and fall back to depth.
        return True, fallback_value, fallback_detail
    value = js_round(_mean([status_value(r.status) for r in relevant]) * 100)
    return True, value, _factor_detail(key, relevant)


def compute_factors(requirements: list[Requirement], index: EvidenceIndex) -> list[ScoreFactor]:
    """Weighted factor breakdown with weights renormalised to sum to 1."""
    drafts: list[tuple[str, bool, float, str]] = []

    applicable, value, detail = _build_skill_factor("required_skills", requirements)
    drafts.append(("required_skills", applicable, value, detail))

    applicable, value, detail = _build_skill_factor("preferred_skills", requirements)
    drafts.append(("preferred_skills", applicable, value, detail))

    exp_value, exp_count, _ = _depth_value(index, ["experience", "internship"], True)
    exp_detail = (
        "This posting doesn't set an experience bar, and your workspace has no experience "
        "or internship items yet."
        if exp_count == 0
        else "This posting doesn't set an experience bar, so this reflects your workspace: "
        f"{exp_count} experience/internship item(s)."
    )
    applicable, value, detail = _build_mapped_factor(
        "experience", requirements, exp_value, exp_detail
    )
    drafts.append(("experience", applicable, value, detail))

    edu_value, edu_count, _ = _depth_value(index, ["education"], False)
    edu_detail = (
        "This posting doesn't require a qualification, and your workspace has "
        "no education items yet."
        if edu_count == 0
        else "This posting doesn't require a qualification, so this reflects your workspace: "
        f"{edu_count} education item(s)."
    )
    applicable, value, detail = _build_mapped_factor(
        "education", requirements, edu_value, edu_detail
    )
    drafts.append(("education", applicable, value, detail))

    proj_value, proj_count, _ = _depth_value(index, ["project", "achievement"], True)
    proj_detail = (
        "No project or achievement items in your workspace yet."
        if proj_count == 0
        else f"Your workspace has {proj_count} project/achievement item(s); the value reflects "
        "how well they are evidenced."
    )
    drafts.append(("projects", proj_count > 0, proj_value, proj_detail))

    applicable_drafts = [draft for draft in drafts if draft[1]]
    total_weight = sum(_base_weight(draft[0])[1] for draft in applicable_drafts)
    if total_weight == 0:
        return []

    factors: list[ScoreFactor] = []
    for key, _applicable, value, detail in applicable_drafts:
        name, weight = _base_weight(key)
        factors.append(
            ScoreFactor(
                name=name,
                weight=round_fixed(weight / total_weight if total_weight else 0.0, 4),
                value=max(0, min(100, value)),
                detail=detail,
            )
        )
    return factors


def weighted_score(factors: list[ScoreFactor]) -> float:
    """Weighted score 0-100 from a factor breakdown (weights already renormalised)."""
    if not factors:
        return 0
    total_weight = sum(factor.weight for factor in factors)
    if total_weight == 0:
        return 0
    weighted = sum(factor.weight * factor.value for factor in factors)
    return max(0, min(100, js_round(weighted / total_weight)))
