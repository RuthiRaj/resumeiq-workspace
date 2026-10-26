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


# ---------------------------------------------------------------------------
# Test with the user's resume format (fake personal data, real structure)
# ---------------------------------------------------------------------------

SPYNE_RESUME = (
    "Jane Doe\n"
    "Software Development Engineer Intern Candidate\n"
    "Hyderabad, Telangana\n"
    "+91 98765 43210\n"
    "jane.doe@example.com\n"
    "https://github.com/janedoe\n"
    "https://linkedin.com/in/janedoe\n"
    "\n"
    "Computer Science (AI & ML) undergraduate with hands-on full-stack project "
    "experience building and shipping React/TypeScript applications with "
    "Firebase-backed data layers and REST API integrations. Comfortable working "
    "across frontend and backend, debugging issues end-to-end, and picking up "
    "new tools quickly.\n"
    "\n"
    "EDUCATION\n"
    "B.Tech in Computer Science Engineering (Data Science), Direct Entry\n"
    "Example Institute of Technology, Example City, Example State\n"
    "2024 - 2028\n"
    "\n"
    "Diploma in Computer Engineering\n"
    "Sample College of Engineering, Sample City, Sample State\n"
    "2021 - 2024\n"
    "Grade: 8.50\n"
    "\n"
    "PROJECTS\n"
    "TaskFlow\n"
    "Technologies: React, TypeScript, JavaScript, Firebase, Firestore\n"
    "Built a full-stack web application in React and TypeScript to help users "
    "manage tasks and collaborate with team members.\n"
    "Designed and implemented user profiles, project-based task organization, "
    "real-time updates, and authentication using Firebase/Firestore as the "
    "backend data layer.\n"
    "Developed reusable, component-based frontend architecture and integrated it "
    "with backend services via REST-style data calls.\n"
    "Debugged and iterated on user interaction workflows, continuing to "
    "extend and improve the application post-launch.\n"
    "\n"
    "CodeLens AI\n"
    "Technologies: Python, FastAPI, REST API, RAG, FAISS\n"
    "Built a backend application with FastAPI, exposing REST API endpoints to "
    "let users upload code repositories and query them for AI-generated "
    "insights.\n"
    "Implemented a code-processing pipeline (extraction, chunking, retrieval) "
    "and integrated it with LLM APIs to ground responses in source content.\n"
    "Added file/function-level citation tracking to improve traceability of API "
    "responses, and tested the service locally end-to-end.\n"
    "\n"
    "ApeX - Freelance Web Development Project\n"
    "Technologies: Web Development\n"
    "Co-developed a web application with a friend as an early freelance "
    "initiative, building and iterating on features collaboratively.\n"
    "Worked on turning application ideas into functional web experiences "
    "through iterative development and feedback.\n"
    "\n"
    "SKILLS\n"
    "Languages: JavaScript, TypeScript, Python\n"
    "Frontend: React.js, HTML, CSS\n"
    "Backend / Databases: REST API Integration, Firebase, Firestore, Supabase, FastAPI\n"
    "AI / GenAI: RAG, LLM Applications, Groq API, OpenAI, Gemini, Claude, LLaMA\n"
    "Tools: Git, GitHub\n"
    "\n"
    "CERTIFICATIONS\n"
    "Cloud AI Fundamentals\n"
    "Google Cloud\n"
    "June 2024\n"
    "\n"
    "Python Essentials 1\n"
    "Cisco Networking Academy\n"
    "July 2026\n"
)


def test_spyne_resume_format_extracts_all_sections() -> None:
    """Test the exact resume format from the user's PDF (with fake personal data)."""
    items = parse(SPYNE_RESUME)
    sections = {item.section for item in items}
    expected_sections = {
        "personal",
        "education",
        "project",
        "skill",
        "certificate",
    }
    assert expected_sections <= sections
    # Experience, internship, achievement, extracurricular, course,
    # publication, training should be empty
    assert "experience" not in sections
    assert "internship" not in sections


def test_spyne_personal_extracts_name_location_headline_contacts_summary() -> None:
    """Personal section extracts name, location, headline, phone, email, "
    "GitHub, LinkedIn, summary."""
    personal = of(parse(SPYNE_RESUME), "personal")
    assert len(personal) == 1
    p = personal[0]
    assert value(p, "title") == "Jane Doe"
    assert value(p, "location") == "Hyderabad, Telangana"

    # Headline stored in organization with label "Headline"
    org_fields = [f for f in p.fields if f.key == "organization"]
    org_labels = {f.label: f.value for f in org_fields}
    assert org_labels.get("Headline") == "Software Development Engineer Intern Candidate"
    assert org_labels.get("Phone") == "+91 98765 43210"
    assert org_labels.get("Email") == "jane.doe@example.com"
    assert org_labels.get("GitHub") == "https://github.com/janedoe"
    assert org_labels.get("LinkedIn") == "https://linkedin.com/in/janedoe"
    assert "Summary" in org_labels
    assert "Computer Science (AI & ML) undergraduate" in org_labels["Summary"]


