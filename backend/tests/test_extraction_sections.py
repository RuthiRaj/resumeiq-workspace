"""Deterministic section-parser tests (pure text, no documents).

The parser never invents a value: every assertion here is about text that is
present in the input. Dates are month precision or a bare year shown as read.
"""

from __future__ import annotations

from app.extraction.plaintext import normalize_lines
from app.extraction.sections import heading_section, parse_sections
from app.repositories.imports import initial_values
from app.schemas.imports import ExtractedField, ExtractionItem

RESUME = """\
EXAMPLE CANDIDATE
Example City, EX
example.candidate@example.com

EXPERIENCE
Backend Intern
Example Payments Ltd
Jan 2024 - Sep 2024
- Built an internal reporting endpoint used by the support team.
- Wrote integration tests for the payments webhook.

Junior Developer
Example Software Co
2021 - 2022
- Maintained a legacy reporting tool.

PROJECTS
Example Budget Tracker
Technologies: TypeScript, React
- Built a budgeting app for a fictional household.

EDUCATION
BSc Computer Science
Example University
2019 - 2022

SKILLS
TypeScript, React, Python, PostgreSQL

CERTIFICATIONS
AWS Certified Cloud Practitioner
Amazon Web Services
Mar 2023
"""


def parse(text: str) -> list[ExtractionItem]:
    return parse_sections(normalize_lines(text))


def of(items: list[ExtractionItem], section: str) -> list[ExtractionItem]:
    return [item for item in items if item.section == section]


def value(item: ExtractionItem, key: str) -> str | None:
    for field in item.fields:
        if field.key == key:
            return field.value
    return None


def field(item: ExtractionItem, key: str) -> ExtractedField | None:
    for candidate in item.fields:
        if candidate.key == key:
            return candidate
    return None


def test_full_resume_extracts_the_expected_sections() -> None:
    items = parse(RESUME)
    sections = {item.section for item in items}
    assert {"personal", "experience", "project", "education", "skill", "certificate"} <= sections
    assert len(of(items, "experience")) == 2
    assert len(of(items, "skill")) == 4
    assert len(of(items, "education")) == 1
    assert len(of(items, "certificate")) == 1


def test_item_ids_are_unique() -> None:
    items = parse(RESUME)
    ids = [item.id for item in items]
    assert len(ids) == len(set(ids))


def test_skills_become_one_item_each() -> None:
    skills = [value(item, "title") for item in of(parse(RESUME), "skill")]
    assert skills == ["TypeScript", "React", "Python", "PostgreSQL"]
    assert all(item.confidence == 0.8 for item in of(parse(RESUME), "skill"))


def test_month_name_dates_are_month_precision() -> None:
    experience = of(parse(RESUME), "experience")[0]
    assert value(experience, "title") == "Backend Intern"
    assert value(experience, "organization") == "Example Payments Ltd"
    assert value(experience, "startDate") == "2024-01"
    assert value(experience, "endDate") == "2024-09"
    assert experience.bullets == [
        "Built an internal reporting endpoint used by the support team.",
        "Wrote integration tests for the payments webhook.",
    ]


def test_bare_year_is_shown_as_read_but_never_becomes_a_value() -> None:
    junior = of(parse(RESUME), "experience")[1]
    # The extraction shows exactly what the document said...
    assert value(junior, "startDate") == "2021"
    assert value(junior, "endDate") == "2022"
    # ...but the editable value stays empty: no month may be invented.
    values = initial_values(junior)
    assert values.startDate == ""
    assert values.endDate == ""


def test_iso_and_slash_dates_are_understood() -> None:
    items = parse("EXPERIENCE\nBackend Intern\nExample Co\n2024-01 to 2024-09\n")
    entry = of(items, "experience")[0]
    assert value(entry, "startDate") == "2024-01"
    assert value(entry, "endDate") == "2024-09"

    items = parse("EXPERIENCE\nBackend Intern\nExample Co\n01/2024 - 09/2024\n")
    entry = of(items, "experience")[0]
    assert value(entry, "startDate") == "2024-01"
    assert value(entry, "endDate") == "2024-09"


