"""Deterministic section parser: headings, dates, skills, projects, education.

No AI and no OCR (milestone B2). Every value is copied out of the document text;
nothing is inferred, and a line that does not match a pattern produces no item at
all. ``confidence`` is the parser's certainty about the *pattern match*, not a
claim about the person — and it is what drives the review screen's "uncertain
field" highlighting (PRD §6.2 IM-2, ADR-022).

Known limits, recorded rather than hidden (see ADR-026): a two-column PDF whose
columns are interleaved in the content stream can merge two entries into one
block; unusual heading synonyms are not recognised; a bare year is shown as read
but never turned into an invented month.
"""

from __future__ import annotations

import re
from typing import Final

from app.extraction.dates import DateToken, find_date_tokens, has_present_marker
from app.schemas.imports import ExtractedField, ExtractedFieldKey, ExtractionItem
from app.schemas.workspace import WorkspaceSection

MAX_ITEMS: Final[int] = 200

_BULLET_RE: Final[re.Pattern[str]] = re.compile(r"^\s*(?:[-*•·‣▪◦]|\d{1,2}[.)])\s+")
_TAGS_RE: Final[re.Pattern[str]] = re.compile(
    r"^\s*(?:technologies|tech stack|stack|tools|tags|built with|technologies used)"
    r"\s*[:\-–—]\s*(.+)$",
    re.IGNORECASE,
)
_ORG_HINT_RE: Final[re.Pattern[str]] = re.compile(
    r"(university|college|institute|school|academy|polytechnic|ltd|limited|inc\b|llc|"
    r"llp|gmbh|corp|corporation|company|group|technologies|technology|labs?|laboratory|"
    r"systems|solutions|partners|consulting|bank|foundation|hospital|press)",
    re.IGNORECASE,
)
_NAME_RE: Final[re.Pattern[str]] = re.compile(
    r"^[A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z][A-Za-z.'\-]*){0,4}$"
)
_LOCATION_RE: Final[re.Pattern[str]] = re.compile(
    r"\b([A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){0,2},\s*(?:[A-Z]{2}|[A-Z][A-Za-z.'\-]+))\b"
)
_BLOCKED_NAME_WORDS: Final[tuple[str, ...]] = (
    "resume",
    "curriculum",
    "vitae",
    "profile",
    "summary",
    "contact",
)

#: Normalised heading text -> workspace section. Longer aliases first so the
#: first match wins (dict lookups are exact, so ordering only aids readability).
_SECTION_ALIASES: Final[tuple[tuple[WorkspaceSection, tuple[str, ...]], ...]] = (
    (
        "experience",
        (
            "work experience",
            "professional experience",
            "employment history",
            "work history",
            "relevant experience",
            "experience",
            "employment",
        ),
    ),
    ("internship", ("internship experience", "internships", "internship")),
    (
        "project",
        (
            "personal projects",
            "side projects",
            "selected projects",
            "key projects",
            "projects achievements",
            "projects",
        ),
    ),
    ("education", ("academic background", "education training", "education", "academics")),
    (
        "skill",
        (
            "technical skills",
            "skills technologies",
            "skills and technologies",
            "core skills",
            "key skills",
            "skills tools",
            "technologies",
            "tech stack",
            "skills",
            "tools",
        ),
    ),
    (
        "certificate",
        (
            "certifications licenses",
            "certifications",
            "certificates",
            "certification",
            "licenses",
            "licences",
        ),
    ),
    ("course", ("training courses", "online courses", "courses", "coursework")),
    (
        "achievement",
        (
            "awards achievements",
            "achievements awards",
            "achievements",
            "awards",
            "honors",
            "honours",
        ),
    ),
    (
        "extracurricular",
        (
            "extracurricular activities",
            "volunteer experience",
            "extracurricular",
            "volunteering",
            "activities",
        ),
    ),
    ("publication", ("publications", "papers")),
    ("training", ("professional development", "workshops", "training")),
    ("personal", ("personal details", "personal information", "contact details", "contact")),
)

