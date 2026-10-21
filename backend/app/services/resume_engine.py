"""Deterministic tailored-resume engine (B5, PRD §6.8 RG-1..RG-6).

The engine never writes prose: it selects and orders the user's *own* workspace
items using the B4 report, then copies their existing header fields and bullets.
Every claim carries the id of the item that evidences it, and a claim's text is
always a verbatim field of that item -- no new employer, title, date, number or
technology can appear here (PRD §4.7, RG-2).

Selection rules (ADR-039):

1. items cited by a matched required requirement rank before matched preferred,
   which rank before partial required, then partial preferred;
2. ties keep the workspace order, so the same inputs always yield the same
   resume;
3. personal/contact items are always kept;
4. when the job has little matching evidence, the remaining items are appended
   in workspace order so the resume is not empty;
5. the target's ``length`` caps the claim count and the bullets per item;
   bullets are ordered by how many target-requirement words they contain.

The optional AI reworder is applied by the service (not here); this module only
provides the deterministic text and the grounding check used for rewrites.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass

from app.ai.claims import ClaimValidator
from app.ai.schemas import BulletRewriteResult, EvidenceItem
from app.ai.schemas import Claim as AIClaim
from app.schemas.analysis import Requirement
from app.schemas.resume import (
    Claim,
    ResumeDiff,
    ResumeDiffEntry,
    ResumeEvidence,
    ResumeResponse,
    ResumeSection,
)
from app.schemas.workspace import (
    EvidenceState,
    WorkspaceItemResponse,
    WorkspaceResponse,
    WorkspaceSection,
)

#: Section order for a tailored resume: personal header, then the sections a
#: recruiter scans first, then supporting material.
TAILORED_SECTION_ORDER: tuple[WorkspaceSection, ...] = (
    "personal",
    "experience",
    "internship",
    "project",
    "education",
    "certificate",
    "course",
    "training",
    "skill",
    "achievement",
    "publication",
    "extracurricular",
)

_SECTION_RANK: dict[str, int] = {key: index for index, key in enumerate(TAILORED_SECTION_ORDER)}

#: Claim budgets. One page keeps the strongest claims; two pages allows more.
_CLAIM_BUDGET = {"one_page": 28, "two_page": 44}
_BULLETS_PER_ITEM = {"one_page": 2, "two_page": 3}
#: Never return fewer than this many items when the workspace has them.
_MIN_ITEMS = 6

_REQUIRED_MATCH = 100
_PREFERRED_MATCH = 80
_REQUIRED_PARTIAL = 50
_PREFERRED_PARTIAL = 30

_TOKEN = re.compile(r"[a-z0-9][a-z0-9+#.]*")
_STOPWORDS = frozenset(
    {
        "and",
        "the",
        "with",
        "for",
        "from",
        "your",
        "you",
        "our",
        "are",
        "has",
        "have",
        "using",
        "work",
        "working",
        "experience",
        "years",
        "year",
        "strong",
        "skills",
        "ability",
        "role",
    }
)

VALIDATOR = ClaimValidator()


@dataclass(frozen=True)
class GeneratedResume:
    """Deterministic output before it is persisted."""

    sections: list[ResumeSection]
    evidence: list[ResumeEvidence]
    item_ids: list[str]


def fingerprint(evidence: ResumeEvidence) -> str:
    """Content hash; workspace position is deliberately excluded (ADR-039)."""
    payload = {
        "section": evidence.section,
        "title": evidence.title,
        "organization": evidence.organization,
        "startDate": evidence.startDate,
        "endDate": evidence.endDate,
        "location": evidence.location,
        "bullets": evidence.bullets,
        "tags": evidence.tags,
        "evidence": evidence.evidence,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def evidence_from_item(item: WorkspaceItemResponse) -> ResumeEvidence:
    evidence = ResumeEvidence(
        itemId=item.id,
        section=item.section,
        title=item.title,
        organization=item.organization,
        startDate=item.startDate,
        endDate=item.endDate,
        location=item.location,
        bullets=list(item.bullets),
        tags=list(item.tags),
        evidence=item.evidence,
        order=item.order,
        fingerprint="",
    )
    return evidence.model_copy(update={"fingerprint": fingerprint(evidence)})


def item_from_evidence(evidence: ResumeEvidence) -> WorkspaceItemResponse:
    """Rebuild the wire item used by the ATS checks and the claim validator."""
    return WorkspaceItemResponse(
        id=evidence.itemId,
        section=evidence.section,
        title=evidence.title,
        organization=evidence.organization,
        startDate=evidence.startDate,
        endDate=evidence.endDate,
        location=evidence.location,
        bullets=list(evidence.bullets),
        tags=list(evidence.tags),
        links=[],
        attachments=[],
        evidence=evidence.evidence,
        order=evidence.order,
        deletedAt=None,
    )


def ai_evidence(evidence: ResumeEvidence) -> EvidenceItem:
    """The only text the reworder sees: the cited item, never the whole resume."""
    text = " \n ".join(
        part
        for part in (
            " · ".join(
                value
                for value in (
                    evidence.title,
                    evidence.organization,
                    evidence.startDate,
                    evidence.endDate,
                )
                if value
            ),
            " ".join(evidence.tags),
            *evidence.bullets,
        )
        if part
    )
    return EvidenceItem(
        id=evidence.itemId,
        kind="workspace_item",
        text=text or evidence.title,
        technologies=list(evidence.tags),
        organizations=[evidence.organization] if evidence.organization else [],
        titles=[evidence.title] if evidence.title else [],
        dates=[value for value in (evidence.startDate, evidence.endDate) if value],
    )


def claim_is_grounded_for(text: str, evidence: list[ResumeEvidence]) -> bool:
    """Run the B3 validator against exactly the evidence a claim cites."""
    if not evidence:
        return False
    candidate = BulletRewriteResult(
        claims=[AIClaim(text=text, evidence_ids=[entry.itemId for entry in evidence])]
    )
    return VALIDATOR.validate(candidate, [ai_evidence(entry) for entry in evidence]).ok


def claim_is_grounded(text: str, evidence: ResumeEvidence) -> bool:
    return claim_is_grounded_for(text, [evidence])


def _header_text(evidence: ResumeEvidence) -> str:
    dates = " – ".join(part for part in (evidence.startDate, evidence.endDate) if part)
    return " · ".join(
        part for part in (evidence.title, evidence.organization, dates) if part and part.strip()
    )


def _weight(requirement: Requirement) -> int:
    if requirement.status == "matched":
        return _REQUIRED_MATCH if requirement.kind == "required" else _PREFERRED_MATCH
    return _REQUIRED_PARTIAL if requirement.kind == "required" else _PREFERRED_PARTIAL


def _terms(text: str) -> set[str]:
    return {
        token
        for token in _TOKEN.findall(text.lower())
        if len(token) >= 3 and token not in _STOPWORDS
    }


@dataclass
class _Ranked:
    evidence: ResumeEvidence
    score: int = 0
    best_requirement: int = 1_000_000
    terms: set[str] | None = None


def _rank_items(
    items: list[WorkspaceItemResponse], requirements: list[Requirement]
) -> list[_Ranked]:
    ranked: dict[str, _Ranked] = {
        item.id: _Ranked(evidence=evidence_from_item(item), terms=set()) for item in items
    }

    for index, requirement in enumerate(requirements):
        if requirement.status == "unsupported":
            continue
        weight = _weight(requirement)
        terms = _terms(requirement.text)
        for item_id in requirement.evidenceIds:
            entry = ranked.get(item_id)
            if entry is None:
                continue
            entry.score += weight
            entry.best_requirement = min(entry.best_requirement, index)
            assert entry.terms is not None
            entry.terms.update(terms)

    for entry in ranked.values():
        if entry.terms is None:
            entry.terms = set()

    # Personal/contact items are always kept; the rest compete by relevance.
    # Zero-score items keep section order so a thin match still produces a
    # usable resume instead of an arbitrary one.
    ordered = sorted(
        ranked.values(),
        key=lambda entry: (
            0 if entry.evidence.section == "personal" else 1,
            -entry.score,
            entry.best_requirement,
            _SECTION_RANK.get(entry.evidence.section, 99),
            entry.evidence.order,
        ),
    )
    return ordered


def _bullet_score(bullet: str, terms: set[str]) -> int:
    if not terms:
        return 0
    return len(terms.intersection(_TOKEN.findall(bullet.lower())))


def _rank_bullets(bullets: list[str], terms: set[str], limit: int) -> list[str]:
    indexed = list(enumerate(bullet.strip() for bullet in bullets if bullet.strip()))
    indexed.sort(key=lambda pair: (-_bullet_score(pair[1], terms), pair[0]))
    return [bullet for _, bullet in indexed[:limit]]


def generate_tailored_resume(
    workspace: WorkspaceResponse,
    requirements: list[Requirement],
    *,
    length: str = "one_page",
) -> GeneratedResume:
    """Select, order and trim the user's own items for one target."""
    active = [item for item in workspace.items if item.deletedAt is None]
    budget = _CLAIM_BUDGET.get(length, _CLAIM_BUDGET["one_page"])
    per_item = _BULLETS_PER_ITEM.get(length, _BULLETS_PER_ITEM["one_page"])

    ranked = _rank_items(active, requirements)
    selected: list[_Ranked] = []
    for entry in ranked:
        if len(selected) >= budget:
            break
        selected.append(entry)

    # Thin evidence: top up with the remaining items in workspace order.
    if len(selected) < min(_MIN_ITEMS, len(ranked)):
        picked = {entry.evidence.itemId for entry in selected}
        for entry in sorted(ranked, key=lambda e: e.evidence.order):
            if len(selected) >= min(_MIN_ITEMS, len(ranked)):
                break
            if entry.evidence.itemId not in picked:
                selected.append(entry)
                picked.add(entry.evidence.itemId)

    # Group by section, preserving the section order and the item ranking.
    grouped: dict[str, list[_Ranked]] = {}
    for entry in selected:
        grouped.setdefault(entry.evidence.section, []).append(entry)

    sections: list[ResumeSection] = []
    rendered: list[ResumeEvidence] = []
    for key in TAILORED_SECTION_ORDER:
        entries = grouped.get(key)
        if not entries:
            continue
        claims: list[Claim] = []
        for entry in entries:
            claims.append(
                Claim(
                    text=_header_text(entry.evidence),
                    evidenceIds=[entry.evidence.itemId],
                    confirmed=entry.evidence.evidence in ("verified", "attested"),
                )
            )
        # Bullet budget is shared across the whole resume; headers always win.
        remaining = max(0, budget - sum(len(section.claims) for section in sections) - len(claims))
        for entry in entries:
            bullets = _rank_bullets(entry.evidence.bullets, entry.terms or set(), per_item)
            if remaining <= 0:
                bullets = []
            else:
                bullets = bullets[:remaining]
                remaining -= len(bullets)
            confirmed = entry.evidence.evidence in ("verified", "attested")
            claims.extend(
                Claim(text=bullet, evidenceIds=[entry.evidence.itemId], confirmed=confirmed)
                for bullet in bullets
            )
            rendered.append(
                entry.evidence.model_copy(update={"bullets": bullets})
                if bullets != entry.evidence.bullets
                else entry.evidence
            )
        sections.append(ResumeSection(key=key, claims=claims))

    # Rendered order is the item order inside each section.
    item_ids = [evidence.itemId for evidence in rendered]
    return GeneratedResume(sections=sections, evidence=rendered, item_ids=item_ids)


