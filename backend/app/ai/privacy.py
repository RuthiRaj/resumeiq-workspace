"""Reversible PII redaction before any external AI call (PRD §10.3, §11).

The gateway never sends raw personal data. Email addresses, phone numbers, URLs,
street addresses and the caller's known profile fields (name, location, links…)
are replaced by stable placeholders such as ``[[EMAIL_1]]``. The same values map
to the same placeholder inside one request, and the mapping is kept only in
memory for that call: generated text is restored before it is validated or
returned, and the mapping is never logged or cached.

Placeholders are deliberately JSON-safe and unlikely to collide with resume
text, so a model can copy them into its output without breaking the schema.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

PLACEHOLDER_RE = re.compile(r"\[\[(?:EMAIL|PHONE|URL|ADDRESS|FIELD)_\d+\]\]")

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_URL_RE = re.compile(
    r"(?:https?://|www\.)[^\s<>\"')\]]+"
    r"|\b(?:linkedin\.com|github\.com|gitlab\.com|medium\.com|behance\.net|dribbble\.com)"
    r"/[^\s<>\"')\]]+",
    re.IGNORECASE,
)
_PHONE_RE = re.compile(
    r"(?<![\w])"
    r"(?:\+?\d{1,3}[\s.\-]?)?"
    r"(?:\(\d{2,4}\)[\s.\-]?|\d{2,4}[\s.\-])"
    r"\d{3,4}"
    r"[\s.\-]?\d{3,4}"
    r"(?![\w])"
)
_ADDRESS_RE = re.compile(
    r"\b\d{1,5}\s+(?:[A-Za-z0-9'.]+\s+){1,5}"
    r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|"
    r"Way|Place|Pl|Terrace|Ter|Circle|Cir|Square|Sq|Highway|Hwy)\.?"
    r"(?:\s*,?\s*(?:Apt|Suite|Ste|Unit|#)\s*[\w-]+)?",
    re.IGNORECASE,
)
#: A phone-shaped digit run that is really a date or date range ("2020-2023").
_DATE_LIKE_RE = re.compile(r"^\d{1,4}([-/.]\d{1,4}){1,2}$")

_PLACEHOLDER_LIMIT = 200


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def _is_phone_like(candidate: str) -> bool:
    if _DATE_LIKE_RE.match(candidate.strip()):
        return False
    digits = _digits(candidate)
    if not 7 <= len(digits) <= 15:
        return False
    # Require a phone-ish shape: an international prefix, parentheses, or a
    # separator between digit groups. Bare 7+ digit numbers stay untouched.
    return (
        candidate.strip().startswith("+")
        or "(" in candidate
        or bool(re.search(r"\d[\s.\-]\d", candidate))
    )


@dataclass
class RedactionSession:
    """One request's redaction state: placeholder -> original value."""

    profile_fields: Mapping[str, str] = field(default_factory=dict)
    _to_placeholder: dict[str, str] = field(default_factory=dict, init=False)
    _to_original: dict[str, str] = field(default_factory=dict, init=False)
    _counters: dict[str, int] = field(default_factory=dict, init=False)

    def _placeholder(self, kind: str, value: str) -> str:
        existing = self._to_placeholder.get(value)
        if existing is not None:
            return existing
        counter = self._counters.get(kind, 0) + 1
        if counter > _PLACEHOLDER_LIMIT:  # pragma: no cover - pathological input
            raise ValueError("Too many distinct values to redact in one request.")
        self._counters[kind] = counter
        placeholder = f"[[{kind}_{counter}]]"
        self._to_placeholder[value] = placeholder
        self._to_original[placeholder] = value
        return placeholder

    def redact(self, text: str) -> str:
        """Replace PII in ``text`` with this session's stable placeholders."""
        if not text:
            return text

        redacted = text
        # Known profile fields first: an exact name or location is unambiguous,
        # and longer values must win over their substrings.
        for value in sorted(self.profile_fields.values(), key=len, reverse=True):
            value = (value or "").strip()
            if len(value) < 2 or PLACEHOLDER_RE.search(value):
                continue
            if value in redacted:
                redacted = redacted.replace(value, self._placeholder("FIELD", value))

        redacted = _URL_RE.sub(lambda m: self._placeholder("URL", m.group(0)), redacted)
        redacted = _EMAIL_RE.sub(lambda m: self._placeholder("EMAIL", m.group(0)), redacted)
        redacted = _PHONE_RE.sub(
            lambda m: (
                self._placeholder("PHONE", m.group(0)) if _is_phone_like(m.group(0)) else m.group(0)
            ),
            redacted,
        )
        return _ADDRESS_RE.sub(lambda m: self._placeholder("ADDRESS", m.group(0)), redacted)

    def restore(self, text: str) -> str:
        """Put the original values back into one generated string."""
        if not text:
            return text
        restored = text
        for placeholder, original in self._to_original.items():
            restored = restored.replace(placeholder, original)
        return restored

    def restore_payload(self, value: Any) -> Any:
        """Recursively restore strings inside a parsed JSON payload."""
        if isinstance(value, str):
            return self.restore(value)
        if isinstance(value, list):
            return [self.restore_payload(item) for item in value]
        if isinstance(value, dict):
            return {key: self.restore_payload(item) for key, item in value.items()}
        return value

    @property
    def replacements(self) -> int:
        """How many distinct values were replaced (for metrics, not content)."""
        return len(self._to_original)


def redact_text(
    text: str, profile_fields: Mapping[str, str] | None = None
) -> tuple[str, RedactionSession]:
    """Convenience wrapper: redact one string and return the session."""
    session = RedactionSession(profile_fields=profile_fields or {})
    return session.redact(text), session
