"""Import repository: interface, shared mappings, and the Supabase Data API impl.

Same data-access rule as the workspace (ADR-016): the backend reaches Supabase
through the Data API (PostgREST) with the *caller's* JWT, so Postgres sees
``auth.uid()`` and Row Level Security applies end to end. Creating a session (its
row plus every review item) and the *atomic* confirm run through ``SECURITY
INVOKER`` functions in ``db/migrations/0004_imports.sql``, so they commit in one
transaction. The ``service_role`` key is never used.

The original upload is **never stored**: it is parsed in memory and discarded
(PRD §11). Only the extracted text and the candidate items are persisted.
"""

from __future__ import annotations

from typing import Protocol, cast, runtime_checkable

import httpx

from app.extraction.engine import ParsedDocument
from app.repositories.errors import (
    DataApiNotConfiguredError,
    ImportReviewItemNotFoundError,
    ImportSessionNotFoundError,
    RepositoryError,
)
from app.repositories.workspace import (
    SupabaseWorkspaceRepository,
    _as_dict,
    _as_int,
    _as_list,
    _as_uuid,
    _opt_str,
    _safe_json,
)
from app.schemas.imports import (
    ExtractedFieldKey,
    ExtractionItem,
    ImportFileType,
    ImportItemValues,
    ImportReviewItem,
    ImportSession,
    ImportSummary,
    ImportSupportFile,
    ImportSupportLink,
    is_month_value,
)
from app.schemas.workspace import (
    Attachment,
    EvidenceState,
    WorkspaceItemCreate,
    WorkspaceItemResponse,
    WorkspaceSection,
)

# DB ``import_review_items.status`` <- wire status (identical values).
_REVIEW_SELECT = (
    "id,file_name,file_type,file_size,page_count,source_text,preview_available,"
    "created_at,updated_at,"
    "import_review_items(wire_id,section,extraction,values,status,support,decided_at,position)"
)


def initial_values(item: ExtractionItem) -> ImportItemValues:
    """The editable values a review item starts with (from the extraction).

    A bare year ("2019") is shown as read in ``extraction`` but is **not** copied
    into ``values.startDate``: the wire accepts month precision only, and we will
    not invent a month for it (ADR-028).
    """
    by_key: dict[ExtractedFieldKey, str] = {field.key: field.value for field in item.fields}

    def text(key: ExtractedFieldKey, limit: int) -> str:
        return by_key.get(key, "").strip()[:limit]

    def month(key: ExtractedFieldKey) -> str:
        value = by_key.get(key, "").strip()
        return value if is_month_value(value) else ""

    return ImportItemValues(
        title=text("title", 200),
        organization=text("organization", 200),
        startDate=month("startDate"),
        endDate=month("endDate"),
        location=text("location", 200),
        bullets=[bullet[:600] for bullet in item.bullets][:30],
        tags=[tag[:40] for tag in item.tags][:30],
    )


def values_to_workspace_create(
    *,
    section: WorkspaceSection,
    import_id: str,
    item_id: str,
    values: ImportItemValues,
    support: ImportSupportFile | ImportSupportLink | None,
) -> WorkspaceItemCreate:
    """The workspace item a confirmed review item becomes (IM-3).

    Raises ``ValueError`` for the two rules the frontend also enforces: a title
    is required, and the end date may not precede the start date.
    """
    title = values.title.strip()
    if not title:
        raise ValueError("Add a title before confirming — nothing is saved without one.")
    if values.startDate and values.endDate and values.startDate > values.endDate:
        raise ValueError("The end date can't be before the start date.")

    # Evidence is "verified" ONLY for external verification links (ImportSupportLink).
    # User-uploaded files (ImportSupportFile) are self-reported evidence, not third-party
    # verification, so they remain "attested" (PRD §4.2).
    evidence: EvidenceState = "verified" if isinstance(support, ImportSupportLink) else "attested"
    links: list[str] = []
    attachments: list[Attachment] = []
    if isinstance(support, ImportSupportLink):
        links.append(support.url)
    elif isinstance(support, ImportSupportFile):
        # Certificate *files* are not stored in B2 (uploads are discarded), so the
        # attachment carries an internal reference, not a fake external URL. B6
        # replaces it with a private-Storage signed URL (ADR-028).
        attachments.append(
            Attachment(
                id=f"att-{item_id}", name=support.name, url=f"import://{import_id}/{item_id}"
            )
        )

    return WorkspaceItemCreate(
        section=section,
        title=title,
        organization=values.organization.strip() or None,
        startDate=values.startDate or None,
        endDate=values.endDate or None,
        location=values.location.strip() or None,
        bullets=[bullet.strip() for bullet in values.bullets if bullet.strip()],
        tags=[tag.strip() for tag in values.tags if tag.strip()],
        links=links,
        attachments=attachments,
        evidence=evidence,
    )