def collect_evidence(
    sections: list[ResumeSection],
    workspace: WorkspaceResponse,
    prior: list[ResumeEvidence],
) -> list[ResumeEvidence]:
    """Evidence for exactly the claims that survived, preferring fresh items.

    Used after edits/restores so a resume never cites an item it does not show
    and a deleted item keeps its last known snapshot (for the removal flag).
    """
    current = {
        item.id: evidence_from_item(item) for item in workspace.items if item.deletedAt is None
    }
    previous = {evidence.itemId: evidence for evidence in prior}
    result: list[ResumeEvidence] = []
    seen: set[str] = set()
    for section in sections:
        for claim in section.claims:
            for item_id in claim.evidenceIds:
                if item_id in seen:
                    continue
                found = current.get(item_id) or previous.get(item_id)
                if found is None:
                    continue
                seen.add(item_id)
                result.append(found.model_copy(deep=True))
    return result


def removed_item_ids(evidence: list[ResumeEvidence], workspace: WorkspaceResponse) -> list[str]:
    active = {item.id for item in workspace.items if item.deletedAt is None}
    return [entry.itemId for entry in evidence if entry.itemId not in active]


def decorate_resume(resume: ResumeResponse, removed_ids: list[str]) -> ResumeResponse:
    """Compute stale/removed flags for a read without mutating the snapshot."""
    removed = set(removed_ids)
    sections = [
        ResumeSection(
            key=section.key,
            claims=[
                claim.model_copy(
                    update={"removed": any(item_id in removed for item_id in claim.evidenceIds)}
                )
                for claim in section.claims
            ],
        )
        for section in resume.sections
    ]
    return resume.model_copy(update={"sections": sections, "removedEvidenceIds": removed_ids})


