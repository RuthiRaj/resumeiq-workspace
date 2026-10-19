"""Claim validator v1: deterministic grounding checks, no LLM (B3, PRD RG-3).

Every generated claim cites evidence ids. This module rejects a claim when it
contains a fact the cited evidence does not contain:

* numbers/metrics (``40%``, ``12,000``, ``5 years``, ``$1.2M``);
* technologies, matched against a curated lexicon so adjacent skills stay
  distinct (TypeScript is not JavaScript, Docker is not Kubernetes);
* organisations (suffixed names such as "Acme Inc" or declared in evidence);
* job titles, including inflated levels ("Senior" when evidence says only
  "Software Engineer");
* dates (years and month-year pairs).

The checks are intentionally conservative and substring-based, which means a
synonym the lexicon does not know can be flagged. That is the safe direction:
B3 fails closed and a human can extend the evidence, rather than publishing an
invented qualification (PRD §12 "LLM fabrication: critical"). Limitations are
recorded in ADR-030.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from app.ai.errors import AIGroundingError, ClaimViolation
from app.ai.schemas import Claim, EvidenceItem, GroundedResult

# --- Lexicon ---------------------------------------------------------------

#: canonical name -> accepted surface forms (lower-cased for matching).
TECHNOLOGIES: dict[str, tuple[str, ...]] = {
    "javascript": ("javascript", "js"),
    "typescript": ("typescript", "ts"),
    "python": ("python",),
    "java": ("java",),
    "kotlin": ("kotlin",),
    "swift": ("swift",),
    "go": ("go", "golang"),
    "rust": ("rust",),
    "c++": ("c++", "cpp"),
    "c#": ("c#", "csharp", ".net"),
    "php": ("php",),
    "ruby": ("ruby", "ruby on rails"),
    "react": ("react", "react.js", "reactjs"),
    "vue": ("vue", "vue.js", "vuejs"),
    "angular": ("angular", "angularjs"),
    "svelte": ("svelte", "sveltekit"),
    "nextjs": ("next.js", "nextjs"),
    "nodejs": ("node.js", "nodejs", "node"),
    "express": ("express", "express.js"),
    "django": ("django",),
    "flask": ("flask",),
    "fastapi": ("fastapi",),
    "spring": ("spring", "spring boot"),
    "postgresql": ("postgresql", "postgres"),
    "mysql": ("mysql",),
    "sqlite": ("sqlite",),
    "sql": ("sql",),
    "mongodb": ("mongodb", "mongo"),
    "redis": ("redis",),
    "elasticsearch": ("elasticsearch", "elastic search"),
    "docker": ("docker",),
    "kubernetes": ("kubernetes", "k8s"),
    "terraform": ("terraform",),
    "ansible": ("ansible",),
    "aws": ("aws", "amazon web services"),
    "azure": ("azure",),
    "gcp": ("gcp", "google cloud"),
    "graphql": ("graphql",),
    "grpc": ("grpc",),
    "kafka": ("kafka",),
    "rabbitmq": ("rabbitmq",),
    "spark": ("spark", "apache spark"),
    "airflow": ("airflow", "apache airflow"),
    "dbt": ("dbt",),
    "snowflake": ("snowflake",),
    "bigquery": ("bigquery",),
    "tensorflow": ("tensorflow",),
    "pytorch": ("pytorch",),
    "scikit-learn": ("scikit-learn", "sklearn"),
    "pandas": ("pandas",),
    "numpy": ("numpy",),
    "tableau": ("tableau",),
    "powerbi": ("power bi", "powerbi"),
    "figma": ("figma",),
    "git": ("git",),
    "github": ("github",),
    "gitlab": ("gitlab",),
    "jenkins": ("jenkins",),
    "github actions": ("github actions",),
    "linux": ("linux",),
}

TITLE_WORDS = frozenset(
    {
        "engineer",
        "developer",
        "manager",
        "analyst",
        "scientist",
        "designer",
        "architect",
        "director",
        "intern",
        "consultant",
        "administrator",
        "specialist",
        "officer",
        "researcher",
        "programmer",
        "lead",
        "president",
    }
)

LEVEL_MODIFIERS = frozenset(
    {
        "senior",
        "staff",
        "principal",
        "head",
        "chief",
        "junior",
        "associate",
        "distinguished",
        "executive",
        "vice",
    }
)

_ORG_SUFFIXES_STRONG = (
    "Inc",
    "LLC",
    "Ltd",
    "Limited",
    "Corp",
    "Corporation",
    "GmbH",
    "University",
    "Institute",
    "Foundation",
)
_ORG_SUFFIXES_WEAK = ("Labs", "Technologies", "Systems", "Solutions", "Consulting")
_ORG_RE = re.compile(
    r"\b(?:[A-Z][\w&.'-]*\s+){0,3}(?:" + "|".join(_ORG_SUFFIXES_STRONG) + r")\.?"
    r"|\b(?:[A-Z][\w&.'-]*\s+){1,3}(?:" + "|".join(_ORG_SUFFIXES_WEAK) + r")\.?"
)

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z'.\-]*")
_NUMBER_RE = re.compile(
    r"(?<![\w.])(?:[$€£]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|percent|k|m|bn|x))?(?![\w])",
    re.IGNORECASE,
)
_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
_MONTHS = (
    "january|february|march|april|may|june|july|august|september|october|november|december|"
    "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"
)
_MONTH_YEAR_RE = re.compile(rf"\b(?:{_MONTHS})\.?\s+((?:19|20)\d{{2}})\b", re.IGNORECASE)


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def _tech_pattern(alias: str) -> re.Pattern[str]:
    escaped = re.escape(alias)
    return re.compile(rf"(?<![A-Za-z0-9+#]){escaped}(?![A-Za-z0-9+#])", re.IGNORECASE)


_TECH_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (canonical, _tech_pattern(alias))
    for canonical, aliases in TECHNOLOGIES.items()
    for alias in aliases
)


def technologies_in(text: str) -> set[str]:
    """Canonical technologies mentioned in ``text``."""
    found: set[str] = set()
    for canonical, pattern in _TECH_PATTERNS:
        if pattern.search(text):
            found.add(canonical)
    return found


def _normalize_number(token: str) -> str:
    value = token.strip().lower().replace(",", "").replace(" ", "")
    value = value.replace("percent", "%")
    for symbol in ("$", "€", "£"):
        value = value.replace(symbol, "")
    try:
        if value.endswith("bn"):
            return str(round(float(value[:-2]) * 1_000_000_000, 6))
        if value.endswith("k"):
            return str(round(float(value[:-1]) * 1_000, 6))
        if value.endswith("m"):
            return str(round(float(value[:-1]) * 1_000_000, 6))
    except ValueError:
        return value
    return value


def numbers_in(text: str) -> set[str]:
    return {_normalize_number(match.group(0)) for match in _NUMBER_RE.finditer(text)}


def _word_groups(text: str) -> list[list[str]]:
    """Runs of capitalised words, split at sentence boundaries."""
    groups: list[list[str]] = []
    current: list[str] = []
    previous_end = 0
    for match in _TOKEN_RE.finditer(text):
        token = match.group(0)
        between = text[previous_end : match.start()]
        if current and re.search(r"[.!?]|\n", between):
            groups.append(current)
            current = []
        previous_end = match.end()
        title_case = token[0].isupper()
        if (
            token.lower() in TITLE_WORDS
            and current
            and all(word.lower() in LEVEL_MODIFIERS for word in current)
        ):
            # "Senior engineer": the level modifier group continues into a
            # lower-case title word.
            current.append(token)
            groups.append(current)
            current = []
        elif title_case or token.lower() in LEVEL_MODIFIERS:
            current.append(token)
        elif current:
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return groups


def titles_in(text: str) -> set[str]:
    """Candidate job titles: capitalised runs containing a title word."""
    titles: set[str] = set()
    for group in _word_groups(text):
        if any(word.lower() in TITLE_WORDS for word in group):
            titles.add(_norm(" ".join(group)))
    return titles


def organizations_in(text: str) -> set[str]:
    return {_norm(match.group(0).rstrip(".")) for match in _ORG_RE.finditer(text)}


@dataclass(frozen=True)
class ValidationReport:
    ok: bool
    violations: tuple[ClaimViolation, ...]
    claims_checked: int

    def codes(self) -> tuple[str, ...]:
        return tuple(sorted({violation.code for violation in self.violations}))


class ClaimValidator:
    """Deterministic v1. No model, no network, no randomness."""

    def validate(
        self, result: GroundedResult[Any], evidence: Sequence[EvidenceItem]
    ) -> ValidationReport:
        by_id = {item.id: item for item in evidence}
        violations: list[ClaimViolation] = []
        claims = list(result.claims)
        for index, claim in enumerate(claims):
            violations.extend(self._check_claim(index, claim, by_id))
        return ValidationReport(
            ok=not violations, violations=tuple(violations), claims_checked=len(claims)
        )

    def enforce(
        self, task: str, result: GroundedResult[Any], evidence: Sequence[EvidenceItem]
    ) -> None:
        report = self.validate(result, evidence)
        if not report.ok:
            raise AIGroundingError(task, report.violations)

    def _check_claim(
        self, index: int, claim: Claim, by_id: dict[str, EvidenceItem]
    ) -> Iterable[ClaimViolation]:
        cited = [by_id[evidence_id] for evidence_id in claim.evidence_ids if evidence_id in by_id]
        for evidence_id in claim.evidence_ids:
            if evidence_id not in by_id:
                yield ClaimViolation(index, "unknown_evidence_id", evidence_id)
        if not cited:
            yield ClaimViolation(index, "missing_evidence", "no known evidence id")
            return

        haystack = _norm(
            "\n".join(
                [item.text for item in cited]
                + [field for item in cited for field in _evidence_fields(item)]
            )
        )
        evidence_tech: set[str] = set()
        for item in cited:
            evidence_tech |= technologies_in(item.text)
            evidence_tech.update(_norm(value) for value in item.technologies)
        evidence_years = set(_YEAR_RE.findall(haystack))
        evidence_numbers = numbers_in(haystack)
        evidence_titles = titles_in(haystack)
        for item in cited:
            evidence_titles.update(_norm(value) for value in item.titles)
        evidence_orgs = organizations_in(haystack)
        for item in cited:
            evidence_orgs.update(_norm(value) for value in item.organizations)

        for token in sorted(numbers_in(claim.text) - evidence_numbers):
            # A year token is reported by the date check, not twice.
            if token in evidence_years:
                continue
            yield ClaimViolation(index, "invented_metric", token)

        for technology in sorted(technologies_in(claim.text) - evidence_tech):
            yield ClaimViolation(index, "unsupported_technology", technology)

        for organization in sorted(organizations_in(claim.text) - evidence_orgs):
            if organization not in haystack:
                yield ClaimViolation(index, "unsupported_organization", organization)

        for title in sorted(titles_in(claim.text) - evidence_titles):
            if title not in haystack:
                yield ClaimViolation(index, "inflated_title", title)

        for year in sorted(set(_YEAR_RE.findall(claim.text)) - evidence_years):
            yield ClaimViolation(index, "unsupported_date", year)
        for match in _MONTH_YEAR_RE.finditer(claim.text):
            year = match.group(1)
            if year not in evidence_years:
                yield ClaimViolation(index, "unsupported_date", match.group(0))


def _evidence_fields(item: EvidenceItem) -> list[str]:
    return [
        *item.technologies,
        *item.organizations,
        *item.titles,
        *item.dates,
    ]
