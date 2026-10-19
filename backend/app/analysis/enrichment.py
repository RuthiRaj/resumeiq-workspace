"""Optional AI enrichment for the analysis (B4, PRD §6.9 / EX-3).

AI is *always* optional here. The deterministic engine in this package produces
a complete report with no model, no network and no consent; this module can only
**add** two cosmetic/refinement inputs when all of these hold:

1. an AI provider is configured (``settings.ai_configured``);
2. the caller has a recorded ``ai_processing`` grant (checked by
   ``require_analysis_consent`` before any call);
3. the provider answers with a schema-valid, claim-validated result.

Both steps go through the B3 gateway, so generation is grounded and the claim
validator rejects invented metrics, technologies, titles, organisations and
dates. Refinement only ever *adds taxonomy-known skills that the job description
literally mentions* -- it can never invent a requirement -- and gap explanations
replace prose only, never a status, an evidence link or a score. Every failure
falls back silently to the deterministic text.

Determinism: refinement is cached per SHA-256 of the job description, so the
same posting always yields the same requirements (and therefore the same score)
for identical inputs; gap explanations are cached per job hash + requirement.
"""

from __future__ import annotations

import hashlib
from collections.abc import MutableMapping, Sequence

from app.ai.consent import ConsentGrant
from app.ai.errors import AIError
from app.ai.gateway import AIGateway
from app.ai.schemas import (
    EvidenceItem,
    ExplainGapInput,
    ParseJobRequirementsInput,
)
from app.analysis.requirements import RequirementDraft
from app.analysis.taxonomy import SKILL_TAXONOMY, SkillEntry, mentions_skill
from app.core.logging import get_logger
from app.schemas.analysis import Requirement
from app.schemas.workspace import WorkspaceItemResponse

logger = get_logger(__name__)

#: Most gaps to explain with AI per run: bounded so one report cannot burn a
#: user's whole daily quota, and so the deterministic text stays dominant.
MAX_GAP_EXPLANATIONS = 3


def _job_digest(job_description: str) -> str:
    return hashlib.sha256(job_description.encode("utf-8")).hexdigest()


def _skills_mentioned(text: str) -> list[SkillEntry]:
    """Taxonomy entries whose label or alias occurs as a whole word in ``text``."""
    return [skill for skill in SKILL_TAXONOMY if mentions_skill(text, skill)]


def _skill_entry(key: str) -> SkillEntry | None:
    return next((skill for skill in SKILL_TAXONOMY if skill.key == key), None)


