"""Month-precision date parsing for the extraction pipeline (PRD §6.2).

The workspace wire format is ``YYYY-MM`` and day precision is rejected
(ADR-017 §2, ADR-019 §2), so this module never emits a day. A token that only
carries a year is reported with ``month=None`` so the caller can *show* what
was read without inventing a month for the saved value.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

_MONTH_NAMES: Final[dict[str, str]] = {
    "jan": "01",
    "january": "01",
    "feb": "02",
    "february": "02",
    "mar": "03",
    "march": "03",
    "apr": "04",
    "april": "04",
    "may": "05",
    "jun": "06",
    "june": "06",
    "jul": "07",
    "july": "07",
    "aug": "08",
    "august": "08",
    "sep": "09",
    "sept": "09",
    "september": "09",
    "oct": "10",
    "october": "10",
    "nov": "11",
    "november": "11",
    "dec": "12",
    "december": "12",
}

_PRESENT_WORDS: Final[tuple[str, ...]] = (
    "present",
    "current",
    "currently",
    "now",
    "ongoing",
    "today",
    "to date",
    "date",
)

MIN_YEAR: Final[int] = 1950
MAX_YEAR: Final[int] = 2039

_MONTH_NAME_RE: Final[re.Pattern[str]] = re.compile(
    r"\b(" + "|".join(_MONTH_NAMES) + r")[a-z]*\.?[\s,./-]{0,3}(\d{4})\b",
    re.IGNORECASE,
)
_ISO_RE: Final[re.Pattern[str]] = re.compile(r"\b(\d{4})[-/](\d{1,2})\b")
_SLASH_RE: Final[re.Pattern[str]] = re.compile(r"\b(\d{1,2})[-/](\d{4})\b")
_YEAR_RE: Final[re.Pattern[str]] = re.compile(r"\b(\d{4})\b")
_PRESENT_RE: Final[re.Pattern[str]] = re.compile(
    r"\b(" + "|".join(_PRESENT_WORDS) + r")\b", re.IGNORECASE
)


@dataclass(frozen=True)
class DateToken:
    """A date found in one line, in left-to-right order."""

    raw: str
    #: ``YYYY-MM`` when a month was actually present, else ``None``.
    month: str | None
    start: int
    end: int


def _norm_month(year: str, month: str) -> str | None:
    if len(year) != 4:
        return None
    try:
        year_value, month_value = int(year), int(month)
    except ValueError:
        return None
    if not MIN_YEAR <= year_value <= MAX_YEAR or not 1 <= month_value <= 12:
        return None
    return f"{year_value:04d}-{month_value:02d}"


def _is_plausible_year(year: str) -> bool:
    return MIN_YEAR <= int(year) <= MAX_YEAR


def find_date_tokens(line: str) -> list[DateToken]:
    """Every date on ``line``, left to right, including a bare year."""
    tokens: list[DateToken] = []
    claimed: list[tuple[int, int]] = []

    def overlaps(start: int, end: int) -> bool:
        return any(not (end <= s or start >= e) for s, e in claimed)

    # 1. Month names ("Jan 2020", "January 2020", "Sept. 2019").
    for match in _MONTH_NAME_RE.finditer(line):
        if overlaps(match.start(), match.end()):
            continue
        month = _norm_month(match.group(2), _MONTH_NAMES[match.group(1).lower()])
        if month is None:
            continue
        tokens.append(
            DateToken(raw=match.group(0).strip(), month=month, start=match.start(), end=match.end())
        )
        claimed.append((match.start(), match.end()))

    # 2. ISO-ish ("2020-01", "2020/01").
    for match in _ISO_RE.finditer(line):
        if overlaps(match.start(), match.end()):
            continue
        month = _norm_month(match.group(1), match.group(2))
        if month is None:
            continue
        tokens.append(
            DateToken(raw=match.group(0).strip(), month=month, start=match.start(), end=match.end())
        )
        claimed.append((match.start(), match.end()))

    # 3. Slash/dash month-first ("01/2020", "3-2019").
    for match in _SLASH_RE.finditer(line):
        if overlaps(match.start(), match.end()):
            continue
        month = _norm_month(match.group(2), match.group(1))
        if month is None:
            continue
        tokens.append(
            DateToken(raw=match.group(0).strip(), month=month, start=match.start(), end=match.end())
        )
        claimed.append((match.start(), match.end()))

    # 4. A bare year — shown as read, no month invented.
    for match in _YEAR_RE.finditer(line):
        if overlaps(match.start(), match.end()) or not _is_plausible_year(match.group(1)):
            continue
        tokens.append(
            DateToken(raw=match.group(1), month=None, start=match.start(), end=match.end())
        )
        claimed.append((match.start(), match.end()))

    tokens.sort(key=lambda token: token.start)
    return tokens


def has_present_marker(line: str) -> bool:
    """True when the line says an entry is ongoing ("Present", "Current")."""
    return _PRESENT_RE.search(line) is not None
