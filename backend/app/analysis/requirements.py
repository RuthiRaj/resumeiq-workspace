"""Requirement extraction (port of the extraction half of ``matching.ts``).

Everything here is deterministic: a requirement is either mentioned by the job
description you pasted or by a taxonomy entry it contains. Requirement ids are
derived from the matched skill/pattern, so two identical postings produce
identical ids (PRD §6.4 JD-2, §6.4 JD-5).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.analysis.taxonomy import SKILL_TAXONOMY, find_skill_by_term, mentions_skill

RequirementPattern = str  # "experience" | "education" | "seniority"


@dataclass
class RequirementDraft:
    """A requirement before it is classified against the workspace."""

    id: str
    text: str
    kind: str  # "required" | "preferred"
    #: Taxonomy key, for skill requirements.
    skillKey: str | None = None
    #: Non-skill requirement shapes the engine recognises.
    pattern: RequirementPattern | None = None
    #: Years demanded by an ``experience`` requirement.
    years: int | None = None
    #: Term matched by a ``seniority`` requirement (verbatim from the posting).
    term: str | None = None
    #: Skills the *experience* sentence names (used to keep months in-domain).
    skillKeys: list[str] = field(default_factory=list)


_NICE_TO_HAVE = re.compile(
    r"(nice to have|nice-to-have|preferred|preferably|bonus|a plus|would be great|"
    r"desirable|advantageous|optional|not required|plus if)",
    re.IGNORECASE,
)
_YEARS = re.compile(r"(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)?\s*\d{0,2}\s*years?", re.IGNORECASE)
_EDUCATION = re.compile(
    r"(bachelor|b\.?\s?sc|bsc|b\.?\s?eng|beng|b\.?\s?tech|btech|master|m\.?\s?sc|msc|"
    r"m\.?\s?eng|degree|phd|doctorate|diploma)",
    re.IGNORECASE,
)
_SENIORITY = re.compile(
    r"(\bsenior\b|\bstaff\b|\bprincipal\b|\blead\b|\bjunior\b|\bentry[- ]level\b|"
    r"\bmid[- ]level\b|\bintern\b|\bseniority\b)",
    re.IGNORECASE,
)
_SPLIT = re.compile(r"\r?\n|[•·]|;|\.\s+")
_LEADING = re.compile(r"^[\s\-*•·–—>]+")
_WHITESPACE = re.compile(r"\s+")


def split_lines(job_description: str) -> list[str]:
    """Split a posting into candidate requirement lines.

    Splits on line breaks, bullets, semicolons and sentence ends. Requiring
    whitespace after the dot keeps tokens like "Node.js" intact.
    """
    lines = []
    for raw in _SPLIT.split(job_description):
        line = _LEADING.sub("", raw).strip()
        if len(line) > 1:
            lines.append(line)
    return lines


def truncate(text: str, maximum: int = 160) -> str:
    """Collapse whitespace and clip to ``maximum`` characters with an ellipsis."""
    clean = _WHITESPACE.sub(" ", text).strip()
    if len(clean) <= maximum:
        return clean
    return clean[: maximum - 1] + "…"


def extract_requirements(
    *,
    job_description: str,
    required_skills: list[str] | None = None,
) -> list[RequirementDraft]:
    """Extract must-haves, nice-to-haves, seniority, experience and education.

    Hard requirements come first, then preferences; order is stable within each
    group so the report reads the same way every time.
    """
    lines = split_lines(job_description)
    drafts: dict[str, RequirementDraft] = {}

    # 1. Explicit required skills the user typed into the intake form (JD-1).
    for raw in required_skills or []:
        term = raw.strip()
        if not term:
            continue
        skill = find_skill_by_term(term)
        key = skill.key if skill else term.lower()
        drafts[f"req-skill-{key}"] = RequirementDraft(
            id=f"req-skill-{key}",
            text=skill.label if skill else truncate(term, 60),
            kind="required",
            skillKey=skill.key if skill else None,
        )

    # 2. Taxonomy skills mentioned anywhere in the posting. A skill that only
    #    appears in a "nice to have" sentence is a preference, not a gate.
    for line in lines:
        kind = "preferred" if _NICE_TO_HAVE.search(line) else "required"
        for skill in SKILL_TAXONOMY:
            if not mentions_skill(line, skill):
                continue
            req_id = f"req-skill-{skill.key}"
            existing = drafts.get(req_id)
            if existing is not None:
                # The user's explicit list wins; otherwise a hard mention
                # upgrades a preference.
                if existing.kind == "preferred" and kind == "required":
                    existing.kind = "required"
                continue
            drafts[req_id] = RequirementDraft(
                id=req_id, text=skill.label, kind=kind, skillKey=skill.key
            )

    # 3. Experience, education and seniority are single-slot requirements: the
    #    first line that mentions them is the one quoted back to the user.
    experience_line = next((line for line in lines if _YEARS.search(line)), None)
    if experience_line is not None:
        match = _YEARS.search(experience_line)
        years = int(match.group(1)) if match and match.group(1) else 0
        drafts["req-experience"] = RequirementDraft(
            id="req-experience",
            text=truncate(experience_line),
            kind="required",
            pattern="experience",
            years=years or None,
            skillKeys=[
                skill.key for skill in SKILL_TAXONOMY if mentions_skill(experience_line, skill)
            ],
        )

    education_line = next((line for line in lines if _EDUCATION.search(line)), None)
    if education_line is not None:
        drafts["req-education"] = RequirementDraft(
            id="req-education",
            text=truncate(education_line),
            kind="required",
            pattern="education",
        )

    seniority_line = next((line for line in lines if _SENIORITY.search(line)), None)
    if seniority_line is not None:
        match = _SENIORITY.search(seniority_line)
        seniority_term = match.group(1).lower() if match and match.group(1) else None
        drafts["req-seniority"] = RequirementDraft(
            id="req-seniority",
            text=truncate(seniority_line),
            kind="required",
            pattern="seniority",
            term=seniority_term,
        )

    # Stable sort: required before preferred, insertion order within a group.
    return sorted(drafts.values(), key=lambda draft: 0 if draft.kind == "required" else 1)