class AnalysisEnricher:
    """Wraps the B3 gateway with the two enrichment steps and their caches."""

    def __init__(
        self,
        gateway: AIGateway,
        *,
        max_gap_explanations: int = MAX_GAP_EXPLANATIONS,
        refinement_cache: MutableMapping[str, tuple[str, ...]] | None = None,
        explanation_cache: MutableMapping[str, str] | None = None,
    ) -> None:
        self._gateway = gateway
        self._max_gaps = max(0, max_gap_explanations)
        self._refinement_cache: MutableMapping[str, tuple[str, ...]] = (
            refinement_cache if refinement_cache is not None else {}
        )
        self._explanation_cache: MutableMapping[str, str] = (
            explanation_cache if explanation_cache is not None else {}
        )

    # -- requirement refinement ---------------------------------------------
    async def refine(
        self,
        *,
        job_description: str,
        drafts: list[RequirementDraft],
        consent: ConsentGrant | None,
    ) -> tuple[list[RequirementDraft], bool]:
        """Return ``drafts`` plus any extra taxonomy-known skills the AI found.

        The added drafts are exactly the same shape the deterministic extractor
        would produce for those skills, so matching and scoring are unchanged.
        """
        extra_keys, used = await self._refinement_keys(job_description, consent)
        if not extra_keys:
            return drafts, False

        existing = {draft.id for draft in drafts}
        enriched = list(drafts)
        added = False
        for key in extra_keys:
            draft_id = f"req-skill-{key}"
            if draft_id in existing:
                continue
            skill = _skill_entry(key)
            if skill is None:
                continue
            enriched.append(
                RequirementDraft(id=draft_id, text=skill.label, kind="required", skillKey=key)
            )
            existing.add(draft_id)
            added = True
        return enriched, used and added

    async def _refinement_keys(
        self, job_description: str, consent: ConsentGrant | None
    ) -> tuple[tuple[str, ...], bool]:
        digest = _job_digest(job_description)
        cached = self._refinement_cache.get(digest)
        if cached is not None:
            return cached, bool(cached)

        evidence = [EvidenceItem(id="jd", kind="job_description", text=job_description[:4000])]
        try:
            result = await self._gateway.run(
                "parse_job_requirements",
                ParseJobRequirementsInput(job_description=job_description[:12000]),
                evidence,
                consent=consent,
            )
        except AIError as exc:
            logger.info("analysis_enrichment_failed", extra={"step": "refine", "code": exc.code})
            self._refinement_cache[digest] = ()
            return (), False

        seen: list[str] = []
        for claim in result.value.claims:
            for skill in _skills_mentioned(claim.text):
                # Never add a skill the posting does not literally mention; the
                # model can only catch what the taxonomy already knows.
                if skill.key in seen:
                    continue
                if not mentions_skill(job_description, skill):
                    continue
                seen.append(skill.key)
        keys = tuple(seen)
        self._refinement_cache[digest] = keys
        return keys, bool(keys)

    # -- gap explanations ----------------------------------------------------
    async def explain(
        self,
        *,
        job_description: str,
        requirements: list[Requirement],
        items: Sequence[WorkspaceItemResponse],
        consent: ConsentGrant | None,
    ) -> tuple[list[Requirement], bool]:
        """Replace up to ``max_gap_explanations`` unsupported explanations."""
        if self._max_gaps == 0:
            return requirements, False
        gaps = {
            requirement.id for requirement in requirements if requirement.status == "unsupported"
        }
        if not gaps:
            return requirements, False

        digest = _job_digest(job_description)
        by_id = {item.id: item for item in items}
        updated: list[Requirement] = []
        used = False
        remaining = self._max_gaps
        for requirement in requirements:
            if requirement.id not in gaps or remaining <= 0:
                updated.append(requirement)
                continue
            remaining -= 1
            key = f"{digest}:{requirement.id}:{requirement.gapType}"
            text = self._explanation_cache.get(key)
            if text is None:
                text = await self._explain_one(
                    requirement=requirement, by_id=by_id, consent=consent
                )
                self._explanation_cache[key] = text
            if text:
                updated.append(requirement.model_copy(update={"explanation": text}))
                used = True
            else:
                updated.append(requirement)
        return updated, used

    async def _explain_one(
        self,
        *,
        requirement: Requirement,
        by_id: dict[str, WorkspaceItemResponse],
        consent: ConsentGrant | None,
    ) -> str:
        evidence = [
            EvidenceItem(
                id=requirement.id[:64],
                kind="requirement",
                text=requirement.text[:4000],
            )
        ]
        for item_id in requirement.evidenceIds[:3]:
            item = by_id.get(item_id)
            if item is None:
                continue
            evidence.append(
                EvidenceItem(
                    id=item.id[:64],
                    kind="workspace_item",
                    text=" ".join([item.title, item.organization or "", *item.bullets])[:4000],
                    technologies=list(item.tags),
                )
            )
        gap_kind = "missing" if requirement.gapType == "genuinely_missing" else "not_evidenced"
        try:
            result = await self._gateway.run(
                "explain_gap",
                ExplainGapInput(requirement=requirement.text[:600], gap_kind=gap_kind),
                evidence,
                consent=consent,
            )
        except AIError as exc:
            logger.info("analysis_enrichment_failed", extra={"step": "explain", "code": exc.code})
            return ""
        text = " ".join(claim.text.strip() for claim in result.value.claims).strip()
        return text[:1200]