_TITLE_LABELS: Final[dict[str, str]] = {
    "experience": "Role",
    "internship": "Role",
    "project": "Project",
    "education": "Degree",
    "skill": "Skill",
    "certificate": "Certificate",
    "course": "Course",
    "achievement": "Achievement",
    "extracurricular": "Activity",
    "publication": "Publication",
    "training": "Training",
    "personal": "Name",
}

_ORG_LABELS: Final[dict[str, str]] = {
    "experience": "Employer",
    "internship": "Employer",
    "education": "Institution",
    "certificate": "Issuer",
    "course": "Provider",
    "training": "Provider",
    "project": "Context",
    "achievement": "Awarded by",
    "extracurricular": "Organisation",
    "publication": "Published by",
    "skill": "Category",
    "personal": "Organisation",
}


def _normalize_heading(text: str) -> str:
    lowered = text.strip().lower()
    stripped = re.sub(r"[^a-z0-9]+", " ", lowered)
    return re.sub(r"\s+", " ", stripped).strip()


_HEADING_LOOKUP: Final[dict[str, WorkspaceSection]] = {
    _normalize_heading(alias): section for section, aliases in _SECTION_ALIASES for alias in aliases
}


def heading_section(line: str, has_date: bool) -> WorkspaceSection | None:
    """The workspace section a line names, or ``None``.

    A heading is short, is not a bullet, has no digits or email, and is not the
    line that carries an entry's dates.
    """
    stripped = line.strip()
    if not stripped or len(stripped) > 48 or has_date:
        return None
    if _BULLET_RE.match(line) or stripped.endswith("."):
        return None
    if "@" in stripped or re.search(r"\d", stripped):
        return None
    return _HEADING_LOOKUP.get(_normalize_heading(stripped))


def _field(
    key: ExtractedFieldKey,
    label: str,
    value: str,
    confidence: float,
    line_index: int,
) -> ExtractedField:
    return ExtractedField(
        key=key,
        label=label,
        value=value.strip(),
        confidence=round(float(confidence), 2),
        sourceLine=line_index + 1,
    )


def _bullet_text(line: str) -> str | None:
    match = _BULLET_RE.match(line)
    if match is None:
        return None
    return line[match.end() :].strip()


def _strip_dates(text: str) -> str:
    tokens = find_date_tokens(text)
    if not tokens:
        return re.sub(r"\s{2,}", " ", text).strip()
    kept = text
    for token in reversed(tokens):
        kept = kept[: token.start] + " " + kept[token.end :]
    kept = re.sub(r"\s+", " ", kept).strip()
    kept = re.sub(r"^[\s|•·,;–—-]+", "", kept)
    kept = re.sub(r"[\s|•·,;–—-]+$", "", kept)
    return kept.strip()


def _blocks(lines: list[str], start: int, end: int) -> list[tuple[int, list[str]]]:
    """Non-blank blocks in a section, each with the index of its first line."""
    blocks: list[tuple[int, list[str]]] = []
    current: list[str] = []
    first = start
    for index in range(start, end):
        if lines[index].strip() == "":
            if current:
                blocks.append((first, current))
                current = []
        else:
            if not current:
                first = index
            current.append(lines[index])
    if current:
        blocks.append((first, current))
    return blocks


def _date_follows_within(block: list[str], index: int, window: int = 2) -> bool:
    return any(
        find_date_tokens(block[offset])
        for offset in range(index + 1, min(index + 1 + window, len(block)))
    )


def _split_entries(block: list[str]) -> list[tuple[int, list[str]]]:
    """Split one block into entries, with each entry's offset in the block.

    PDF text extraction drops blank lines, so consecutive entries arrive glued
    together. A new entry starts at a non-bullet line when the previous line was
    a bullet (the usual "title / employer / dates / bullets" shape), or when the
    current entry already has its dates and another date line is close behind
    (the bullet-less shape).
    """
    segments: list[tuple[int, list[str]]] = []
    current: list[str] = []
    start = 0
    saw_date = False
    previous_was_bullet = False

    for index, line in enumerate(block):
        is_bullet = _bullet_text(line) is not None
        has_date = bool(find_date_tokens(line))
        # A new entry starts at a non-bullet line when the previous line was a
        # bullet, when the current entry already has dates and another date line
        # is close behind (bullet-less entries), or when the line is a table row
        # ("role | employer | dates") that carries its own dates.
        starts_new = previous_was_bullet or (
            saw_date and ("|" in line or _date_follows_within(block, index))
        )
        if current and not is_bullet and starts_new:
            segments.append((start, current))
            current = []
            start = index
            saw_date = False
        current.append(line)
        previous_was_bullet = is_bullet
        saw_date = saw_date or has_date

    if current:
        segments.append((start, current))
    return segments


