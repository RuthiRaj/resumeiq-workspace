"""Deterministic ATS checks (port of ``ats.ts``, PRD §6.7).

Nothing here is a language-model opinion and nothing is a guarantee: each check
is a rule, each issue says what was found, and each example is a *presentational*
rewrite of the user's own text -- same facts, no new claims. The panel always
prints the score formula next to the number.
"""

from __future__ import annotations

import re

from app.analysis.numeric import js_round
from app.analysis.taxonomy import find_skill_by_term, mentions_skill, mentions_term
from app.schemas.analysis import (
    AtsCheck,
    AtsExample,
    AtsIssue,
    AtsKeyword,
    AtsReport,
    Requirement,
)
from app.schemas.workspace import WorkspaceItemResponse, WorkspaceSection

#: Section heading the checks expect to find content for.
EXPECTED_HEADINGS: tuple[tuple[WorkspaceSection, str], ...] = (
    ("education", "Education"),
    ("experience", "Experience"),
    ("project", "Projects"),
    ("skill", "Skills"),
)

PENALTY = {"high": 12, "med": 7, "low": 3}

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

_ISO_MONTH = re.compile(r"^(\d{4})-(\d{2})$")
_SENTENCE_END = re.compile(r"\.\s")
_DETAIL_SECTIONS = ("experience", "internship", "project")


def month_label(value: str) -> str:
    """ "2025-03" -> "Mar 2025". Formatting only; the date itself is unchanged."""
    match = _ISO_MONTH.match(value.strip())
    if match is None:
        return value
    month_number = int(match.group(2))
    month = MONTHS[month_number - 1] if 1 <= month_number <= 12 else match.group(2)
    return f"{month} {match.group(1)}"


def _date_range(item: WorkspaceItemResponse, fmt: str) -> str:
    if not item.startDate:
        return ""
    start = item.startDate if fmt == "iso" else month_label(item.startDate)
    if not item.endDate:
        return f"{start} – Present"
    end = item.endDate if fmt == "iso" else month_label(item.endDate)
    return f"{start} – {end}"


def _header_line(item: WorkspaceItemResponse, fmt: str) -> str:
    """One resume line for an item, used by the before/after examples."""
    parts = [item.title]
    if item.organization:
        parts.append(item.organization)
    date_range = _date_range(item, fmt)
    if date_range:
        parts.append(date_range)
    return " · ".join(parts)


def split_bullet(bullet: str) -> str:
    trimmed = bullet.strip()
    if len(trimmed) <= 160:
        return trimmed
    sentence = _SENTENCE_END.search(trimmed[:200])
    sentence_end = sentence.start() if sentence else -1
    if sentence_end > 60:
        cut_at = sentence_end + 1
    else:
        last_space = trimmed[:160].rfind(" ")
        cut_at = last_space if last_space > 60 else 160
    return f"{trimmed[:cut_at].strip()}\n{trimmed[cut_at:].strip()}"


def resume_text_of(items: list[WorkspaceItemResponse]) -> str:
    """Everything the standard resume would contain, lower-cased for keyword hits."""
    return " \n ".join(
        " ".join([item.title, item.organization or "", *item.tags, *item.bullets]) for item in items
    ).lower()


def _keyword_present(resume_text: str, keyword: str) -> bool:
    """Is this keyword readable in the resume text?

    Uses the taxonomy when the keyword names a known skill so aliases count
    ("integration tests" answers "Automated testing"), and whole-word matching
    either way so "reactive" never counts as "React".
    """
    skill = find_skill_by_term(keyword)
    if skill is not None:
        return mentions_skill(resume_text, skill)
    return mentions_term(resume_text, keyword)