@runtime_checkable
class ImportRepository(Protocol):
    """Per-user import persistence. Every call is scoped to ``user_id`` and, on
    a database, relies on RLS."""

    async def create_session(
        self,
        user_id: str,
        *,
        file_name: str,
        file_type: ImportFileType,
        file_size: int,
        parsed: ParsedDocument,
    ) -> ImportSession: ...

    async def list_sessions(self, user_id: str) -> list[ImportSummary]: ...

    async def get_session(self, user_id: str, import_id: str) -> ImportSession | None: ...

    async def update_item(
        self, user_id: str, import_id: str, item_id: str, patch: dict[str, object]
    ) -> ImportReviewItem: ...

    async def confirm_item(
        self, user_id: str, import_id: str, item_id: str
    ) -> tuple[WorkspaceItemResponse, ImportReviewItem]: ...


def review_item_from_row(row: dict[str, object]) -> ImportReviewItem:
    """One ``import_review_items`` row -> the wire review item."""
    return ImportReviewItem.model_validate(
        {
            "id": str(row.get("wire_id", "")),
            "extraction": _as_dict(row.get("extraction")),
            "values": _as_dict(row.get("values")),
            "status": str(row.get("status", "pending")),
            "support": row.get("support"),
            "decidedAt": _opt_str(row.get("decided_at")),
        }
    )


def session_from_row(row: dict[str, object]) -> ImportSession:
    """One ``import_sessions`` row (with embedded items) -> the wire session."""
    items = [
        review_item_from_row(_as_dict(entry)) for entry in _as_list(row.get("import_review_items"))
    ]
    return ImportSession(
        id=str(row.get("id", "")),
        fileName=str(row.get("file_name", "")),
        fileType=cast(ImportFileType, str(row.get("file_type", "pdf"))),
        fileSize=_as_int(row.get("file_size")),
        pageCount=max(_as_int(row.get("page_count"), 1), 1),
        sourceText=str(row.get("source_text", "")),
        previewAvailable=bool(row.get("preview_available", False)),
        items=items,
        createdAt=str(row.get("created_at", "")),
        updatedAt=str(row.get("updated_at", "")),
    )


