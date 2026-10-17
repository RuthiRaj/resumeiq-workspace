"""Workspace wire schemas (milestone B1).

Mirrors ``frontend/src/lib/schemas/workspace.ts`` (field names, enums and
shapes) so the F3 MSW layer can be replaced by this API without a UI rewrite
(AGENTS.md; PRD §8.3). Length limits mirror ``WorkspaceItemFormSchema`` so the
server enforces the same rules the editor shows inline.

Two deliberate divergences from a naive DB mapping are documented in
``docs/DECISIONS.md`` (ADR-017):

* wire ``order`` maps to DB ``workspace_items.position``;
* wire dates are **month precision** (the editor uses ``<input type="month">``,
  e.g. ``2022-09``) while the DB column is ``date`` — normalized to the first
  of the month on write and read back as ``YYYY-MM``.
"""

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

EvidenceState = Literal["verified", "attested", "related", "missing"]

WorkspaceSection = Literal[
    "personal",
    "education",
    "experience",
    "internship",
    "project",
    "skill",
    "achievement",
    "extracurricular",
    "certificate",
    "course",
    "publication",
    "training",
]

#: Canonical order (matches frontend ``WORKSPACE_SECTION_ORDER``, PRD WS-1; the
#: 12-section split is ADR-012).
WORKSPACE_SECTION_ORDER: tuple[WorkspaceSection, ...] = (
    "personal",
    "education",
    "experience",
    "internship",
    "project",
    "skill",
    "achievement",
    "extracurricular",
    "certificate",
    "course",
    "publication",
    "training",
)

ChangeLogOp = Literal["add", "edit", "delete", "reorder", "restore"]

TitleText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
DateText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]
BulletText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)]
TagText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]
LinkText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


def item_has_support(attachments: list["Attachment"], links: list[str]) -> bool:
    """True when a ``verified`` item is actually backed by a document or link."""
    return bool(attachments) or any(link.strip() for link in links)


def validate_item_rules(
    *,
    evidence: str,
    attachments: list["Attachment"],
    links: list[str],
    start_date: str | None,
    end_date: str | None,
) -> None:
    """PRD §4.2 + §6.1 rules the DB cannot express on its own.

    Applied when creating *and* when updating (against the merged result), so an
    item can never end up ``verified`` without a supporting document/link.
    Raises ``ValueError``; the API layer maps it to 422.
    """
    if evidence == "verified" and not item_has_support(attachments, links):
        raise ValueError(
            "Verified needs a supporting document or link. Attach one, or choose User-attested."
        )
    if start_date and end_date and start_date > end_date:
        raise ValueError("The end date can't be before the start date.")


class Attachment(BaseModel):
    """Attachment metadata. The file bytes are out of scope for B1 (PRD WS-2)."""

    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    url: str


class _ItemCommon(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Declared on the shared base so create and update validate links identically;
    # ``check_fields=False`` lets the field live on the subclasses only.
    @field_validator("links", check_fields=False)
    @classmethod
    def _links_are_http(cls, links: list[str] | None) -> list[str] | None:
        if links is None:
            return None
        for link in links:
            if link and not (link.startswith("http://") or link.startswith("https://")):
                raise ValueError("Enter a full URL, e.g. https://example.com")
        return links


class WorkspaceItemCreate(_ItemCommon):
    """``POST /workspace/items`` body (``WorkspaceItemSchema`` minus server fields)."""

    section: WorkspaceSection
    title: TitleText
    organization: ShortText | None = None
    startDate: DateText | None = None
    endDate: DateText | None = None
    location: ShortText | None = None
    bullets: list[BulletText] = Field(default_factory=list, max_length=30)
    tags: list[TagText] = Field(default_factory=list, max_length=30)
    links: list[LinkText] = Field(default_factory=list, max_length=20)
    attachments: list[Attachment] = Field(default_factory=list, max_length=10)
    evidence: EvidenceState = "attested"

    @model_validator(mode="after")
    def _evidence_needs_support(self) -> "WorkspaceItemCreate":
        validate_item_rules(
            evidence=self.evidence,
            attachments=self.attachments,
            links=self.links,
            start_date=self.startDate,
            end_date=self.endDate,
        )
        return self


class WorkspaceItemUpdate(_ItemCommon):
    """``PATCH /workspace/items/{id}`` body — partial (unset fields are untouched).

    ``deletedAt`` is intentionally absent: deletion and restore have dedicated
    endpoints (ADR-013). ``order`` is accepted for parity with the mock, but the
    dedicated reorder endpoint is the version-bumping path (WS-6).
    """

    section: WorkspaceSection | None = None
    title: TitleText | None = None
    organization: ShortText | None = None
    startDate: DateText | None = None
    endDate: DateText | None = None
    location: ShortText | None = None
    bullets: list[BulletText] | None = Field(default=None, max_length=30)
    tags: list[TagText] | None = Field(default=None, max_length=30)
    links: list[LinkText] | None = Field(default=None, max_length=20)
    attachments: list[Attachment] | None = Field(default=None, max_length=10)
    evidence: EvidenceState | None = None
    order: int | None = None

    def patch(self) -> dict[str, object]:
        """Only the fields the client actually sent (PATCH semantics)."""
        return self.model_dump(exclude_unset=True)


class WorkspaceItemResponse(BaseModel):
    """Wire item returned by the workspace endpoints."""

    id: str
    section: WorkspaceSection
    title: str
    organization: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    location: str | None = None
    bullets: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)
    attachments: list[Attachment] = Field(default_factory=list)
    evidence: EvidenceState
    order: int
    deletedAt: str | None = None


class WorkspaceResponse(BaseModel):
    """``GET /workspace`` body."""

    version: int
    items: list[WorkspaceItemResponse]
    updatedAt: str


class ChangeLogEntryResponse(BaseModel):
    """``GET /workspace/changelog`` entry (newest first).

    ``label`` is captured at write time so the log stays readable after a soft
    delete (ADR-013). ``op`` maps the DB ``action`` 1:1, including ``restore``
    (an undo of a soft delete), which the frontend enum carries as of ADR-019.
    """

    seq: int
    workspaceVersion: int
    itemId: str
    op: ChangeLogOp
    at: str
    label: str | None = None


class WorkspaceReorderRequest(BaseModel):
    """``POST /workspace/reorder`` body (PRD WS-6). One version bump per call."""

    model_config = ConfigDict(extra="ignore")

    section: WorkspaceSection
    orderedIds: list[str] = Field(min_length=1)
