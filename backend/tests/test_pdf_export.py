"""B6 PDF export: layout, text round trip and the route contract.

The renderer is tested twice: directly (bytes -> extracted text -> every heading
and claim found) and through the API (streamed response, check headers, the
mandatory 502 when the check fails). No real network or database is involved.
"""

from __future__ import annotations

import io
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.ai.consent import InMemoryConsentStore
from app.api.deps import (
    get_resume_repository,
    get_target_repository,
    get_workspace_repository,
)
from app.core.config import Settings
from app.export.errors import ExportCheck
from app.export.pdf import (
    pdf_filename,
    render_and_verify,
    render_pdf,
    verify_pdf,
    visible_sections,
)
from app.main import create_app
from app.repositories.memory import InMemoryWorkspaceRepository
from app.repositories.resume_memory import InMemoryResumeRepository
from app.repositories.target_memory import InMemoryTargetRepository
from app.schemas.resume import Claim, ResumeResponse, ResumeSection
from tests.conftest import FIXED_CLOCK, TEST_SUBJECT
from tests.test_resumes_api import BASE, generate, headers_for, prepare, seed_items, seed_workspace

USER_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def make_resume(*, removed: bool = True) -> ResumeResponse:
    return ResumeResponse(
        id="resume-test",
        kind="tailored",
        targetId="target-1",
        title="Senior Frontend Engineer at Acme",
        workspaceVersion=4,
        stale=False,
        sections=[
            ResumeSection(
                key="personal",
                claims=[
                    Claim(
                        text="Alex Doe · alex@example.com",
                        evidenceIds=["item-personal"],
                        confirmed=True,
                    )
                ],
            ),
            ResumeSection(
                key="experience",
                claims=[
                    Claim(
                        text="Senior Frontend Engineer · Acme · 2021-01 – 2024-01",
                        evidenceIds=["item-experience"],
                        confirmed=True,
                    ),
                    Claim(
                        text="Built the café dashboard – 20% faster.",
                        evidenceIds=["item-experience"],
                        confirmed=True,
                    ),
                    Claim(
                        text="Deleted secret project",
                        evidenceIds=["item-deleted"],
                        confirmed=True,
                        removed=removed,
                    ),
                ],
            ),
            ResumeSection(key="skill", claims=[]),
        ],
        createdAt=FIXED_CLOCK,
        updatedAt=FIXED_CLOCK,
    )


