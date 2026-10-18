"""Import / extraction-review wire schemas (milestone B2, PRD §6.2 IM-1..IM-3).

Mirrors ``frontend/src/lib/schemas/imports.ts`` and the agreed contract in
``docs/api/contract-proposals.md`` §2 (field names, enums, nullability) so the
F4 MSW layer can be replaced by this API at B7 without a UI rewrite.

Two rules from the contract that the shapes encode:

* ``extraction`` is what the parser read (immutable, with per-field
  ``confidence`` and a 1-based ``sourceLine``); ``values`` is what the user has
  verified. Confirmation copies ``values``, never the raw extraction.
* dates on the wire are **month precision** (``YYYY-MM``) or ``""`` (a form
  value, not a wire-null). Day precision is rejected, never truncated.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.workspace import WorkspaceItemResponse, WorkspaceSection

ImportFileType = Literal["pdf", "docx"]
ImportItemStatus = Literal["pending", "confirmed", "rejected"]

#: Workspace item fields an extraction can populate (extends to a fixed set).
ExtractedFieldKey = Literal["title", "organization", "startDate", "endDate", "location"]

#: ``UNCERTAIN_CONFIDENCE`` on the frontend. Kept here so the parser's
#: reported confidence means the same thing on both sides of the contract.
UNCERTAIN_CONFIDENCE = 0.75

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def is_month_value(value: str) -> bool:
    """True when ``value`` is a wire-legal month (``YYYY-MM``)."""
    return _MONTH_RE.match(value) is not None


ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
MonthText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]
BulletText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)]
TagText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]


class ExtractedField(BaseModel):
    """One value the parser read, with the line it read it from."""

    key: ExtractedFieldKey
    label: str
    value: str
    confidence: float = Field(ge=0, le=1)
    sourceLine: int = Field(gt=0)


class ExtractionItem(BaseModel):
    """A candidate workspace item produced by the deterministic parser."""

    id: str
    section: WorkspaceSection
    fields: list[ExtractedField] = Field(min_length=1)
    bullets: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    #: The weakest field's confidence — the conservative reading (ADR-022).
    confidence: float = Field(ge=0, le=1)


class ImportSupportFile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: Literal["file"]
    name: str = Field(min_length=1, max_length=300)


class ImportSupportLink(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: Literal["link"]
    url: str = Field(min_length=1, max_length=500)


#: IM-3 support: a certificate file or a link. ``null`` means "none attached".
ImportSupport = Annotated[ImportSupportFile | ImportSupportLink, Field(discriminator="kind")]


class ImportItemValues(BaseModel):
    """Editable values the user verifies. Unset is ``""`` (a form value)."""

    model_config = ConfigDict(extra="ignore")

    title: ShortText = ""
    organization: ShortText = ""
    startDate: MonthText = ""
    endDate: MonthText = ""
    location: ShortText = ""
    bullets: list[BulletText] = Field(default_factory=list, max_length=30)
    tags: list[TagText] = Field(default_factory=list, max_length=30)

    @field_validator("startDate", "endDate")
    @classmethod
    def _month_precision(cls, value: str) -> str:
        if value and _MONTH_RE.match(value) is None:
            raise ValueError("Use month precision, e.g. 2024-06")
        return value


class ImportReviewItem(BaseModel):
    """A candidate item plus the user's verified values and decision."""

    id: str
    extraction: ExtractionItem
    values: ImportItemValues
    status: ImportItemStatus = "pending"
    support: ImportSupport | None = None
    decidedAt: str | None = None


class ImportSession(BaseModel):
    """``GET /imports/{id}`` body (and the payload inside ``POST /imports``)."""

    id: str
    fileName: str
    fileType: ImportFileType
    fileSize: int = Field(ge=0)
    #: Page count for a PDF; ``1`` for DOCX (the format does not fix a page
    #: count, and we refuse to invent one).
    pageCount: int = Field(ge=1)
    #: Real extracted text for the side-by-side preview. ``""`` when nothing
    #: could be read (a scanned or image-only document).
    sourceText: str
    previewAvailable: bool
    items: list[ImportReviewItem] = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class ImportSummary(BaseModel):
    """List row for ``GET /imports`` (no document text)."""

    id: str
    fileName: str
    fileType: ImportFileType
    itemCount: int = Field(ge=0)
    pendingCount: int = Field(ge=0)
    confirmedCount: int = Field(ge=0)
    createdAt: str


class ImportUploadResponse(BaseModel):
    """``POST /imports`` body. ``import`` is a Python keyword, hence the alias."""

    model_config = ConfigDict(populate_by_name=True)

    session: ImportSession = Field(alias="import")


class ImportItemPatch(BaseModel):
    """``PATCH /imports/{id}/items/{itemId}`` body — all keys optional.

    ``support: null`` removes a previously attached certificate, so the handler
    must be able to tell "absent" from "explicit null": use :meth:`patch`.
    """

    model_config = ConfigDict(extra="ignore")

    values: ImportItemValues | None = None
    status: ImportItemStatus | None = None
    support: ImportSupport | None = None

    def patch(self) -> dict[str, object]:
        patch = self.model_dump(exclude_unset=True)
        # ``exclude_unset`` would drop the nested fields the client left out;
        # the contract says ``values`` is always validated whole, so re-dump it
        # canonically (missing fields become their ``""`` default).
        if "values" in patch and self.values is not None:
            patch["values"] = self.values.model_dump()
        return patch


class ImportConfirmResponse(BaseModel):
    """``POST /imports/{id}/items/{itemId}/confirm`` body (contract §2.5)."""

    item: WorkspaceItemResponse
    review: ImportReviewItem