class SupabaseImportRepository:
    """PostgREST-backed import repository. One instance per request, one JWT."""

    def __init__(
        self,
        rest_url: str,
        publishable_key: str,
        access_token: str,
        *,
        timeout: float = 15.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not rest_url or not publishable_key:
            raise DataApiNotConfiguredError("Supabase Data API is not configured.")
        self._base = rest_url.rstrip("/")
        self._publishable_key = publishable_key
        self._token = access_token
        self._headers = {
            "apikey": publishable_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        self._timeout = timeout
        self._transport = transport

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: dict[str, object] | list[dict[str, object]] | None = None,
        prefer: str | None = None,
    ) -> httpx.Response:
        headers = dict(self._headers)
        if prefer:
            headers["Prefer"] = prefer
        async with httpx.AsyncClient(
            base_url=self._base,
            headers=headers,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            return await client.request(method, path, params=params, json=json)

    @staticmethod
    def _raise_for_status(
        response: httpx.Response, *, import_id: str = "", item_id: str = ""
    ) -> None:
        if response.is_success:
            return
        body = _as_dict(_safe_json(response))
        code = str(body.get("code", ""))
        if item_id and (code == "P0003" or code == "P0002"):
            raise ImportReviewItemNotFoundError(item_id)
        if code == "P0002" or response.status_code == 404:
            raise ImportSessionNotFoundError(import_id)
        raise RepositoryError(
            f"Data API error {response.status_code}: {body.get('message', 'unknown')}"
        )

    def _workspace_repository(self) -> SupabaseWorkspaceRepository:
        return SupabaseWorkspaceRepository(
            self._base,
            self._publishable_key,
            self._token,
            timeout=self._timeout,
            transport=self._transport,
        )

    async def create_session(
        self,
        user_id: str,
        *,
        file_name: str,
        file_type: ImportFileType,
        file_size: int,
        parsed: ParsedDocument,
    ) -> ImportSession:
        items: list[dict[str, object]] = [
            {
                "wire_id": item.id,
                "section": item.section,
                "extraction": item.model_dump(),
                "values": initial_values(item).model_dump(),
            }
            for item in parsed.items
        ]
        response = await self._request(
            "POST",
            "/rpc/api_import_create_session",
            json={
                "p_file_name": file_name,
                "p_file_type": file_type,
                "p_file_size": file_size,
                "p_page_count": parsed.page_count,
                "p_source_text": parsed.source_text,
                "p_preview_available": parsed.preview_available,
                "p_items": items,
            },
        )
        self._raise_for_status(response)
        created_id = _as_uuid(_safe_json(response))
        if not created_id:
            raise RepositoryError("create_session returned no id")
        session = await self.get_session(user_id, created_id)
        if session is None:
            raise RepositoryError("create_session created a session that could not be read back")
        return session

    async def list_sessions(self, user_id: str) -> list[ImportSummary]:
        response = await self._request(
            "GET",
            "/import_sessions",
            params={
                "user_id": f"eq.{user_id}",
                "select": "id,file_name,file_type,created_at,import_review_items(status)",
                "order": "created_at.desc",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        summaries: list[ImportSummary] = []
        for row in rows:
            statuses = [
                str(_as_dict(entry).get("status", ""))
                for entry in _as_list(row.get("import_review_items"))
            ]
            summaries.append(
                ImportSummary(
                    id=str(row.get("id", "")),
                    fileName=str(row.get("file_name", "")),
                    fileType=cast(ImportFileType, str(row.get("file_type", "pdf"))),
                    itemCount=len(statuses),
                    pendingCount=statuses.count("pending"),
                    confirmedCount=statuses.count("confirmed"),
                    createdAt=str(row.get("created_at", "")),
                )
            )
        return summaries

    async def get_session(self, user_id: str, import_id: str) -> ImportSession | None:
        response = await self._request(
            "GET",
            "/import_sessions",
            params={
                "id": f"eq.{import_id}",
                "user_id": f"eq.{user_id}",
                "select": _REVIEW_SELECT,
                "import_review_items.order": "position.asc",
                "limit": "1",
            },
        )
        self._raise_for_status(response, import_id=import_id)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        return session_from_row(rows[0]) if rows else None

    async def _get_review_item(
        self, user_id: str, import_id: str, item_id: str
    ) -> ImportReviewItem | None:
        response = await self._request(
            "GET",
            "/import_review_items",
            params={
                "import_id": f"eq.{import_id}",
                "wire_id": f"eq.{item_id}",
                "user_id": f"eq.{user_id}",
                "select": "wire_id,section,extraction,values,status,support,decided_at",
                "limit": "1",
            },
        )
        self._raise_for_status(response, import_id=import_id, item_id=item_id)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        return review_item_from_row(rows[0]) if rows else None

    async def update_item(
        self, user_id: str, import_id: str, item_id: str, patch: dict[str, object]
    ) -> ImportReviewItem:
        body: dict[str, object] = {}
        for key in ("values", "status", "support"):
            if key in patch:
                body[key] = patch[key]
        response = await self._request(
            "PATCH",
            "/import_review_items",
            params={
                "import_id": f"eq.{import_id}",
                "wire_id": f"eq.{item_id}",
                "user_id": f"eq.{user_id}",
            },
            json=body,
            prefer="return=representation",
        )
        self._raise_for_status(response, import_id=import_id, item_id=item_id)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        if not rows:
            raise ImportReviewItemNotFoundError(item_id)
        return review_item_from_row(rows[0])

    async def confirm_item(
        self, user_id: str, import_id: str, item_id: str
    ) -> tuple[WorkspaceItemResponse, ImportReviewItem]:
        response = await self._request(
            "POST",
            "/rpc/api_import_confirm",
            json={"p_import_id": import_id, "p_item_id": item_id},
        )
        self._raise_for_status(response, import_id=import_id, item_id=item_id)
        workspace_item_id = _as_uuid(_safe_json(response))
        if not workspace_item_id:
            raise RepositoryError("confirm returned no workspace item id")

        workspace_item = await self._workspace_repository().get_item(user_id, workspace_item_id)
        if workspace_item is None:
            raise RepositoryError("confirm created a workspace item that could not be read back")
        review = await self._get_review_item(user_id, import_id, item_id)
        if review is None:
            raise ImportReviewItemNotFoundError(item_id)
        return workspace_item, review
