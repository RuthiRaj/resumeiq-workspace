"""Tailored-resume orchestration (B5, PRD §6.8 RG-1..RG-6).

The service owns the rules that neither the engine nor the repository can
express:

* generation requires a successful report for the *current* workspace version,
  so selection is never based on a stale analysis (``analysis_required`` /
  ``analysis_stale``);
* the standard resume is derived on every read and is never persisted, so a
  deleted workspace item can never survive in it (SYN-2);
* tailored resumes are snapshots with their source evidence; every mutation
  appends an immutable version and a restore copies an old snapshot forward
  without deleting history (RG-5);
* edits are checked against the cited evidence with the B3 claim validator, so
  a hand-typed or AI-rewritten line cannot introduce a new employer, title,
  date, number or technology (RG-2);
* refresh only replaces sections the user has not edited unless the caller
  names that section explicitly, and deleted source items are flagged rather
  than silently dropped (RG-6);
* AI is opt-in, consent-gated and per-claim: a failed or ungrounded rewrite
  falls back to the original text, and ``aiUsed`` only becomes true when a
  rewritten claim actually survives.

Privacy: nothing in this module logs resume, claim, target or job text. Only
ids, section keys, counts and booleans are logged.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

from app.ai.consent import ConsentGrant
from app.ai.errors import AIConsentRequiredError, AINotConfiguredError
from app.ai.gateway import AIGateway
from app.ai.schemas import (
    BulletRewriteResult,
    EvidenceItem,
    RewriteBulletInput,
)
from app.analysis.ats import compute_ats_report
from app.core.logging import get_logger
from app.repositories.errors import (
    AnalysisRequiredError,
    AnalysisStaleError,
    ResumeClaimUngroundedError,
    ResumeEvidenceNotFoundError,
    ResumeNotFoundError,
    ResumeReadOnlyError,
    ResumeSectionInvalidError,
    ResumeSectionNotFoundError,
    ResumeVersionNotFoundError,
    TargetNotFoundError,
)
from app.repositories.resumes import ResumeRepository, StoredResume, StoredVersion
from app.repositories.targets import TargetRepository
from app.repositories.workspace import WorkspaceRepository
from app.schemas.analysis import AnalysisReport, AtsReport, JobTarget
from app.schemas.resume import (
    Claim,
    ResumeDiff,
    ResumeEvidence,
    ResumePurgeResult,
    ResumeRefreshRequest,
    ResumeRefreshResponse,
    ResumeRefreshSkip,
    ResumeResponse,
    ResumeSection,
    ResumeSectionEdit,
    ResumeSummary,
    ResumeVersionPurgeResult,
    ResumeVersionResponse,
)
from app.schemas.workspace import WorkspaceResponse
from app.services.resume_engine import (
    TAILORED_SECTION_ORDER,
    GeneratedResume,
    ai_evidence,
    build_diff,
    claim_is_grounded,
    claim_is_grounded_for,
    collect_evidence,
    decorate_resume,
    evidence_from_item,
    generate_tailored_resume,
    item_from_evidence,
    removed_item_ids,
)
from app.services.standard_resume import build_standard_resume

logger = get_logger(__name__)

#: Stable id of the derived standard resume (matches the B1 mock).
STANDARD_RESUME_ID = "resume-standard"
STANDARD_TITLE = "Standard resume"

_SECTION_KEYS = frozenset(TAILORED_SECTION_ORDER)


def _purge_sections(
    sections: list[ResumeSection], removed: set[str]
) -> tuple[list[ResumeSection], int, list[str]]:
    """Drop claims citing a removed item; return ``(sections, count, ids)``.

    Surviving claims are copied verbatim and keep their order. A section left
    with no claims is dropped rather than rendered as an empty heading.
    """
    kept: list[ResumeSection] = []
    removed_claims = 0
    cited: list[str] = []
    for section in sections:
        claims: list[Claim] = []
        for claim in section.claims:
            if any(item_id in removed for item_id in claim.evidenceIds):
                removed_claims += 1
                for item_id in claim.evidenceIds:
                    if item_id in removed and item_id not in cited:
                        cited.append(item_id)
                continue
            claims.append(claim.model_copy(deep=True))
        if claims:
            kept.append(ResumeSection(key=section.key, claims=claims))
    return kept, removed_claims, cited


def _surviving_evidence(evidence: list[ResumeEvidence], removed: set[str]) -> list[ResumeEvidence]:
    return [entry.model_copy(deep=True) for entry in evidence if entry.itemId not in removed]


class ClaimReworder(Protocol):
    """Minimal interface the service needs from the optional AI layer."""

    async def reword(
        self,
        *,
        text: str,
        target_role: str,
        evidence: EvidenceItem,
        consent: ConsentGrant,
    ) -> str: ...


class GatewayReworder:
    """Adapter over the B3 gateway's single-bullet rewrite task."""

    def __init__(self, gateway: AIGateway) -> None:
        self._gateway = gateway

    async def reword(
        self,
        *,
        text: str,
        target_role: str,
        evidence: EvidenceItem,
        consent: ConsentGrant,
    ) -> str:
        result = await self._gateway.run(
            "rewrite_bullet",
            RewriteBulletInput(bullet=text, target_role=target_role),
            [evidence],
            consent=consent,
        )
        typed = BulletRewriteResult.model_validate(result.value.model_dump())
        return typed.claims[0].text