def build_diff(
    resume: ResumeResponse,
    evidence: list[ResumeEvidence],
    workspace: WorkspaceResponse,
) -> ResumeDiff:
    """Compare the resume's evidence snapshot with the current workspace."""
    active = {item.id: item for item in workspace.items if item.deletedAt is None}
    snapshot = {entry.itemId: entry for entry in evidence}

    added: list[ResumeDiffEntry] = []
    for item_id, item in active.items():
        if item_id not in snapshot:
            added.append(ResumeDiffEntry(itemId=item_id, section=item.section, title=item.title))

    removed: list[ResumeDiffEntry] = []
    edited: list[ResumeDiffEntry] = []
    for item_id, entry in snapshot.items():
        current_item = active.get(item_id)
        if current_item is None:
            removed.append(
                ResumeDiffEntry(
                    itemId=item_id,
                    section=entry.section,
                    title=entry.title,
                )
            )
            continue
        if evidence_from_item(current_item).fingerprint != entry.fingerprint:
            edited.append(
                ResumeDiffEntry(
                    itemId=item_id,
                    section=current_item.section,
                    title=current_item.title,
                )
            )

    def section_order(entry: ResumeDiffEntry) -> int:
        return _SECTION_RANK.get(entry.section, 99)

    added.sort(key=lambda entry: (section_order(entry), entry.title.lower()))
    removed.sort(key=lambda entry: (section_order(entry), entry.title.lower()))
    edited.sort(key=lambda entry: (section_order(entry), entry.title.lower()))
    changed = {entry.section for entry in [*added, *removed, *edited]}
    changed_sections = sorted(changed, key=lambda key: _SECTION_RANK.get(key, 99))

    return ResumeDiff(
        resumeId=resume.id,
        targetId=resume.targetId,
        workspaceVersion=resume.workspaceVersion,
        currentWorkspaceVersion=workspace.version,
        stale=resume.stale or resume.workspaceVersion != workspace.version,
        added=added,
        removed=removed,
        edited=edited,
        changedSections=[str(key) for key in changed_sections],
        removedEvidenceIds=[entry.itemId for entry in removed],
    )


def evidence_state(value: str) -> EvidenceState:
    """Narrow an arbitrary wire string to the evidence enum (DB JSON safety)."""
    return value if value in ("verified", "attested", "related", "missing") else "missing"  # type: ignore[return-value]