def _segments(line: str) -> list[str]:
    """The parts of a line split on the table-cell separator ``|``."""
    parts = [part.strip() for part in line.split("|")]
    return [part for part in parts if part] or [line.strip()]


def _plain_candidates(block_start: int, block: list[str]) -> list[tuple[int, str]]:
    """Non-bullet parts of a block as ``(line index, text)`` candidates.

    Table rows arrive as ``"role | employer | dates"`` lines, so the parts of a
    line become separate candidates in reading order.
    """
    candidates: list[tuple[int, str]] = []
    for offset, line in enumerate(block):
        if _bullet_text(line) is not None:
            continue
        for segment in _segments(line):
            candidates.append((block_start + offset, segment))
    return candidates


def _entry(
    section: WorkspaceSection, index: int, block_start: int, block: list[str]
) -> ExtractionItem | None:
    """One experience/education/project/... entry from a non-blank block."""
    bullets: list[str] = [
        bullet for line in block if (bullet := _bullet_text(line)) is not None and bullet
    ]
    plain = _plain_candidates(block_start, block)

    if not plain:
        return None

    title_index, title_raw = plain[0]
    title = _strip_dates(title_raw)
    if not title:
        return None

    fields: list[ExtractedField] = [
        _field("title", _TITLE_LABELS.get(section, "Title"), title, 0.9, title_index)
    ]

    # Dates: the richest line in the block wins; token 1 is the start, token 2
    # the end. An ongoing entry ("Present") has nothing to read for the end.
    date_line: int | None = None
    date_tokens: list[DateToken] = []
    for offset, line in enumerate(block):
        tokens = find_date_tokens(line)
        if len(tokens) > len(date_tokens):
            date_tokens = tokens
            date_line = block_start + offset
    if date_line is not None and date_tokens:
        start = date_tokens[0]
        fields.append(
            _field(
                "startDate",
                "Start",
                start.month or start.raw,
                0.85 if start.month else 0.5,
                date_line,
            )
        )
        if len(date_tokens) > 1:
            end = date_tokens[1]
            fields.append(
                _field(
                    "endDate", "End", end.month or end.raw, 0.85 if end.month else 0.5, date_line
                )
            )

    for line_index, raw in plain[1:]:
        if find_date_tokens(raw) or has_present_marker(raw) or _TAGS_RE.match(raw):
            continue
        candidate = raw.strip()
        if not candidate or len(candidate) > 140:
            continue
        confidence = 0.75 if _ORG_HINT_RE.search(candidate) else 0.6
        fields.append(
            _field(
                "organization",
                _ORG_LABELS.get(section, "Organisation"),
                candidate,
                confidence,
                line_index,
            )
        )
        break

    tags: list[str] = []
    for _line_index, raw in plain[1:]:
        match = _TAGS_RE.match(raw)
        if match:
            tags = [tag.strip() for tag in re.split(r"[,;|/·]", match.group(1)) if tag.strip()][:20]
            break

    return ExtractionItem(
        id=f"ext-{section}-{index}",
        section=section,
        fields=fields,
        bullets=bullets[:30],
        tags=tags,
        confidence=round(min(field.confidence for field in fields), 2),
    )