def test_spyne_education_maps_degree_to_title_institution_to_organization() -> None:
    """Education: degree/diploma -> title (Qualification); college name "
    "-> organization (Institution)."""
    education = of(parse(SPYNE_RESUME), "education")
    assert len(education) == 2

    # First education entry
    edu1 = education[0]
    assert value(edu1, "title") == (
        "B.Tech in Computer Science Engineering (Data Science), Direct Entry"
    )
    assert value(edu1, "organization") == (
        "Example Institute of Technology, Example City, Example State"
    )
    # Bare years shown as read, not month-precision
    assert value(edu1, "startDate") == "2024"
    assert value(edu1, "endDate") == "2028"
    # But editable values should be empty (no month invented)
    vals1 = initial_values(edu1)
    assert vals1.startDate == ""
    assert vals1.endDate == ""

    # Second education entry
    edu2 = education[1]
    assert value(edu2, "title") == "Diploma in Computer Engineering"
    assert value(edu2, "organization") == (
        "Sample College of Engineering, Sample City, Sample State"
    )
    assert value(edu2, "startDate") == "2021"
    assert value(edu2, "endDate") == "2024"
    vals2 = initial_values(edu2)
    assert vals2.startDate == ""
    assert vals2.endDate == ""


def test_spyne_projects_keep_bullets_grouped_and_tags_parsed() -> None:
    """Projects: bullets stay grouped under correct project; tags parsed from Technologies line."""
    projects = of(parse(SPYNE_RESUME), "project")
    assert len(projects) == 3

    # TaskFlow
    p1 = projects[0]
    assert value(p1, "title") == "TaskFlow"
    assert p1.tags == ["React", "TypeScript", "JavaScript", "Firebase", "Firestore"]
    assert len(p1.bullets) == 4
    assert "manage tasks and collaborate with team members" in p1.bullets[0]
    assert "project-based task organization" in p1.bullets[1]
    assert "component-based frontend architecture" in p1.bullets[2]
    assert "Debugged and iterated" in p1.bullets[3]
    # No organization for projects without explicit context
    assert value(p1, "organization") is None

    # CodeLens AI
    p2 = projects[1]
    assert value(p2, "title") == "CodeLens AI"
    assert p2.tags == ["Python", "FastAPI", "REST API", "RAG", "FAISS"]
    assert len(p2.bullets) == 3
    assert "upload code repositories" in p2.bullets[0]
    assert "code-processing pipeline" in p2.bullets[1]
    assert "file/function-level citation tracking" in p2.bullets[2]
    assert value(p2, "organization") is None

    # ApeX
    p3 = projects[2]
    assert value(p3, "title") == "ApeX - Freelance Web Development Project"
    assert p3.tags == ["Web Development"]
    assert len(p3.bullets) == 2
    assert "freelance initiative" in p3.bullets[0]
    assert "iterative development and feedback" in p3.bullets[1]
    assert value(p3, "organization") is None


def test_spyne_skills_grouped_by_category_no_prefix() -> None:
    """Skills: category lines stripped, each skill becomes separate item without category prefix."""
    skills = of(parse(SPYNE_RESUME), "skill")
    skill_titles = [t for s in skills if (t := value(s, "title")) is not None]

    # Languages category
    assert "JavaScript" in skill_titles
    assert "TypeScript" in skill_titles
    assert "Python" in skill_titles
    # No "Languages: JavaScript" prefix
    assert not any("Languages:" in t for t in skill_titles)

    # Frontend category
    assert "React.js" in skill_titles
    assert "HTML" in skill_titles
    assert "CSS" in skill_titles
    assert not any("Frontend:" in t for t in skill_titles)

    # Backend / Databases category
    assert "REST API Integration" in skill_titles
    assert "Firebase" in skill_titles
    assert "Firestore" in skill_titles
    assert "Supabase" in skill_titles
    assert "FastAPI" in skill_titles
    assert not any("Backend" in t or "Databases:" in t for t in skill_titles)

    # AI / GenAI category
    assert "RAG" in skill_titles
    assert "LLM Applications" in skill_titles
    assert "Groq API" in skill_titles
    assert "OpenAI" in skill_titles
    assert "Gemini" in skill_titles
    assert "Claude" in skill_titles
    assert "LLaMA" in skill_titles
    assert not any("AI / GenAI:" in t or "GenAI:" in t for t in skill_titles)

    # Tools category
    assert "Git" in skill_titles
    assert "GitHub" in skill_titles
    assert not any("Tools:" in t for t in skill_titles)

    # Total count
    assert len(skills) == 20


def test_spyne_certifications_extract_title_issuer_date() -> None:
    """Certifications: title, issuer (organization), and month-precision date."""
    certs = of(parse(SPYNE_RESUME), "certificate")
    assert len(certs) == 2

    cert1 = certs[0]
    assert value(cert1, "title") == "Cloud AI Fundamentals"
    assert value(cert1, "organization") == "Google Cloud"
    assert value(cert1, "startDate") == "2024-06"  # June 2024 -> month precision

    cert2 = certs[1]
    assert value(cert2, "title") == "Python Essentials 1"
    assert value(cert2, "organization") == "Cisco Networking Academy"
    assert value(cert2, "startDate") == "2026-07"


def test_spyne_bare_year_dates_not_invented_month_precision() -> None:
    """Bare year dates are shown as read but never become month-precision values."""
    education = of(parse(SPYNE_RESUME), "education")
    for edu in education:
        # Extraction shows bare year (from fixture: 2024-2028 and 2021-2024)
        assert value(edu, "startDate") in ("2024", "2021")
        assert value(edu, "endDate") in ("2028", "2024")
        # But initial_values (editable) are empty
        vals = initial_values(edu)
        assert vals.startDate == ""
        assert vals.endDate == ""