def _iso_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class ResumeService:
    """Application rules for generation, edits, history, diff and refresh."""

    def __init__(
        self,
        resumes: ResumeRepository,
        workspace: WorkspaceRepository,
        targets: TargetRepository,
        *,
        reworder: ClaimReworder | None = None,
        clock: Callable[[], str] | None = None,
    ) -> None:
        self._resumes = resumes
        self._workspace = workspace
        self._targets = targets
        self._reworder = reworder
        self._clock = clock or _iso_now

    # -- reads ---------------------------------------------------------------

    async def list_resumes(self, user_id: str) -> list[ResumeSummary]:
        workspace = await self._workspace.get_workspace(user_id)
        standard = self._standard(workspace)
        items = [self._summary(standard)]
        for entry in await self._resumes.list_resumes(user_id):
            items.append(self._summary(self._decorate(entry, workspace)))
        return items

    async def get_resume(self, user_id: str, resume_id: str) -> ResumeResponse:
        workspace = await self._workspace.get_workspace(user_id)
        if resume_id == STANDARD_RESUME_ID:
            return self._standard(workspace)
        entry = await self._require_resume(user_id, resume_id)
        return self._decorate(entry, workspace)

    async def list_versions(self, user_id: str, resume_id: str) -> list[ResumeVersionResponse]:
        if resume_id == STANDARD_RESUME_ID:
            return []
        await self._require_tailored(user_id, resume_id)
        workspace = await self._workspace.get_workspace(user_id)
        snapshots = await self._resumes.list_version_snapshots(user_id, resume_id)
        return [self._decorate_version(entry, workspace) for entry in snapshots]

    async def diff(self, user_id: str, resume_id: str) -> ResumeDiff:
        workspace = await self._workspace.get_workspace(user_id)
        if resume_id == STANDARD_RESUME_ID:
            return ResumeDiff(
                resumeId=STANDARD_RESUME_ID,
                workspaceVersion=workspace.version,
                currentWorkspaceVersion=workspace.version,
                stale=False,
            )
        entry = await self._require_resume(user_id, resume_id)
        resume = entry.resume.model_copy(
            update={
                "stale": entry.resume.stale or entry.resume.workspaceVersion != workspace.version
            }
        )
        return build_diff(resume, entry.evidence, workspace)

    # -- generation ----------------------------------------------------------

    async def generate(
        self,
        user_id: str,
        target_id: str,
        *,
        title: str | None = None,
        reword_with_ai: bool = False,
        consent: ConsentGrant | None = None,
    ) -> ResumeResponse:
        workspace = await self._workspace.get_workspace(user_id)
        target = await self._targets.get_target(user_id, target_id)
        if target is None:
            raise TargetNotFoundError(target_id)
        report = await self._targets.get_report(user_id, target_id)
        if report is None:
            raise AnalysisRequiredError(target_id)
        if report.workspaceVersion != workspace.version:
            raise AnalysisStaleError(target_id)

        generated = generate_tailored_resume(
            workspace, report.requirements, length=target.length or "one_page"
        )
        ai_used = False
        if reword_with_ai:
            generated, ai_used = await self._apply_ai(generated, target, consent=consent)

        ats = self._ats(generated.evidence, report)
        now = self._clock()
        resume = ResumeResponse(
            id=str(uuid4()),
            kind="tailored",
            targetId=target.id,
            title=title or self._default_title(target),
            workspaceVersion=workspace.version,
            stale=False,
            sections=generated.sections,
            createdAt=now,
            updatedAt=now,
            aiUsed=ai_used,
            ats=ats,
            editedSections=[],
            removedEvidenceIds=[],
        )
        stored = await self._resumes.create_resume(
            user_id, resume, generated.evidence, reason="generated"
        )
        logger.info(
            "resume_generated",
            extra={
                "resume_id": stored.resume.id,
                "target_id": target_id,
                "sections": len(stored.resume.sections),
                "ai_used": stored.resume.aiUsed,
            },
        )
        return stored.resume

    # -- mutations -----------------------------------------------------------

    async def edit_section(
        self,
        user_id: str,
        resume_id: str,
        section_key: str,
        edit: ResumeSectionEdit,
    ) -> ResumeResponse:
        entry = await self._require_tailored(user_id, resume_id)
        workspace = await self._workspace.get_workspace(user_id)
        index = next(
            (
                index
                for index, section in enumerate(entry.resume.sections)
                if section.key == section_key
            ),
            None,
        )
        if index is None:
            raise ResumeSectionNotFoundError(section_key)

        current = {
            item.id: evidence_from_item(item) for item in workspace.items if item.deletedAt is None
        }
        claims: list[Claim] = []
        for candidate in edit.claims:
            cited: list[ResumeEvidence] = []
            for item_id in candidate.evidenceIds:
                found = current.get(item_id)
                if found is None:
                    raise ResumeEvidenceNotFoundError(item_id)
                cited.append(found)
            if not claim_is_grounded_for(candidate.text, cited):
                raise ResumeClaimUngroundedError(section_key)
            claims.append(
                Claim(
                    text=candidate.text,
                    evidenceIds=list(candidate.evidenceIds),
                    confirmed=True,
                    aiRewritten=False,
                )
            )

        sections = list(entry.resume.sections)
        sections[index] = ResumeSection(key=section_key, claims=claims)
        edited = list(entry.resume.editedSections)
        if section_key not in edited:
            edited.append(section_key)
        source_evidence = collect_evidence(sections, workspace, entry.evidence)
        report = await self._report_for(entry, user_id)
        resume = entry.resume.model_copy(
            update={
                "sections": sections,
                "editedSections": edited,
                "aiUsed": any(
                    claim.aiRewritten for section in sections for claim in section.claims
                ),
                "ats": (self._ats(source_evidence, report) if report else entry.resume.ats),
                "updatedAt": self._clock(),
            }
        )
        stored = await self._resumes.update_resume(
            user_id, resume, source_evidence, reason="edited"
        )
        logger.info(
            "resume_section_edited",
            extra={"resume_id": resume_id, "section": section_key, "claims": len(claims)},
        )
        return self._decorate(stored, workspace)

    async def mark_stale(self, user_id: str, resume_id: str) -> ResumeResponse:
        await self._require_tailored(user_id, resume_id)
        stored = await self._resumes.set_stale(user_id, resume_id, updated_at=self._clock())
        if stored is None:
            raise ResumeNotFoundError(resume_id)
        workspace = await self._workspace.get_workspace(user_id)
        logger.info("resume_marked_stale", extra={"resume_id": resume_id})
        return self._decorate(stored, workspace)

    async def delete_resume(self, user_id: str, resume_id: str) -> None:
        """Permanently delete a tailored resume, its claims and its versions."""
        await self._require_tailored(user_id, resume_id)
        deleted = await self._resumes.delete_resume(user_id, resume_id)
        if not deleted:
            raise ResumeNotFoundError(resume_id)
        logger.info("resume_deleted", extra={"resume_id": resume_id})

    async def delete_version(self, user_id: str, resume_id: str, version_id: str) -> None:
        """Delete one saved version; the current resume is left untouched."""
        await self._require_tailored(user_id, resume_id)
        deleted = await self._resumes.delete_version(user_id, resume_id, version_id)
        if not deleted:
            raise ResumeVersionNotFoundError(version_id)
        logger.info(
            "resume_version_deleted",
            extra={"resume_id": resume_id, "version_id": version_id},
        )

    async def purge(self, user_id: str, resume_id: str) -> ResumePurgeResult:
        """Remove every claim that cites an item deleted after the snapshot.

        Rewrites the current resume and every saved version in place. Surviving
        statements are copied verbatim; a new ``purged`` version is appended
        only when the current resume itself changed.
        """
        entry = await self._require_tailored(user_id, resume_id)
        workspace = await self._workspace.get_workspace(user_id)
        removed = set(removed_item_ids(entry.evidence, workspace))

        purged_versions = 0
        removed_claims = 0
        removed_ids: list[str] = []
        for snapshot in await self._resumes.list_version_snapshots(user_id, resume_id):
            version_removed = set(removed_item_ids(snapshot.evidence, workspace))
            if not version_removed:
                continue
            sections, count, ids = _purge_sections(snapshot.version.sections, version_removed)
            surviving = {section.key for section in sections}
            version = snapshot.version.model_copy(
                update={
                    "sections": sections,
                    "editedSections": [
                        key for key in snapshot.version.editedSections if key in surviving
                    ],
                    "aiUsed": any(
                        claim.aiRewritten for section in sections for claim in section.claims
                    ),
                }
            )
            # Rewrite even when no surviving claim cites the deleted item: the
            # snapshot's evidence list must drop it too, otherwise the version
            # would keep reporting ``removedEvidenceIds`` after a no-op purge.
            await self._resumes.purge_version(
                user_id,
                resume_id,
                version,
                _surviving_evidence(snapshot.evidence, version_removed),
            )
            purged_versions += 1
            removed_claims += count
            removed_ids.extend(item_id for item_id in ids if item_id not in removed_ids)
            removed_ids.extend(item_id for item_id in version_removed if item_id not in removed_ids)

        sections, current_removed, current_ids = _purge_sections(entry.resume.sections, removed)
        removed_ids.extend(item_id for item_id in current_ids if item_id not in removed_ids)
        removed_ids.extend(item_id for item_id in removed if item_id not in removed_ids)
        if not removed:
            return ResumePurgeResult(
                resume=self._decorate(entry, workspace),
                purgedVersions=purged_versions,
                removedClaims=removed_claims,
                removedEvidenceIds=removed_ids,
            )

        surviving = {section.key for section in sections}
        resume = entry.resume.model_copy(
            update={
                "sections": sections,
                "editedSections": [key for key in entry.resume.editedSections if key in surviving],
                "aiUsed": any(
                    claim.aiRewritten for section in sections for claim in section.claims
                ),
                "updatedAt": self._clock(),
            }
        )
        stored = await self._resumes.update_resume(
            user_id,
            resume,
            _surviving_evidence(entry.evidence, removed),
            reason="purged",
        )
        logger.info(
            "resume_purged",
            extra={
                "resume_id": resume_id,
                "versions": purged_versions,
                "claims": removed_claims + current_removed,
            },
        )
        return ResumePurgeResult(
            resume=self._decorate(stored, workspace),
            purgedVersions=purged_versions,
            removedClaims=removed_claims + current_removed,
            removedEvidenceIds=removed_ids,
        )

    async def purge_version(
        self, user_id: str, resume_id: str, version_id: str
    ) -> ResumeVersionPurgeResult:
        """Remove removed-item claims from exactly one saved snapshot."""
        await self._require_tailored(user_id, resume_id)
        snapshot = await self._resumes.get_version_snapshot(user_id, resume_id, version_id)
        if snapshot is None:
            raise ResumeVersionNotFoundError(version_id)
        workspace = await self._workspace.get_workspace(user_id)
        removed = set(removed_item_ids(snapshot.evidence, workspace))
        sections, count, ids = _purge_sections(snapshot.version.sections, removed)
        if count == 0:
            return ResumeVersionPurgeResult(
                version=self._decorate_version(snapshot, workspace),
                removedClaims=0,
                removedEvidenceIds=[],
            )
        surviving = {section.key for section in sections}
        version = snapshot.version.model_copy(
            update={
                "sections": sections,
                "editedSections": [
                    key for key in snapshot.version.editedSections if key in surviving
                ],
                "aiUsed": any(
                    claim.aiRewritten for section in sections for claim in section.claims
                ),
            }
        )
        purged = await self._resumes.purge_version(
            user_id, resume_id, version, _surviving_evidence(snapshot.evidence, removed)
        )
        logger.info(
            "resume_version_purged",
            extra={"resume_id": resume_id, "version_id": version_id, "claims": count},
        )
        return ResumeVersionPurgeResult(
            version=self._decorate_version(purged, workspace),
            removedClaims=count,
            removedEvidenceIds=ids,
        )

    async def restore(self, user_id: str, resume_id: str, version_id: str) -> ResumeResponse:
        entry = await self._require_tailored(user_id, resume_id)
        snapshot = await self._resumes.get_version_snapshot(user_id, resume_id, version_id)
        if snapshot is None:
            raise ResumeVersionNotFoundError(version_id)
        workspace = await self._workspace.get_workspace(user_id)
        restored = entry.resume.model_copy(
            update={
                "title": snapshot.version.title,
                "workspaceVersion": snapshot.version.workspaceVersion,
                "stale": snapshot.version.workspaceVersion != workspace.version,
                "sections": snapshot.version.sections,
                "aiUsed": snapshot.version.aiUsed,
                "ats": snapshot.version.ats,
                "editedSections": snapshot.version.editedSections,
                "updatedAt": self._clock(),
            }
        )
        stored = await self._resumes.update_resume(
            user_id, restored, snapshot.evidence, reason="restored"
        )
        logger.info(
            "resume_version_restored",
            extra={"resume_id": resume_id, "version_id": version_id},
        )
        return self._decorate(stored, workspace)

    async def refresh(
        self,
        user_id: str,
        resume_id: str,
        request: ResumeRefreshRequest,
        *,
        consent: ConsentGrant | None = None,
    ) -> ResumeRefreshResponse:
        entry = await self._require_tailored(user_id, resume_id)
        workspace = await self._workspace.get_workspace(user_id)
        target, report = await self._refresh_analysis(entry, user_id)

        requested = list(dict.fromkeys(request.sections))
        for key in [*requested, *request.overwriteEditedSections]:
            if key not in _SECTION_KEYS:
                raise ResumeSectionInvalidError(key)
        overwrite = set(request.overwriteEditedSections)

        generated = generate_tailored_resume(
            workspace, report.requirements, length=target.length or "one_page"
        )
        ai_used = False
        if request.rewordWithAi:
            generated, ai_used = await self._apply_ai(generated, target, consent=consent)

        existing = {section.key: section for section in entry.resume.sections}
        fresh = {section.key: section for section in generated.sections}
        edited = set(entry.resume.editedSections)
        remaining_edited = set(edited)
        requested_set = set(requested) if requested else set(existing) | set(fresh)

        final: list[ResumeSection] = []
        refreshed: list[str] = []
        skipped: list[ResumeRefreshSkip] = []
        for key in TAILORED_SECTION_ORDER:
            if key in requested_set and key in edited and key not in overwrite:
                skipped.append(ResumeRefreshSkip(section=key, reason="edited"))
                if key in existing:
                    final.append(existing[key])
                continue
            if key in requested_set:
                # An explicit overwrite replaces the hand-edited content, so
                # the section is no longer marked as edited.
                remaining_edited.discard(key)
                if key in fresh:
                    final.append(fresh[key])
                    refreshed.append(key)
                elif key in existing:
                    # Every source item for this section is gone; dropping the
                    # section is the removal, and diff lists what disappeared.
                    refreshed.append(key)
                continue
            if key in existing:
                final.append(existing[key])

        evidence = collect_evidence(final, workspace, entry.evidence)
        sections = final
        resume = entry.resume.model_copy(
            update={
                "sections": sections,
                "editedSections": [
                    key for key in TAILORED_SECTION_ORDER if key in remaining_edited
                ],
                "workspaceVersion": workspace.version,
                "stale": False,
                "aiUsed": any(
                    claim.aiRewritten for section in sections for claim in section.claims
                ),
                "ats": self._ats(evidence, report),
                "updatedAt": self._clock(),
            }
        )
        stored = await self._resumes.update_resume(user_id, resume, evidence, reason="refreshed")
        logger.info(
            "resume_refreshed",
            extra={
                "resume_id": resume_id,
                "refreshed": len(refreshed),
                "skipped": len(skipped),
                "ai_used": ai_used,
            },
        )
        return ResumeRefreshResponse(
            resume=self._decorate(stored, workspace),
            refreshedSections=[key for key in TAILORED_SECTION_ORDER if key in refreshed],
            skippedSections=skipped,
        )

    # -- helpers -------------------------------------------------------------

    def _standard(self, workspace: WorkspaceResponse) -> ResumeResponse:
        return build_standard_resume(workspace).model_copy(update={"title": STANDARD_TITLE})

    def _summary(self, resume: ResumeResponse) -> ResumeSummary:
        return ResumeSummary(
            id=resume.id,
            kind=resume.kind,
            targetId=resume.targetId,
            title=resume.title,
            workspaceVersion=resume.workspaceVersion,
            stale=resume.stale,
            aiUsed=resume.aiUsed,
            editedSections=list(resume.editedSections),
            removedEvidenceIds=list(resume.removedEvidenceIds),
            createdAt=resume.createdAt,
            updatedAt=resume.updatedAt,
        )

    def _decorate_version(
        self, entry: StoredVersion, workspace: WorkspaceResponse
    ) -> ResumeVersionResponse:
        """Compute the read-only flags a saved snapshot needs."""
        removed = removed_item_ids(entry.evidence, workspace)
        removed_set = set(removed)
        sections = [
            ResumeSection(
                key=section.key,
                claims=[
                    claim.model_copy(
                        update={
                            "removed": any(item_id in removed_set for item_id in claim.evidenceIds)
                        }
                    )
                    for claim in section.claims
                ],
            )
            for section in entry.version.sections
        ]
        return entry.version.model_copy(
            update={
                "sections": sections,
                # Contract §6.5: a version is stale only when it predates the
                # current workspace (a future version is not treated as stale).
                "stale": entry.version.workspaceVersion < workspace.version,
                "removedEvidenceIds": removed,
            }
        )

    def _decorate(self, entry: StoredResume, workspace: WorkspaceResponse) -> ResumeResponse:
        resume = entry.resume.model_copy(
            update={
                "stale": entry.resume.stale or entry.resume.workspaceVersion != workspace.version
            }
        )
        return decorate_resume(resume, removed_item_ids(entry.evidence, workspace))

    async def _require_resume(self, user_id: str, resume_id: str) -> StoredResume:
        entry = await self._resumes.get_resume(user_id, resume_id)
        if entry is None:
            raise ResumeNotFoundError(resume_id)
        return entry

    async def _require_tailored(self, user_id: str, resume_id: str) -> StoredResume:
        if resume_id == STANDARD_RESUME_ID:
            raise ResumeReadOnlyError()
        return await self._require_resume(user_id, resume_id)

    async def _report_for(self, entry: StoredResume, user_id: str) -> AnalysisReport | None:
        if not entry.resume.targetId:
            return None
        return await self._targets.get_report(user_id, entry.resume.targetId)

    async def _refresh_analysis(
        self, entry: StoredResume, user_id: str
    ) -> tuple[JobTarget, AnalysisReport]:
        target_id = entry.resume.targetId
        if not target_id:
            raise AnalysisRequiredError(entry.resume.id)
        target = await self._targets.get_target(user_id, target_id)
        if target is None:
            raise TargetNotFoundError(target_id)
        report = await self._targets.get_report(user_id, target_id)
        if report is None:
            raise AnalysisRequiredError(target_id)
        return target, report

    def _ats(
        self, evidence: list[ResumeEvidence], report: AnalysisReport | None
    ) -> AtsReport | None:
        if report is None:
            return None
        return compute_ats_report(
            [item_from_evidence(entry) for entry in evidence], report.requirements
        )

    @staticmethod
    def _default_title(target: JobTarget) -> str:
        if target.company:
            return f"{target.role} at {target.company}"
        return target.role

    async def _apply_ai(
        self,
        generated: GeneratedResume,
        target: JobTarget,
        *,
        consent: ConsentGrant | None,
    ) -> tuple[GeneratedResume, bool]:
        if self._reworder is None or consent is None:
            # The API layer checks configuration/consent before calling; this
            # guards direct service use and keeps generation deterministic.
            if self._reworder is None:
                raise AINotConfiguredError()
            raise AIConsentRequiredError()
        by_id = {entry.itemId: entry for entry in generated.evidence}
        used = False
        fallback = 0
        sections: list[ResumeSection] = []
        for section in generated.sections:
            claims: list[Claim] = []
            for claim in section.claims:
                entry = by_id.get(claim.evidenceIds[0]) if claim.evidenceIds else None
                if entry is None or claim.text not in entry.bullets:
                    claims.append(claim)
                    continue
                try:
                    candidate = await self._reworder.reword(
                        text=claim.text,
                        target_role=target.role,
                        evidence=self._ai_evidence(entry),
                        consent=consent,
                    )
                    candidate = " ".join(candidate.split())
                    accepted = (
                        bool(candidate)
                        and candidate != claim.text
                        and claim_is_grounded(candidate, entry)
                    )
                except Exception:
                    # The optional layer must never fail the resume.
                    accepted = False
                if accepted:
                    claims.append(claim.model_copy(update={"text": candidate, "aiRewritten": True}))
                    used = True
                else:
                    fallback += 1
                    claims.append(claim)
            sections.append(ResumeSection(key=section.key, claims=claims))
        if fallback:
            logger.info(
                "resume_ai_fallback",
                extra={"claims": fallback, "ai_used": used},
            )
        return (
            GeneratedResume(
                sections=sections,
                evidence=generated.evidence,
                item_ids=generated.item_ids,
            ),
            used,
        )

    @staticmethod
    def _ai_evidence(entry: ResumeEvidence) -> EvidenceItem:
        return ai_evidence(entry)