def _skill_items(start: int, end: int, lines: list[str]) -> list[ExtractionItem]:
    """One item per skill token — the workspace models each skill separately."""
    items: list[ExtractionItem] = []
    for line_index in range(start, end):
        raw = lines[line_index]
        if raw.strip() == "":
            continue
        bullet = _bullet_text(raw)
        text = bullet if bullet is not None else raw
        if bullet is None and (find_date_tokens(text) or len(text) > 160):
            continue
        for token in re.split(r"[,;|·•/]|\s+and\s+", text):
            name = token.strip(" .-–—")
            if not name or len(name) > 40 or len(name.split()) > 4:
                continue
            if re.search(r"\d{4}", name) or "@" in name:
                continue
            items.append(
                ExtractionItem(
                    id=f"ext-skill-{len(items) + 1}",
                    section="skill",
                    fields=[_field("title", "Skill", name, 0.8, line_index)],
                    confidence=0.8,
                )
            )
            if len(items) >= MAX_ITEMS:
                return items
    return items


def _looks_like_name(text: str) -> bool:
    candidate = text.strip()
    if not candidate or len(candidate) > 64:
        return False
    if "@" in candidate or any(character.isdigit() for character in candidate):
        return False
    if not _NAME_RE.match(candidate):
        return False
    words = [word.strip(".'-").lower() for word in candidate.split()]
    return not any(word in _BLOCKED_NAME_WORDS for word in words)


def _personal_item(block: list[tuple[int, str]]) -> ExtractionItem | None:
    first_index, first_raw = block[0]
    name = first_raw.strip()
    if not _looks_like_name(name):
        return None
    fields = [_field("title", "Name", name, 0.6, first_index)]
    for index, raw in block[1:]:
        match = _LOCATION_RE.search(raw)
        if match:
            fields.append(_field("location", "Location", match.group(1), 0.5, index))
            break
    return ExtractionItem(
        id="ext-personal-1",
        section="personal",
        fields=fields,
        confidence=round(min(field.confidence for field in fields), 2),
    )


def parse_sections(lines: list[str]) -> list[ExtractionItem]:
    """Turn normalised document lines into candidate workspace items."""
    headings: list[tuple[int, WorkspaceSection]] = []
    for index, line in enumerate(lines):
        section = heading_section(line, bool(find_date_tokens(line)))
        if section is not None:
            headings.append((index, section))

    items: list[ExtractionItem] = []
    counters: dict[str, int] = {}

    # The preamble (before the first heading) is the usual home of the name.
    preamble_end = headings[0][0] if headings else len(lines)
    preamble: list[tuple[int, str]] = []
    for index in range(preamble_end):
        if lines[index].strip() == "":
            continue
        for part in _segments(lines[index]):
            preamble.append((index, part))
    if preamble:
        personal = _personal_item(preamble)
        if personal is not None:
            counters["personal"] = 1
            items.append(personal)

    for position, (start, section) in enumerate(headings):
        if len(items) >= MAX_ITEMS:
            break
        end = headings[position + 1][0] if position + 1 < len(headings) else len(lines)
        body_start = start + 1

        if section == "skill":
            for item in _skill_items(body_start, end, lines):
                if len(items) >= MAX_ITEMS:
                    break
                items.append(item)
            continue

        if section == "personal":
            # A "Contact"/"Personal details" heading: only a name-like candidate
            # becomes an item, so a street address is never labelled a name.
            for block_start, block_lines in _blocks(lines, body_start, end):
                if len(items) >= MAX_ITEMS:
                    break
                personal_entry = _personal_item(_plain_candidates(block_start, block_lines))
                if personal_entry is None:
                    continue
                counters["personal"] = counters.get("personal", 0) + 1
                items.append(
                    personal_entry.model_copy(update={"id": f"ext-personal-{counters['personal']}"})
                )
            continue

        for block_start, block_lines in _blocks(lines, body_start, end):
            if len(items) >= MAX_ITEMS:
                break
            for offset, segment in _split_entries(block_lines):
                if len(items) >= MAX_ITEMS:
                    break
                counters[section] = counters.get(section, 0) + 1
                entry = _entry(section, counters[section], block_start + offset, segment)
                if entry is None:
                    counters[section] -= 1
                    continue
                items.append(entry)

    return items[:MAX_ITEMS]
