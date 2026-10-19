"""Requirement classification and evidence matching (port of ``matching.ts``).

This is the *deterministic* half of the analysis: no language model is
involved. Every match traces to concrete workspace items, so the same inputs
always produce the same report (PRD §6.4 JD-5).

Classification model (docs/DECISIONS.md ADR-021):

1. ``matched``     -- a workspace item mentions the requirement *and* its own
   evidence state is verified or user-attested. A concrete form of a general
   skill (PostgreSQL for SQL) counts as the skill itself; the reverse never does.
2. ``partial``     -- the requirement is mentioned, but only by items whose
   evidence is related or missing, so it can't be claimed yet.
3. ``unsupported`` -- no mention at all. Gap type:
   ``not_evidenced`` (an adjacent skill or a transferable family is present) or
   ``genuinely_missing`` (nothing nearby).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.analysis.requirements import RequirementDraft
from app.analysis.taxonomy import (
    SKILL_TAXONOMY,
    SkillEntry,
    implementer_skills,
    mentions_skill,
    related_skills,
    same_family_skills,
)
from app.analysis.weights import is_supporting_evidence
from app.schemas.analysis import Requirement
from app.schemas.workspace import EvidenceState, WorkspaceItemResponse

#: Families where practitioners routinely pick up the sibling tool.
TRANSFERABLE_FAMILIES = frozenset(
    ["infrastructure", "cloud", "database", "ml", "data", "tooling", "quality", "process"]
)

MAX_EVIDENCE_LINKS = 6


@dataclass
class EvidenceIndex:
    """The workspace, indexed for matching. Everything is keyed by item id so
    evidence links in the report always resolve back to a workspace item."""

    items: list[WorkspaceItemResponse]
    #: Searchable text per item id.
    text: dict[str, str] = field(default_factory=dict)
    #: Skills each item mentions.
    skills: dict[str, set[str]] = field(default_factory=dict)
    #: Item ids mentioning each skill key.
    items_for_skill: dict[str, list[str]] = field(default_factory=dict)
    #: Item ids per section.
    by_section: dict[str, list[str]] = field(default_factory=dict)
    #: Stable "now" for date maths: the newest date the workspace knows about.
    reference_date: str = ""


def active_items(items: list[WorkspaceItemResponse]) -> list[WorkspaceItemResponse]:
    return [item for item in items if not item.deletedAt]


def build_evidence_index(items: list[WorkspaceItemResponse], updated_at: str) -> EvidenceIndex:
    active = active_items(items)
    index = EvidenceIndex(items=active, reference_date=updated_at)

    for item in active:
        haystack = " ".join(
            [
                item.title,
                item.organization or "",
                item.location or "",
                *item.tags,
                *item.bullets,
            ]
        ).lower()
        index.text[item.id] = haystack
        index.by_section.setdefault(item.section, []).append(item.id)

        found: set[str] = set()
        for skill in SKILL_TAXONOMY:
            if mentions_skill(haystack, skill):
                found.add(skill.key)
                index.items_for_skill.setdefault(skill.key, []).append(item.id)
        index.skills[item.id] = found

    return index


def item_by_id(index: EvidenceIndex, item_id: str) -> WorkspaceItemResponse | None:
    return next((item for item in index.items if item.id == item_id), None)


def _evidence_state_of(index: EvidenceIndex, item_id: str) -> EvidenceState:
    item = item_by_id(index, item_id)
    return item.evidence if item is not None else "missing"


def _supporting_ids(index: EvidenceIndex, skill_key: str) -> list[str]:
    """Item ids mentioning ``skill_key`` whose own evidence can support a claim."""
    return [
        item_id
        for item_id in index.items_for_skill.get(skill_key, [])
        if is_supporting_evidence(_evidence_state_of(index, item_id))
    ]


def _mentioned_ids(index: EvidenceIndex, skill_key: str) -> list[str]:
    """Item ids mentioning ``skill_key`` at all (any evidence state)."""
    return index.items_for_skill.get(skill_key, [])


def _dedupe(values: list[str]) -> list[str]:
    """``[...new Set(values)]``: unique, first occurrence order preserved."""
    return list(dict.fromkeys(values))


# --- Experience / education helpers ----------------------------------------

_YM_RE = re.compile(r"^(\d{4})-(\d{2})")


def _parse_ym(value: str) -> tuple[int, int] | None:
    match = _YM_RE.match(value)
    if match is None:
        return None
    return int(match.group(1)), int(match.group(2))


def _months_between(start_ym: str, end_ym: str) -> int:
    start = _parse_ym(start_ym)
    end = _parse_ym(end_ym)
    if start is None or end is None or end < start:
        return 0
    return (end[0] - start[0]) * 12 + (end[1] - start[1]) + 1


def _total_experience_months(index: EvidenceIndex) -> int:
    reference = index.reference_date[:7]
    total = 0
    for item in index.items:
        if item.section not in ("experience", "internship"):
            continue
        if not item.startDate:
            continue
        start = item.startDate[:7]
        end = item.endDate[:7] if item.endDate else reference
        total += _months_between(start, end)
    return total


@dataclass(frozen=True)
class _DegreeLevel:
    level: int
    label: str
    pattern: re.Pattern[str]


#: Qualification levels, lowest first.
DEGREE_LEVELS: tuple[_DegreeLevel, ...] = (
    _DegreeLevel(3, "doctorate", re.compile(r"(phd|ph\.\s?d|doctorate|doctoral)", re.IGNORECASE)),
    _DegreeLevel(
        2,
        "master's",
        re.compile(
            r"(master|m\.?\s?sc|msc|m\.?\s?eng|meng|mba|m\.?\s?tech|mtech|postgraduate)",
            re.IGNORECASE,
        ),
    ),
    _DegreeLevel(
        1,
        "bachelor's",
        re.compile(
            r"(bachelor|b\.?\s?sc|bsc|b\.?\s?eng|beng|b\.?\s?tech|btech|undergraduate)",
            re.IGNORECASE,
        ),
    ),
)


def degree_level(text: str) -> int:
    """Highest qualification level a piece of text names (0 when it names none)."""
    for entry in DEGREE_LEVELS:
        if entry.pattern.search(text):
            return entry.level
    return 0


def _degree_label(level: int) -> str:
    return next((entry.label for entry in DEGREE_LEVELS if entry.level == level), "qualification")


def _items_in(index: EvidenceIndex, section: str) -> list[WorkspaceItemResponse]:
    ids = index.by_section.get(section, [])
    return [item for item in index.items if item.id in ids]


def _skill_by_key(key: str) -> SkillEntry | None:
    return next((skill for skill in SKILL_TAXONOMY if skill.key == key), None)


def _skill_label(key: str) -> str:
    skill = _skill_by_key(key)
    return skill.label if skill is not None else key


# --- Classifiers ------------------------------------------------------------


def _classify_skill(draft: RequirementDraft, index: EvidenceIndex) -> Requirement:
    skill = _skill_by_key(draft.skillKey) if draft.skillKey else None
    if skill is None:
        # A required skill the user typed that isn't in the taxonomy: match it
        # as plain text against the workspace.
        needle = draft.text.lower()
        hits = [item.id for item in index.items if needle in (index.text.get(item.id) or "")]
        supporting = [
            item_id
            for item_id in hits
            if is_supporting_evidence(_evidence_state_of(index, item_id))
        ]
        if supporting:
            return Requirement(
                id=draft.id,
                text=draft.text,
                kind=draft.kind,
                pattern=draft.pattern,
                status="matched",
                gapType=None,
                evidenceIds=supporting[:MAX_EVIDENCE_LINKS],
                explanation=f"Your workspace mentions “{draft.text}” with attached evidence.",
            )
        if hits:
            return Requirement(
                id=draft.id,
                text=draft.text,
                kind=draft.kind,
                pattern=draft.pattern,
                status="partial",
                gapType=None,
                evidenceIds=hits[:MAX_EVIDENCE_LINKS],
                explanation=(
                    f"“{draft.text}” is mentioned, but only with related or missing evidence."
                ),
            )
        return Requirement(
            id=draft.id,
            text=draft.text,
            kind=draft.kind,
            pattern=draft.pattern,
            status="unsupported",
            gapType="genuinely_missing",
            evidenceIds=[],
            explanation=f"Nothing in your workspace mentions “{draft.text}”.",
        )

    supporting = _supporting_ids(index, skill.key)
    via_implementers = [
        (implementer, ids)
        for implementer in implementer_skills(skill.key)
        if (ids := _supporting_ids(index, implementer.key))
    ]
    implemented_ids = [
        item_id
        for item_id in _dedupe([item_id for _, ids in via_implementers for item_id in ids])
        if item_id not in supporting
    ]

    if supporting:
        count = len(supporting)
        return Requirement(
            id=draft.id,
            text=skill.label,
            kind=draft.kind,
            pattern=draft.pattern,
            status="matched",
            gapType=None,
            evidenceIds=supporting[:MAX_EVIDENCE_LINKS],
            explanation=(
                f"{skill.label} appears with attached evidence in {count} workspace "
                f"{'item' if count == 1 else 'items'}."
            ),
        )

    # A concrete form of a general skill counts as that skill (PostgreSQL is a
    # SQL engine). One-directional -- see the taxonomy docblock.
    if implemented_ids:
        names = ", ".join(implementer.label for implementer, _ in via_implementers)
        return Requirement(
            id=draft.id,
            text=skill.label,
            kind=draft.kind,
            pattern=draft.pattern,
            status="matched",
            gapType=None,
            evidenceIds=implemented_ids[:MAX_EVIDENCE_LINKS],
            explanation=(
                f"Your {names} evidence covers {skill.label}: {names} "
                f"{'is a' if len(via_implementers) == 1 else 'are'} {skill.label} implementation."
            ),
        )

    mentioned = _dedupe(
        [
            *_mentioned_ids(index, skill.key),
            *[item_id for _, ids in via_implementers for item_id in ids],
        ]
    )
    if mentioned:
        return Requirement(
            id=draft.id,
            text=skill.label,
            kind=draft.kind,
            pattern=draft.pattern,
            status="partial",
            gapType=None,
            evidenceIds=mentioned[:MAX_EVIDENCE_LINKS],
            explanation=(
                f"{skill.label} is mentioned, but the evidence on those items is related or "
                "missing — it can't be claimed until you verify it."
            ),
        )

    # Adjacent skills are related, never equivalent (PRD §4.3): the requirement
    # stays unsupported, but it is "not evidenced yet" rather than missing.
    for related in related_skills(skill.key):
        adjacent = _mentioned_ids(index, related.key)
        if adjacent:
            return Requirement(
                id=draft.id,
                text=skill.label,
                kind=draft.kind,
                pattern=draft.pattern,
                status="unsupported",
                gapType="not_evidenced",
                evidenceIds=adjacent[:MAX_EVIDENCE_LINKS],
                explanation=(
                    f"No {skill.label} found. You evidence {related.label}, which is adjacent "
                    f"but not equivalent — {skill.label} may just be undocumented."
                ),
            )

    if skill.family in TRANSFERABLE_FAMILIES:
        for sibling in same_family_skills(skill.key):
            nearby = _mentioned_ids(index, sibling.key)
            if nearby:
                return Requirement(
                    id=draft.id,
                    text=skill.label,
                    kind=draft.kind,
                    pattern=draft.pattern,
                    status="unsupported",
                    gapType="not_evidenced",
                    evidenceIds=nearby[:MAX_EVIDENCE_LINKS],
                    explanation=(
                        f"No {skill.label} found, but you work with other {skill.family} "
                        f"tooling ({sibling.label}) — this may just be undocumented."
                    ),
                )

    return Requirement(
        id=draft.id,
        text=skill.label,
        kind=draft.kind,
        pattern=draft.pattern,
        status="unsupported",
        gapType="genuinely_missing",
        evidenceIds=[],
        explanation=f"Nothing in your workspace mentions {skill.label} or anything adjacent to it.",
    )


def _classify_experience(draft: RequirementDraft, index: EvidenceIndex) -> Requirement:
    from app.analysis.numeric import js_round

    months = _total_experience_months(index)
    needed = (draft.years or 0) * 12
    items = [*_items_in(index, "experience"), *_items_in(index, "internship")]
    ids = [item.id for item in items]

    # When the sentence names skills, the months must be in that area — five
    # years of web work does not answer "4 years of machine learning".
    domain = draft.skillKeys
    in_domain = len(domain) == 0 or any(
        (index.skills.get(item.id) or set()).intersection(domain) for item in items
    )

    if months > 0 and (needed == 0 or months >= needed) and in_domain:
        return Requirement(
            id=draft.id,
            text=draft.text,
            kind=draft.kind,
            pattern=draft.pattern,
            status="matched",
            gapType=None,
            evidenceIds=ids[:MAX_EVIDENCE_LINKS],
            explanation=(
                f"Your dated experience totals about {js_round(months / 12)} year(s), "
                "which covers this."
            ),
        )
    if months > 0:
        if in_domain:
            reason = (
                f"Your dated experience totals about {js_round(months / 12)} year(s), less than "
                f"the {draft.years if draft.years is not None else 'requested'} asked for."
            )
        else:
            labels = ", ".join(_skill_label(key) for key in domain)
            reason = (
                f"Your dated experience totals about {js_round(months / 12)} year(s), but it is "
                f"in other areas — this line asks for {labels}."
            )
        return Requirement(
            id=draft.id,
            text=draft.text,
            kind=draft.kind,
            pattern=draft.pattern,
            status="partial",
            gapType=None,
            evidenceIds=ids[:MAX_EVIDENCE_LINKS],
            explanation=reason,
        )
    return Requirement(
        id=draft.id,
        text=draft.text,
        kind=draft.kind,
        pattern=draft.pattern,
        status="unsupported",
        gapType="not_evidenced" if ids else "genuinely_missing",
        evidenceIds=ids[:MAX_EVIDENCE_LINKS],
        explanation=(
            "You have experience items, but none carry a start date, so the "
            "length can't be confirmed."
            if ids
            else "You have no experience or internship items in your workspace yet."
        ),
    )


def _classify_education(draft: RequirementDraft, index: EvidenceIndex) -> Requirement:
    education = _items_in(index, "education")
    supporting = [item for item in education if is_supporting_evidence(item.evidence)]
    learning = [*_items_in(index, "course"), *_items_in(index, "training")]
    demanded = degree_level(draft.text)
    held = max((degree_level(item.title) for item in education), default=0)

    if supporting and (demanded == 0 or held >= demanded):
        return Requirement(
            id=draft.id,
            text=draft.text,
            kind=draft.kind,
            pattern=draft.pattern,
            status="matched",
            gapType=None,
            evidenceIds=[item.id for item in supporting][:MAX_EVIDENCE_LINKS],
            explanation="Your education section covers this with attested or verified entries.",
        )
    if supporting:
        held_text = f"a {_degree_label(held)}" if held > 0 else "not listed at a recognisable level"
        return Requirement(
            id=draft.id,
            text=draft.text,
            kind=draft.kind,
            pattern=draft.pattern,
            status="partial",
            gapType=None,
            evidenceIds=[item.id for item in supporting][:MAX_EVIDENCE_LINKS],
            explanation=(
                f"Your highest recorded qualification is {held_text}, below the "
                f"{_degree_label(demanded)} this posting asks for."
            ),
        )
    if education:
        return Requirement(
            id=draft.id,
            text=draft.text,
            kind=draft.kind,
            pattern=draft.pattern,
            status="partial",
            gapType=None,
            evidenceIds=[item.id for item in education][:MAX_EVIDENCE_LINKS],
            explanation=(
                "You have education items, but their evidence is related or missing — attach a "
                "certificate to verify them."
            ),
        )
    if learning:
        return Requirement(
            id=draft.id,
            text=draft.text,
            kind=draft.kind,
            pattern=draft.pattern,
            status="unsupported",
            gapType="not_evidenced",
            evidenceIds=[item.id for item in learning][:MAX_EVIDENCE_LINKS],
            explanation=(
                "No education entry yet. You do have courses or training recorded, so formal "
                "education may just be undocumented."
            ),
        )
    return Requirement(
        id=draft.id,
        text=draft.text,
        kind=draft.kind,
        pattern=draft.pattern,
        status="unsupported",
        gapType="genuinely_missing",
        evidenceIds=[],
        explanation="No education, course or training items in your workspace yet.",
    )


def _classify_seniority(draft: RequirementDraft, index: EvidenceIndex) -> Requirement:
    experience = [*_items_in(index, "experience"), *_items_in(index, "internship")]
    term = draft.term or ""
    matching = (
        [item for item in experience if term in f"{item.title} {' '.join(item.tags)}".lower()]
        if term
        else []
    )
    if matching:
        return Requirement(
            id=draft.id,
            text=draft.text,
            kind=draft.kind,
            pattern=draft.pattern,
            status="matched",
            gapType=None,
            evidenceIds=[item.id for item in matching][:MAX_EVIDENCE_LINKS],
            explanation=f"One of your roles uses the word “{term}”.",
        )
    if experience:
        return Requirement(
            id=draft.id,
            text=draft.text,
            kind=draft.kind,
            pattern=draft.pattern,
            status="partial",
            gapType=None,
            evidenceIds=[item.id for item in experience][:MAX_EVIDENCE_LINKS],
            explanation=f"You have experience, but no role title matches “{term or 'this level'}”.",
        )
    return Requirement(
        id=draft.id,
        text=draft.text,
        kind=draft.kind,
        pattern=draft.pattern,
        status="unsupported",
        gapType="genuinely_missing",
        evidenceIds=[],
        explanation="No experience items recorded, so this level isn't evidenced.",
    )


def classify_requirement(draft: RequirementDraft, index: EvidenceIndex) -> Requirement:
    """Classifies one requirement against the workspace (PRD §6.4 JD-3/JD-4)."""
    if draft.pattern == "experience":
        return _classify_experience(draft, index)
    if draft.pattern == "education":
        return _classify_education(draft, index)
    if draft.pattern == "seniority":
        return _classify_seniority(draft, index)
    return _classify_skill(draft, index)


@dataclass
class MatchResult:
    requirements: list[Requirement]
    counts: dict[str, int]


def match_requirements(drafts: list[RequirementDraft], index: EvidenceIndex) -> MatchResult:
    requirements = [classify_requirement(draft, index) for draft in drafts]
    return MatchResult(
        requirements=requirements,
        counts={
            "matched": sum(1 for r in requirements if r.status == "matched"),
            "partial": sum(1 for r in requirements if r.status == "partial"),
            "unsupported": sum(1 for r in requirements if r.status == "unsupported"),
        },
    )