def extract_text(pdf_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return " ".join(page.extract_text() or "" for page in reader.pages)


def test_render_round_trip_finds_every_heading_and_claim() -> None:
    resume = make_resume()
    pdf_bytes, headings, claims = render_pdf(resume)

    assert pdf_bytes.startswith(b"%PDF")
    assert headings == ["Contact", "Experience"]
    assert claims[0] == "Alex Doe · alex@example.com"

    check = verify_pdf(pdf_bytes, headings, claims)
    assert check.passed is True
    assert check.sections_checked == 2
    assert check.claims_checked == 3
    assert check.sections_missing == 0
    assert check.claims_missing == 0

    extracted = extract_text(pdf_bytes)
    assert "Senior Frontend Engineer" in extracted
    assert "café" in extracted
    # The PDF carries no product branding or watermark text.
    assert "ResumeIQ" not in extracted


def test_removed_claims_are_never_printed() -> None:
    resume = make_resume(removed=True)
    sections = visible_sections(resume)

    assert [section.key for section in sections] == ["personal", "experience"]
    texts = [claim.text for section in sections for claim in section.claims]
    assert "Deleted secret project" not in texts

    pdf_bytes, check = render_and_verify(resume)
    assert check.passed is True
    assert "Deleted secret project" not in extract_text(pdf_bytes)


def test_verification_detects_a_missing_claim() -> None:
    pdf_bytes, headings, claims = render_pdf(make_resume())
    check = verify_pdf(pdf_bytes, headings, [*claims, "Invented achievement"])

    assert check.passed is False
    assert check.claims_checked == 4
    assert check.claims_missing == 1
    assert check.headers()["X-Export-Text-Check"] == "failed"


def test_filename_is_ascii_and_header_safe() -> None:
    assert pdf_filename(make_resume()) == "senior-frontend-engineer-at-acme.pdf"
    assert (
        pdf_filename(make_resume().model_copy(update={"title": "Résumé — 2026"}))
        == "resume-2026.pdf"
    )
    assert pdf_filename(make_resume().model_copy(update={"title": "  "})) == "resume.pdf"


@pytest.fixture()
def resume_repo() -> InMemoryResumeRepository:
    return InMemoryResumeRepository(clock=lambda: FIXED_CLOCK)


@pytest.fixture()
def target_repo() -> InMemoryTargetRepository:
    return InMemoryTargetRepository(clock=lambda: FIXED_CLOCK)


@pytest.fixture()
def client(
    settings: Settings,
    fake_repo: InMemoryWorkspaceRepository,
    target_repo: InMemoryTargetRepository,
    resume_repo: InMemoryResumeRepository,
) -> TestClient:
    app = create_app(settings)
    app.dependency_overrides[get_workspace_repository] = lambda: fake_repo
    app.dependency_overrides[get_target_repository] = lambda: target_repo
    app.dependency_overrides[get_resume_repository] = lambda: resume_repo
    app.state.ai_consent_store = InMemoryConsentStore(granted={TEST_SUBJECT, USER_B})
    app.state.analysis_enricher = None
    app.state.resume_reworder = None
    return TestClient(app)


def test_pdf_route_streams_a_verified_tailored_resume(
    client: TestClient, fake_repo: InMemoryWorkspaceRepository
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(client, headers)
    resume = generate(client, headers, target_id)

    response = client.get(f"{BASE}/resumes/{resume['id']}/export.pdf", headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["x-export-text-check"] == "passed"
    assert int(response.headers["x-export-claims-checked"]) > 0
    assert response.headers["x-export-claims-missing"] == "0"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["cache-control"] == "no-store"
    assert response.content.startswith(b"%PDF")

    extracted = extract_text(response.content)
    first_claim = resume["sections"][0]["claims"][0]["text"]
    assert first_claim in extracted
    assert "ResumeIQ" not in extracted


def test_pdf_export_exposes_its_check_headers_to_the_allowed_origin(
    client: TestClient, fake_repo: InMemoryWorkspaceRepository
) -> None:
    """A browser must be able to read the extraction check it is asked to trust.

    The UI only downloads a PDF after reading `X-Export-Text-Check`; without
    `Access-Control-Expose-Headers` the browser hides every check header and the
    fail-closed button refuses a perfectly good export.
    """
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = {**headers_for(TEST_SUBJECT), "Origin": "http://localhost:3000"}

    response = client.get(f"{BASE}/resumes/resume-standard/export.pdf", headers=headers)

    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    exposed = {
        name.strip().lower()
        for name in response.headers["access-control-expose-headers"].split(",")
    }
    assert {
        "content-disposition",
        "x-export-text-check",
        "x-export-sections-checked",
        "x-export-sections-missing",
        "x-export-claims-checked",
        "x-export-claims-missing",
    } <= exposed


def test_pdf_route_exports_the_derived_standard_resume(
    client: TestClient, fake_repo: InMemoryWorkspaceRepository
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)

    response = client.get(f"{BASE}/resumes/resume-standard/export.pdf", headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers["x-export-text-check"] == "passed"
    extracted = extract_text(response.content)
    assert "Alex Doe" in extracted


def test_pdf_route_requires_auth_and_is_user_scoped(
    client: TestClient, fake_repo: InMemoryWorkspaceRepository
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(client, headers)
    resume = generate(client, headers, target_id)

    assert client.get(f"{BASE}/resumes/{resume['id']}/export.pdf").status_code == 401
    other = client.get(f"{BASE}/resumes/{resume['id']}/export.pdf", headers=headers_for(USER_B))
    assert other.status_code == 404
    assert other.json()["detail"]["code"] == "resume_not_found"


def test_failed_text_check_returns_502_and_never_the_pdf(
    client: TestClient,
    fake_repo: InMemoryWorkspaceRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_workspace(fake_repo, TEST_SUBJECT, seed_items())
    headers = headers_for(TEST_SUBJECT)
    target_id = prepare(client, headers)
    resume = generate(client, headers, target_id)

    def failing_check(_resume: ResumeResponse) -> tuple[bytes, ExportCheck]:
        return b"%PDF-1.4 not-a-real-pdf", ExportCheck(
            sections_checked=2, sections_missing=1, claims_checked=3, claims_missing=2
        )

    monkeypatch.setattr("app.api.v1.resumes.render_and_verify", failing_check)
    response = client.get(f"{BASE}/resumes/{resume['id']}/export.pdf", headers=headers)

    assert response.status_code == 502
    body: dict[str, Any] = response.json()
    assert body["detail"]["code"] == "export_verification_failed"
    assert response.headers["x-export-text-check"] == "failed"
    assert response.headers["x-export-sections-missing"] == "1"
    assert response.headers["x-export-claims-missing"] == "2"
    assert response.content.startswith(b"{")  # JSON error, not the failed PDF
