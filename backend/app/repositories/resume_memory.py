"""In-memory resume repository (tests and local development).

Mirrors the Supabase rules the service relies on:

* every read/write is scoped to one ``user_id`` (isolation tests assert it);
* creating, editing, restoring or refreshing appends a version, so a restore
  is non-destructive;
* only the explicit B6 delete/purge calls remove or rewrite a version;
* the stored sections/evidence snapshots survive a workspace change, which is
  what makes diff and the removed-item flag possible.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import uuid4

from app.repositories.errors import ResumeNotFoundError, ResumeVersionNotFoundError
from app.repositories.resumes import StoredResume, StoredVersion
from app.schemas.resume import (
    ResumeEvidence,
    ResumeResponse,
    ResumeVersionReason,
    ResumeVersionResponse,
)


def _iso_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class InMemoryResumeRepository:
    """Per-user resume state held in memory (tests only)."""

    def __init__(self, clock: Callable[[], str] | None = None) -> None:
        self._clock = clock or _iso_now
        self._resumes: dict[str, dict[str, StoredResume]] = {}
        self._versions: dict[str, dict[str, list[StoredVersion]]] = {}

    async def list_resumes(self, user_id: str) -> list[StoredResume]:
        stored = list(self._resumes.get(user_id, {}).values())
        stored.sort(key=lambda entry: entry.resume.updatedAt, reverse=True)
        return [
            StoredResume(
                resume=entry.resume.model_copy(deep=True),
                evidence=[item.model_copy(deep=True) for item in entry.evidence],
            )
            for entry in stored
        ]

    async def get_resume(self, user_id: str, resume_id: str) -> StoredResume | None:
        entry = self._resumes.get(user_id, {}).get(resume_id)
        if entry is None:
            return None
        return StoredResume(
            resume=entry.resume.model_copy(deep=True),
            evidence=[item.model_copy(deep=True) for item in entry.evidence],
        )

    async def create_resume(
        self,
        user_id: str,
        resume: ResumeResponse,
        evidence: list[ResumeEvidence],
        *,
        reason: ResumeVersionReason,
    ) -> StoredResume:
        stored = StoredResume(resume=resume.model_copy(deep=True), evidence=list(evidence))
        self._resumes.setdefault(user_id, {})[resume.id] = stored
        self._add_version(user_id, stored, reason, created_at=resume.createdAt)
        return await self._copy(user_id, resume.id)

    async def update_resume(
        self,
        user_id: str,
        resume: ResumeResponse,
        evidence: list[ResumeEvidence],
        *,
        reason: ResumeVersionReason,
    ) -> StoredResume:
        if resume.id not in self._resumes.get(user_id, {}):
            raise ResumeNotFoundError(resume.id)
        stored = StoredResume(resume=resume.model_copy(deep=True), evidence=list(evidence))
        self._resumes[user_id][resume.id] = stored
        self._add_version(user_id, stored, reason, created_at=resume.updatedAt)
        return await self._copy(user_id, resume.id)

    async def set_stale(
        self, user_id: str, resume_id: str, *, updated_at: str
    ) -> StoredResume | None:
        entry = self._resumes.get(user_id, {}).get(resume_id)
        if entry is None:
            return None
        resume = entry.resume.model_copy(update={"stale": True, "updatedAt": updated_at})
        self._resumes[user_id][resume_id] = StoredResume(resume=resume, evidence=entry.evidence)
        return await self._copy(user_id, resume_id)

    async def list_versions(self, user_id: str, resume_id: str) -> list[ResumeVersionResponse]:
        versions = self._versions.get(user_id, {}).get(resume_id, [])
        return [entry.version.model_copy(deep=True) for entry in reversed(versions)]

    async def get_version(
        self, user_id: str, resume_id: str, version_id: str
    ) -> ResumeVersionResponse | None:
        for entry in self._versions.get(user_id, {}).get(resume_id, []):
            if entry.version.id == version_id:
                return entry.version.model_copy(deep=True)
        return None

    async def get_version_snapshot(
        self, user_id: str, resume_id: str, version_id: str
    ) -> StoredVersion | None:
        for entry in self._versions.get(user_id, {}).get(resume_id, []):
            if entry.version.id == version_id:
                return StoredVersion(
                    version=entry.version.model_copy(deep=True),
                    evidence=[item.model_copy(deep=True) for item in entry.evidence],
                )
        return None

    async def list_version_snapshots(self, user_id: str, resume_id: str) -> list[StoredVersion]:
        versions = self._versions.get(user_id, {}).get(resume_id, [])
        return [
            StoredVersion(
                version=entry.version.model_copy(deep=True),
                evidence=[item.model_copy(deep=True) for item in entry.evidence],
            )
            for entry in reversed(versions)
        ]

    async def delete_resume(self, user_id: str, resume_id: str) -> bool:
        resumes = self._resumes.get(user_id, {})
        if resume_id not in resumes:
            return False
        del resumes[resume_id]
        self._versions.get(user_id, {}).pop(resume_id, None)
        return True

    async def delete_version(self, user_id: str, resume_id: str, version_id: str) -> bool:
        versions = self._versions.get(user_id, {}).get(resume_id, [])
        for index, entry in enumerate(versions):
            if entry.version.id == version_id:
                del versions[index]
                return True
        return False

    async def purge_version(
        self,
        user_id: str,
        resume_id: str,
        version: ResumeVersionResponse,
        evidence: list[ResumeEvidence],
    ) -> StoredVersion:
        versions = self._versions.get(user_id, {}).get(resume_id, [])
        for index, entry in enumerate(versions):
            if entry.version.id == version.id:
                replaced = StoredVersion(
                    version=version.model_copy(deep=True),
                    evidence=[item.model_copy(deep=True) for item in evidence],
                )
                versions[index] = replaced
                return StoredVersion(
                    version=replaced.version.model_copy(deep=True),
                    evidence=[item.model_copy(deep=True) for item in replaced.evidence],
                )
        raise ResumeVersionNotFoundError(version.id)

    # -- internals -----------------------------------------------------------

    async def _copy(self, user_id: str, resume_id: str) -> StoredResume:
        entry = self._resumes[user_id][resume_id]
        return StoredResume(
            resume=entry.resume.model_copy(deep=True),
            evidence=[item.model_copy(deep=True) for item in entry.evidence],
        )

    def _add_version(
        self,
        user_id: str,
        stored: StoredResume,
        reason: ResumeVersionReason,
        *,
        created_at: str,
    ) -> None:
        self._versions.setdefault(user_id, {}).setdefault(stored.resume.id, []).append(
            StoredVersion(
                version=ResumeVersionResponse(
                    id=str(uuid4()),
                    resumeId=stored.resume.id,
                    workspaceVersion=stored.resume.workspaceVersion,
                    createdAt=created_at or self._clock(),
                    reason=reason,
                    title=stored.resume.title,
                    aiUsed=stored.resume.aiUsed,
                    sections=[section.model_copy(deep=True) for section in stored.resume.sections],
                    ats=(stored.resume.ats.model_copy(deep=True) if stored.resume.ats else None),
                    editedSections=list(stored.resume.editedSections),
                ),
                evidence=[item.model_copy(deep=True) for item in stored.evidence],
            )
        )

    # -- test helpers --------------------------------------------------------

    def version_count(self, user_id: str, resume_id: str) -> int:
        return len(self._versions.get(user_id, {}).get(resume_id, []))