def test_odd_date_formats_do_not_crash_and_keep_the_year() -> None:
    for odd in ("Sept. 2019", "Fall 2020", "2020/01", "Since 2018"):
        items = parse(f"EXPERIENCE\nBackend Intern\nExample Co\n{odd}\n")
        assert of(items, "experience"), odd
        entry = of(items, "experience")[0]
        assert value(entry, "startDate") is not None, odd


def test_ongoing_role_has_no_end_field() -> None:
    items = parse("EXPERIENCE\nBackend Intern\nExample Co\nJan 2024 - Present\n")
    entry = of(items, "experience")[0]
    assert value(entry, "startDate") == "2024-01"
    assert field(entry, "endDate") is None


def test_table_row_is_split_into_title_employer_and_dates() -> None:
    items = parse(
        "EXPERIENCE\n"
        "Backend Intern | Example Payments Ltd | Jan 2024 - Sep 2024\n"
        "Junior Developer | Example Software Co | 2021 - 2022\n"
    )
    experience = of(items, "experience")
    assert len(experience) == 2
    assert value(experience[0], "title") == "Backend Intern"
    assert value(experience[0], "organization") == "Example Payments Ltd"
    assert value(experience[0], "startDate") == "2024-01"
    assert value(experience[1], "title") == "Junior Developer"
    assert value(experience[1], "organization") == "Example Software Co"


def test_projects_carry_technologies_as_tags() -> None:
    project = of(parse(RESUME), "project")[0]
    assert value(project, "title") == "Example Budget Tracker"
    assert project.tags == ["TypeScript", "React"]


def test_education_keeps_degree_and_institution() -> None:
    education = of(parse(RESUME), "education")[0]
    assert value(education, "title") == "BSc Computer Science"
    assert value(education, "organization") == "Example University"


def test_certificate_keeps_issuer_and_issue_date() -> None:
    certificate = of(parse(RESUME), "certificate")[0]
    assert value(certificate, "title") == "AWS Certified Cloud Practitioner"
    assert value(certificate, "organization") == "Amazon Web Services"
    assert value(certificate, "startDate") == "2023-03"


def test_missing_sections_produce_no_items() -> None:
    # Text with no recognisable heading produces nothing at all.
    assert parse("Just a paragraph about nothing in particular, no headings here.") == []
    assert parse("") == []


def test_only_the_sections_that_exist_are_extracted() -> None:
    items = parse("EXAMPLE CANDIDATE\nSKILLS\nTypeScript, Python\n")
    assert {item.section for item in items} == {"personal", "skill"}


def test_confidence_is_the_weakest_field() -> None:
    for item in parse(RESUME):
        assert item.confidence == min(field.confidence for field in item.fields)
        assert 0.0 <= item.confidence <= 1.0


def test_source_lines_point_at_the_text_they_came_from() -> None:
    lines = normalize_lines(RESUME)
    for item in parse(RESUME):
        for candidate in item.fields:
            assert 1 <= candidate.sourceLine <= len(lines)
            assert lines[candidate.sourceLine - 1].strip() != ""
        title = field(item, "title")
        assert title is not None
        # The title is copied from that line (table rows put it first).
        assert title.value in lines[title.sourceLine - 1]


def test_heading_detection_rules() -> None:
    assert heading_section("Skills", False) == "skill"
    assert heading_section("TECHNICAL SKILLS", False) == "skill"
    assert heading_section("Work Experience:", False) == "experience"
    assert heading_section("- Skills", False) is None
    assert heading_section("Experience 2020", True) is None
    assert heading_section("Backend Intern", False) is None
    assert heading_section("A" * 60, False) is None
    assert heading_section("example@example.com", False) is None


def test_personal_item_needs_a_name_like_first_line() -> None:
    assert of(parse("Contact\n123 Example Street\n"), "personal") == []
    personal = of(parse("EXAMPLE CANDIDATE\nExample City, EX\n"), "personal")
    assert len(personal) == 1
    assert value(personal[0], "title") == "EXAMPLE CANDIDATE"
    assert value(personal[0], "location") == "Example City, EX"
