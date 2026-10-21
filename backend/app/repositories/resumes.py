"""Resume persistence: interface + Supabase Data API implementation (B5).

Same data-access rule as every other repository (ADR-016): each call goes
through PostgREST with the *caller's* JWT, so Postgres enforces RLS with
``auth.uid()``. The ``service_role`` key is never used.

Tables reused (``db/migrations/0001_initial.sql`` + ``0007_resumes.sql``):

* ``resumes``         -- one live row per tailored resume (the standard resume
  is derived from the workspace on every read and is never persisted);
* ``resume_versions`` -- insert-only snapshots (generated/edited/restored/
  refreshed), never updated or deleted;
* ``resume_claims``   -- one row per visible statement, including its evidence
  ids and section, so the evidence link survives independently of the JSON.

The stored ``sections`` JSON is canonical for rendering; ``resume_claims`` is
rewritten atomically enough for the single-instance deployment when a resume
changes (ADR-039 documents the trade-off).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable
from uuid import uuid4

import httpx

from app.repositories.errors import DataApiNotConfiguredError, RepositoryError
from app.repositories.workspace import (
    _as_dict,
    _as_int,
    _as_list,
    _opt_str,
    _safe_json,
)
from app.schemas.analysis import AtsReport
from app.schemas.resume import (
    ResumeEvidence,
    ResumeResponse,
    ResumeSection,
    ResumeVersionReason,
    ResumeVersionResponse,
)

_RESUME_SELECT = (
    "id,kind,target_id,title,workspace_version,stale,sections,created_at,updated_at,"
    "ai_used,ats,edited_sections,source_evidence"
)


@dataclass(frozen=True)
class StoredResume:
    """A resume plus the item snapshots it was selected from (never sent)."""

    resume: ResumeResponse
    evidence: list[ResumeEvidence]


@dataclass(frozen=True)
class StoredVersion:
    """A version plus the evidence snapshot needed for a non-destructive restore."""

    version: ResumeVersionResponse
    evidence: list[ResumeEvidence]


def _sections_from_json(value: object) -> list[ResumeSection]:
    sections: list[ResumeSection] = []
    for entry in _as_list(value):
        try:
            sections.append(ResumeSection.model_validate(_as_dict(entry)))
        except ValueError:
            continue
    return sections


def _evidence_from_json(value: object) -> list[ResumeEvidence]:
    evidence: list[ResumeEvidence] = []
    for entry in _as_list(value):
        try:
            evidence.append(ResumeEvidence.model_validate(_as_dict(entry)))
        except ValueError:
            continue
    return evidence


def _version_from_row(row: dict[str, object]) -> ResumeVersionResponse | None:
    snapshot = _as_dict(row.get("snapshot"))
    resume_payload = _as_dict(snapshot.get("resume"))
    if not resume_payload:
        return None
    try:
        resume = ResumeResponse.model_validate(resume_payload)
    except ValueError:
        return None
    reason = str(snapshot.get("reason", "generated"))
    if reason not in ("generated", "edited", "restored", "refreshed"):
        reason = "generated"
    return ResumeVersionResponse(
        id=str(row.get("id")),
        resumeId=str(row.get("resume_id", resume.id)),
        workspaceVersion=_as_int(row.get("workspace_version", resume.workspaceVersion)),
        createdAt=str(row.get("created_at", resume.updatedAt)),
        reason=reason,
        title=resume.title,
        aiUsed=resume.aiUsed,
        sections=resume.sections,
        ats=resume.ats,
        editedSections=resume.editedSections,
    )


def _snapshot(
    resume: ResumeResponse, evidence: list[ResumeEvidence], reason: ResumeVersionReason
) -> dict[str, object]:
    return {
        "resume": resume.model_dump(mode="json"),
        "evidence": [entry.model_dump(mode="json") for entry in evidence],
        "reason": reason,
    }


@runtime_checkable
class ResumeRepository(Protocol):
    """Per-user resume persistence. Every implementation scopes to ``user_id``."""

    async def list_resumes(self, user_id: str) -> list[StoredResume]: ...

    async def get_resume(self, user_id: str, resume_id: str) -> StoredResume | None: ...

    async def create_resume(
        self,
        user_id: str,
        resume: ResumeResponse,
        evidence: list[ResumeEvidence],
        *,
        reason: ResumeVersionReason,
    ) -> StoredResume: ...

    async def update_resume(
        self,
        user_id: str,
        resume: ResumeResponse,
        evidence: list[ResumeEvidence],
        *,
        reason: ResumeVersionReason,
    ) -> StoredResume: ...

    async def set_stale(
        self, user_id: str, resume_id: str, *, updated_at: str
    ) -> StoredResume | None: ...

    async def list_versions(self, user_id: str, resume_id: str) -> list[ResumeVersionResponse]: ...

    async def get_version(
        self, user_id: str, resume_id: str, version_id: str
    ) -> ResumeVersionResponse | None: ...

    async def get_version_snapshot(
        self, user_id: str, resume_id: str, version_id: str
    ) -> StoredVersion | None: ...


class SupabaseResumeRepository:
    """PostgREST-backed repository. One instance per request, bound to one JWT."""

    def __init__(
        self,
        rest_url: str,
        publishable_key: str,
        access_token: str,
        *,
        timeout: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not rest_url or not publishable_key:
            raise DataApiNotConfiguredError("Supabase Data API is not configured.")
        self._base = rest_url.rstrip("/")
        self._headers = {
            "apikey": publishable_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "return=representation",
        }
        self._timeout = timeout
        self._transport = transport

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: object | None = None,
        prefer: str | None = None,
    ) -> httpx.Response:
        headers = dict(self._headers)
        if prefer is not None:
            headers["Prefer"] = prefer
        async with httpx.AsyncClient(
            base_url=self._base,
            headers=headers,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            return await client.request(method, path, params=params, json=json)

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.is_success:
            return
        body = _as_dict(_safe_json(response))
        raise RepositoryError(
            f"Data API error {response.status_code}: {body.get('message', 'unknown')}"
        )

    def _row_to_stored(self, row: dict[str, object]) -> StoredResume:
        ats_payload = _as_dict(row.get("ats"))
        ats: AtsReport | None = None
        if ats_payload:
            try:
                ats = AtsReport.model_validate(ats_payload)
            except ValueError:
                ats = None
        resume = ResumeResponse(
            id=str(row.get("id")),
            kind=str(row.get("kind", "tailored")),
            targetId=_opt_str(row.get("target_id")),
            title=_opt_str(row.get("title")),
            workspaceVersion=_as_int(row.get("workspace_version", 1)),
            stale=bool(row.get("stale", False)),
            sections=_sections_from_json(row.get("sections")),
            createdAt=str(row.get("created_at", "")),
            updatedAt=str(row.get("updated_at") or row.get("created_at", "")),
            aiUsed=bool(row.get("ai_used", False)),
            ats=ats,
            editedSections=[str(key) for key in _as_list(row.get("edited_sections"))],
            removedEvidenceIds=[],
        )
        return StoredResume(
            resume=resume,
            evidence=_evidence_from_json(row.get("source_evidence")),
        )

    def _row(self, user_id: str, resume: ResumeResponse, evidence: list[ResumeEvidence]) -> dict:
        return {
            "id": resume.id,
            "user_id": user_id,
            "kind": resume.kind,
            "target_id": resume.targetId,
            "title": resume.title,
            "workspace_version": resume.workspaceVersion,
            "stale": resume.stale,
            "sections": [section.model_dump(mode="json") for section in resume.sections],
            "created_at": resume.createdAt,
            "updated_at": resume.updatedAt,
            "ai_used": resume.aiUsed,
            "ats": resume.ats.model_dump(mode="json") if resume.ats is not None else None,
            "edited_sections": list(resume.editedSections),
            "source_evidence": [entry.model_dump(mode="json") for entry in evidence],
        }

    async def _save_claims(self, user_id: str, resume: ResumeResponse) -> None:
        deleted = await self._request(
            "DELETE",
            "/resume_claims",
            params={"user_id": f"eq.{user_id}", "resume_id": f"eq.{resume.id}"},
            prefer="return=minimal",
        )
        self._raise_for_status(deleted)
        rows = [
            {
                "user_id": user_id,
                "resume_id": resume.id,
                "text": claim.text,
                "evidence_ids": list(claim.evidenceIds),
                "confirmed": claim.confirmed,
                "section": section.key,
                "position": position,
                "ai_rewritten": claim.aiRewritten,
            }
            for section in resume.sections
            for position, claim in enumerate(section.claims)
        ]
        if not rows:
            return
        response = await self._request("POST", "/resume_claims", json=rows, prefer="return=minimal")
        self._raise_for_status(response)

    async def _add_version(
        self,
        user_id: str,
        resume: ResumeResponse,
        evidence: list[ResumeEvidence],
        reason: ResumeVersionReason,
        *,
        created_at: str,
    ) -> None:
        response = await self._request(
            "POST",
            "/resume_versions",
            json={
                "id": str(uuid4()),
                "user_id": user_id,
                "resume_id": resume.id,
                "snapshot": _snapshot(resume, evidence, reason),
                "workspace_version": resume.workspaceVersion,
                "created_at": created_at,
            },
            prefer="return=minimal",
        )
        self._raise_for_status(response)

    async def list_resumes(self, user_id: str) -> list[StoredResume]:
        response = await self._request(
            "GET",
            "/resumes",
            params={
                "user_id": f"eq.{user_id}",
                "deleted_at": "is.null",
                "select": _RESUME_SELECT,
                "order": "updated_at.desc",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        return [self._row_to_stored(row) for row in rows]

    async def get_resume(self, user_id: str, resume_id: str) -> StoredResume | None:
        response = await self._request(
            "GET",
            "/resumes",
            params={
                "id": f"eq.{resume_id}",
                "user_id": f"eq.{user_id}",
                "deleted_at": "is.null",
                "select": _RESUME_SELECT,
                "limit": "1",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        return self._row_to_stored(rows[0]) if rows else None

    async def create_resume(
        self,
        user_id: str,
        resume: ResumeResponse,
        evidence: list[ResumeEvidence],
        *,
        reason: ResumeVersionReason,
    ) -> StoredResume:
        response = await self._request(
            "POST", "/resumes", json=self._row(user_id, resume, evidence)
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        stored = self._row_to_stored(rows[0]) if rows else StoredResume(resume, evidence)
        await self._save_claims(user_id, stored.resume)
        await self._add_version(
            user_id, stored.resume, stored.evidence, reason, created_at=resume.createdAt
        )
        return stored

    async def update_resume(
        self,
        user_id: str,
        resume: ResumeResponse,
        evidence: list[ResumeEvidence],
        *,
        reason: ResumeVersionReason,
    ) -> StoredResume:
        body = self._row(user_id, resume, evidence)
        for key in ("id", "user_id", "kind", "created_at"):
            body.pop(key, None)
        response = await self._request(
            "PATCH",
            "/resumes",
            params={"id": f"eq.{resume.id}", "user_id": f"eq.{user_id}"},
            json=body,
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        stored = self._row_to_stored(rows[0]) if rows else StoredResume(resume, evidence)
        await self._save_claims(user_id, stored.resume)
        await self._add_version(
            user_id, stored.resume, stored.evidence, reason, created_at=resume.updatedAt
        )
        return stored

    async def set_stale(
        self, user_id: str, resume_id: str, *, updated_at: str
    ) -> StoredResume | None:
        response = await self._request(
            "PATCH",
            "/resumes",
            params={"id": f"eq.{resume_id}", "user_id": f"eq.{user_id}"},
            json={"stale": True, "updated_at": updated_at},
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        return self._row_to_stored(rows[0]) if rows else None

    async def list_versions(self, user_id: str, resume_id: str) -> list[ResumeVersionResponse]:
        response = await self._request(
            "GET",
            "/resume_versions",
            params={
                "user_id": f"eq.{user_id}",
                "resume_id": f"eq.{resume_id}",
                "select": "id,resume_id,workspace_version,snapshot,created_at",
                "order": "created_at.desc",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        versions = [version for row in rows if (version := _version_from_row(row)) is not None]
        return versions

    async def get_version(
        self, user_id: str, resume_id: str, version_id: str
    ) -> ResumeVersionResponse | None:
        response = await self._request(
            "GET",
            "/resume_versions",
            params={
                "id": f"eq.{version_id}",
                "user_id": f"eq.{user_id}",
                "resume_id": f"eq.{resume_id}",
                "select": "id,resume_id,workspace_version,snapshot,created_at",
                "limit": "1",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        return _version_from_row(rows[0]) if rows else None

    async def get_version_snapshot(
        self, user_id: str, resume_id: str, version_id: str
    ) -> StoredVersion | None:
        response = await self._request(
            "GET",
            "/resume_versions",
            params={
                "id": f"eq.{version_id}",
                "user_id": f"eq.{user_id}",
                "resume_id": f"eq.{resume_id}",
                "select": "id,resume_id,workspace_version,snapshot,created_at",
                "limit": "1",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        if not rows:
            return None
        version = _version_from_row(rows[0])
        if version is None:
            return None
        snapshot = _as_dict(rows[0].get("snapshot"))
        return StoredVersion(
            version=version, evidence=_evidence_from_json(snapshot.get("evidence"))
        )