def compute_ats_report(
    items: list[WorkspaceItemResponse], requirements: list[Requirement]
) -> AtsReport:
    issues: list[AtsIssue] = []
    examples: list[AtsExample] = []
    checks: list[AtsCheck] = []

    sections_present = {item.section for item in items}

    # 1. Standard headings ---------------------------------------------------
    missing_headings = [
        heading for heading in EXPECTED_HEADINGS if heading[0] not in sections_present
    ]
    if missing_headings:
        labels = [label for _, label in missing_headings]
        issue = AtsIssue(
            id="ats-headings",
            severity="med",
            message=f"No {', '.join(labels)} content to place under a standard heading.",
            fix=(
                f"Add {', '.join(label.lower() for label in labels)} items in your workspace "
                "— parsers look for those headings."
            ),
            check="Standard headings",
        )
        issues.append(issue)
        checks.append(
            AtsCheck(
                id="headings",
                label="Standard section headings",
                status="issue",
                detail=f"Missing: {', '.join(labels)}.",
                issueIds=[issue.id],
            )
        )
    else:
        checks.append(
            AtsCheck(
                id="headings",
                label="Standard section headings",
                status="pass",
                detail="Education, experience, projects and skills all have content.",
                issueIds=[],
            )
        )

    # 2. Month-precision dates ----------------------------------------------
    undated = [
        item
        for item in items
        if item.section in ("experience", "internship", "education") and not item.startDate
    ]
    if undated:
        count = len(undated)
        issue = AtsIssue(
            id="ats-dates",
            severity="med",
            message=(
                f"{count} dated section {'item has' if count == 1 else 'items have'} no start date."
            ),
            fix="Add a month-precision start date (YYYY-MM) to each role and qualification.",
            check="Dates present",
        )
        issues.append(issue)
        checks.append(
            AtsCheck(
                id="dates",
                label="Month-precision dates",
                status="issue",
                detail=", ".join(item.title for item in undated),
                issueIds=[issue.id],
            )
        )
    else:
        checks.append(
            AtsCheck(
                id="dates",
                label="Month-precision dates",
                status="pass",
                detail="Every role and qualification carries a start date.",
                issueIds=[],
            )
        )

    first_dated = next(
        (item for item in items if item.startDate and item.endDate and item.section != "skill"),
        None,
    )
    if first_dated is not None:
        examples.append(
            AtsExample(
                id="example-dates",
                issueId="ats-dates" if undated else "ats-format",
                before=_header_line(first_dated, "iso"),
                after=_header_line(first_dated, "label"),
                note=(
                    "Formatting only — the same dates, rendered the way people read them. "
                    "No detail was invented."
                ),
            )
        )

    # 3. Detail lines --------------------------------------------------------
    empty_detail = [item for item in items if item.section in _DETAIL_SECTIONS and not item.bullets]
    if empty_detail:
        count = len(empty_detail)
        issue = AtsIssue(
            id="ats-bullets",
            severity="med",
            message=(f"{count} {'entry has' if count == 1 else 'entries have'} no detail lines."),
            fix=(
                "Add one or two lines describing what you did and what changed, using "
                "numbers you can defend."
            ),
            check="Detail lines",
        )
        issues.append(issue)
        checks.append(
            AtsCheck(
                id="bullets",
                label="Detail lines on roles and projects",
                status="issue",
                detail=", ".join(item.title for item in empty_detail),
                issueIds=[issue.id],
            )
        )
    elif any(item.section in _DETAIL_SECTIONS for item in items):
        checks.append(
            AtsCheck(
                id="bullets",
                label="Detail lines on roles and projects",
                status="pass",
                detail="Every role and project has at least one detail line.",
                issueIds=[],
            )
        )

    # 4. Overlong lines ------------------------------------------------------
    long_bullets = [
        (item, bullet.strip())
        for item in items
        for bullet in item.bullets
        if len(bullet.strip()) > 200
    ]
    if long_bullets:
        count = len(long_bullets)
        issue = AtsIssue(
            id="ats-long-lines",
            severity="low",
            message=(
                f"{count} detail {'line runs' if count == 1 else 'lines run'} past 200 characters."
            ),
            fix="Split long lines into two shorter ones so a reader can scan them.",
            check="Line length",
        )
        issues.append(issue)
        checks.append(
            AtsCheck(
                id="line-length",
                label="Scannable line length",
                status="issue",
                detail=", ".join(item.title for item, _ in long_bullets),
                issueIds=[issue.id],
            )
        )
        sample = long_bullets[0]
        examples.append(
            AtsExample(
                id="example-long-line",
                issueId=issue.id,
                before=sample[1],
                after=split_bullet(sample[1]),
                note=(
                    "Formatting only — the same sentence, broken in two. "
                    "No words were added or removed."
                ),
            )
        )
    elif any(item.section in _DETAIL_SECTIONS for item in items):
        checks.append(
            AtsCheck(
                id="line-length",
                label="Scannable line length",
                status="pass",
                detail="No detail line is over 200 characters.",
                issueIds=[],
            )
        )

    # 5. Keyword coverage (PRD §6.7) ----------------------------------------
    # A keyword is a *term*, not a sentence. Only the skill requirements become
    # keywords: experience, education and seniority lines are prose, and
    # counting them would report "50% coverage" for a fully evidenced posting.
    resume_text = resume_text_of(items)
    keywords = [
        AtsKeyword(
            keyword=requirement.text,
            present=_keyword_present(resume_text, requirement.text),
            requirementId=requirement.id,
        )
        for requirement in requirements
        if not requirement.pattern
    ]
    present = sum(1 for keyword in keywords if keyword.present)
    coverage = 0 if not keywords else js_round((present / len(keywords)) * 100)

    if keywords:
        if coverage < 60:
            issue = AtsIssue(
                id="ats-keywords",
                severity="high" if coverage < 40 else "med",
                message=(
                    f"Only {coverage}% of this job's keywords appear in the text of your "
                    f"resume ({present} of {len(keywords)})."
                ),
                fix=(
                    "Add the keywords you can honestly back with evidence; the gaps list "
                    "below shows which ones need a new project or course first."
                ),
                check="Keyword coverage",
            )
            issues.append(issue)
            checks.append(
                AtsCheck(
                    id="keywords",
                    label="Job keywords present",
                    status="issue",
                    detail=(
                        f"{coverage}% coverage — missing "
                        f"{', '.join(k.keyword for k in keywords if not k.present)}."
                    ),
                    issueIds=[issue.id],
                )
            )
        else:
            checks.append(
                AtsCheck(
                    id="keywords",
                    label="Job keywords present",
                    status="pass",
                    detail=f"{coverage}% coverage ({present} of {len(keywords)} terms).",
                    issueIds=[],
                )
            )

    # 6. Contact details -----------------------------------------------------
    if "personal" not in sections_present:
        issue = AtsIssue(
            id="ats-contact",
            severity="low",
            message="No personal details item, so the resume has no header block.",
            fix="Add a personal details item with the name and links you want shown.",
            check="Contact block",
        )
        issues.append(issue)
        checks.append(
            AtsCheck(
                id="contact",
                label="Contact block present",
                status="issue",
                detail="No personal details item.",
                issueIds=[issue.id],
            )
        )
    else:
        checks.append(
            AtsCheck(
                id="contact",
                label="Contact block present",
                status="pass",
                detail="Personal details item found.",
                issueIds=[],
            )
        )

    # 7. Layout -- honestly not checked yet ----------------------------------
    checks.append(
        AtsCheck(
            id="layout",
            label="Single-column layout",
            status="not_checked",
            detail=(
                "Layout checks run on the rendered PDF, which lands with export in F5. "
                "Nothing is claimed about it yet."
            ),
            issueIds=[],
        )
    )

    penalty = sum(PENALTY[issue.severity] for issue in issues)

    return AtsReport(
        score=max(0, min(100, 100 - penalty)),
        keywordCoverage=coverage,
        keywords=keywords,
        checks=checks,
        issues=issues,
        examples=examples,
    )
