"""Import API contract tests (in-memory repositories, real PDF/DOCX parsing).

These tests exercise the whole B2 flow over synthetic documents: upload →
review → confirm. The two rules the brief insists on are asserted directly:

* nothing enters the workspace until the user confirms an item, and
* a confirmed item is *attested* unless a certificate was attached.
"""

from __future__ import annotations

import logging

from fastapi.testclient import TestClient

from app.api.deps import get_import_repository
from app.core.config import Settings
from app.main import create_app
from app.repositories.import_memory import InMemoryImportRepository
from app.repositories.memory import InMemoryWorkspaceRepository
from tests.conftest import make_token
from tests.synthetic_documents import (
    build_docx,
    build_pdf,
    build_scanned_pdf,
    build_zip_with_entries,
)

BASE = "/api/v1"

RESUME_LINES = [
    "EXAMPLE CANDIDATE",
    "Example City, EX",
    "example.candidate@example.com",
    "",
    "EXPERIENCE",
    "Backend Intern",
    "Example Payments Ltd",
    "Jan 2024 - Sep 2024",
    "- Built an internal reporting endpoint for the support team.",
    "",
    "EDUCATION",
    "BSc Computer Science",
    "Example University",
    "Sep 2019 - Jun 2022",
    "",
    "SKILLS",
    "TypeScript, Python",
]

PDF_RESUME = build_pdf([RESUME_LINES])
DOCX_RESUME = build_docx(RESUME_LINES)


def upload(
    client: TestClient,
    headers: dict[str, str],
    *,
    name: str = "resume.pdf",
    data: bytes = PDF_RESUME,
    content_type: str = "application/pdf",
) -> object:
    return client.post(
        f"{BASE}/imports",
        files={"file": (name, data, content_type)},
        headers=headers,
    )


def session_of(response: object) -> dict[str, object]:
    assert response.status_code == 201, response.text  # type: ignore[attr-defined]
    return response.json()["import"]  # type: ignore[attr-defined]


def item_of(session: dict[str, object], section: str) -> dict[str, object]:
    items = session["items"]
    assert isinstance(items, list)
    return next(i for i in items if i["extraction"]["section"] == section)


def test_upload_requires_authentication(import_client: TestClient) -> None:
    assert import_client.get(f"{BASE}/imports").status_code == 401
    assert upload(import_client, {}).status_code == 401


def test_upload_requires_a_file(import_client: TestClient, auth_headers: dict[str, str]) -> None:
    response = import_client.post(f"{BASE}/imports", headers=auth_headers)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "import_file_required"


def test_upload_returns_a_review_session(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))

    assert session["fileName"] == "resume.pdf"
    assert session["fileType"] == "pdf"
    assert session["fileSize"] == len(PDF_RESUME)
    assert session["pageCount"] == 1
    assert session["previewAvailable"] is True
    assert "Backend Intern" in session["sourceText"]
    assert session["createdAt"] and session["updatedAt"]

    items = session["items"]
    assert isinstance(items, list) and items
    for item in items:
        assert item["status"] == "pending"
        assert item["extraction"]["fields"]
        assert item["extraction"]["section"]
        # Nullable review fields are omitted, matching the frontend Zod shape.
        assert "support" not in item
        assert "decidedAt" not in item


def test_upload_accepts_a_docx(import_client: TestClient, auth_headers: dict[str, str]) -> None:
    session = session_of(
        upload(
            import_client,
            auth_headers,
            name="resume.docx",
            data=DOCX_RESUME,
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    )
    assert session["fileType"] == "docx"
    assert session["pageCount"] == 1  # DOCX records no page count; we do not invent one
    assert item_of(session, "experience")["values"]["title"] == "Backend Intern"


def test_extraction_reports_confidence_and_source_lines(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    for item in session["items"]:
        assert 0.0 <= item["extraction"]["confidence"] <= 1.0
        for field in item["extraction"]["fields"]:
            assert 0.0 <= field["confidence"] <= 1.0
            assert field["sourceLine"] >= 1


def test_upload_rejects_an_empty_file(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = upload(import_client, auth_headers, data=b"")
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "import_file_rejected"


def test_upload_rejects_an_unsupported_extension(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = upload(import_client, auth_headers, name="resume.txt", data=b"plain text")
    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "import_file_type_unsupported"


def test_upload_rejects_content_that_contradicts_the_name(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    # A PDF claiming to be a DOCX is caught by magic bytes, never by the name.
    response = upload(import_client, auth_headers, name="resume.docx", data=PDF_RESUME)
    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "import_file_type_unsupported"


def test_upload_rejects_a_zip_bomb(import_client: TestClient, auth_headers: dict[str, str]) -> None:
    response = upload(
        import_client, auth_headers, name="resume.docx", data=build_zip_with_entries(3_000)
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "import_file_rejected"


def test_upload_rejects_an_oversized_file(
    settings: Settings,
    fake_repo: InMemoryWorkspaceRepository,
    auth_headers: dict[str, str],
) -> None:
    app = create_app(settings.model_copy(update={"max_import_bytes": 1024}))
    repo = InMemoryImportRepository(fake_repo)
    app.dependency_overrides[get_import_repository] = lambda: repo
    data = build_pdf([["Example Candidate " * 100]])
    assert 1024 < len(data) < 1024 + 8192  # past the cap, under the stream guard
    response = upload(TestClient(app), auth_headers, data=data)
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "import_file_too_large"


def test_scanned_pdf_upload_reads_nothing(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers, data=build_scanned_pdf()))
    assert session["previewAvailable"] is False
    assert session["sourceText"] == ""
    assert session["items"] == []


def test_upload_never_logs_the_document_or_its_text(
    import_client: TestClient, auth_headers: dict[str, str], caplog: object
) -> None:
    marker = "ZZTOP-UNLOGGABLE-MARKER"
    lines = ["EXAMPLE CANDIDATE", marker, "SKILLS", "TypeScript"]
    with caplog.at_level(logging.INFO):  # type: ignore[attr-defined]
        response = upload(import_client, auth_headers, data=build_pdf([lines]))
    assert response.status_code == 201
    assert marker not in caplog.text  # type: ignore[attr-defined]
    assert "EXAMPLE CANDIDATE" not in caplog.text  # type: ignore[attr-defined]


def test_list_imports(import_client: TestClient, auth_headers: dict[str, str]) -> None:
    upload(import_client, auth_headers)
    upload(import_client, auth_headers, name="resume.docx", data=DOCX_RESUME)

    response = import_client.get(f"{BASE}/imports", headers=auth_headers)
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 2
    assert {row["fileName"] for row in rows} == {"resume.pdf", "resume.docx"}
    for row in rows:
        assert row["itemCount"] == row["pendingCount"] + row["confirmedCount"]
        assert row["itemCount"] > 0
        assert "sourceText" not in row  # list rows carry no document text


def test_get_import_and_unknown_id(import_client: TestClient, auth_headers: dict[str, str]) -> None:
    created = session_of(upload(import_client, auth_headers))

    found = import_client.get(f"{BASE}/imports/{created['id']}", headers=auth_headers)
    assert found.status_code == 200
    assert found.json()["id"] == created["id"]

    missing = import_client.get(f"{BASE}/imports/imp-does-not-exist", headers=auth_headers)
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "import_not_found"


def test_imports_are_scoped_to_the_caller(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    created = session_of(upload(import_client, auth_headers))
    other = {"Authorization": f"Bearer {make_token(sub='11111111-1111-1111-1111-111111111111')}"}
    response = import_client.get(f"{BASE}/imports/{created['id']}", headers=other)
    assert response.status_code == 404
    assert import_client.get(f"{BASE}/imports", headers=other).json() == []


def test_patch_updates_values_and_attaches_support(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    item = item_of(session, "experience")

    response = import_client.patch(
        f"{BASE}/imports/{session['id']}/items/{item['id']}",
        json={
            "values": {
                "title": "Backend Engineer",
                "organization": "Example Payments Ltd",
                "startDate": "2024-01",
                "endDate": "2024-09",
                "bullets": ["Built a reporting endpoint."],
            },
            "support": {"kind": "link", "url": "https://example.com/cert"},
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["values"]["title"] == "Backend Engineer"
    assert body["values"]["bullets"] == ["Built a reporting endpoint."]
    assert body["support"] == {"kind": "link", "url": "https://example.com/cert"}
    assert body["status"] == "pending"  # attaching support does not decide anything


def test_patch_null_support_removes_it(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    item = item_of(session, "experience")
    url = f"{BASE}/imports/{session['id']}/items/{item['id']}"

    attached = import_client.patch(
        url,
        json={"support": {"kind": "link", "url": "https://example.com/cert"}},
        headers=auth_headers,
    )
    assert attached.status_code == 200
    removed = import_client.patch(url, json={"support": None}, headers=auth_headers)
    assert removed.status_code == 200
    assert "support" not in removed.json()


def test_patch_requires_at_least_one_key(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    item = item_of(session, "experience")
    response = import_client.patch(
        f"{BASE}/imports/{session['id']}/items/{item['id']}", json={}, headers=auth_headers
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_request"


def test_patch_rejects_day_precision_dates(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    item = item_of(session, "experience")
    response = import_client.patch(
        f"{BASE}/imports/{session['id']}/items/{item['id']}",
        json={"values": {"title": "Backend Engineer", "startDate": "2024-06-01"}},
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_request"


def test_patch_rejects_an_end_before_the_start(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    item = item_of(session, "experience")
    response = import_client.patch(
        f"{BASE}/imports/{session['id']}/items/{item['id']}",
        json={
            "values": {
                "title": "Backend Engineer",
                "startDate": "2024-09",
                "endDate": "2024-01",
            }
        },
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "values_invalid"


def test_patch_unknown_item_is_404(import_client: TestClient, auth_headers: dict[str, str]) -> None:
    session = session_of(upload(import_client, auth_headers))
    response = import_client.patch(
        f"{BASE}/imports/{session['id']}/items/ext-nope-9",
        json={"status": "rejected"},
        headers=auth_headers,
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "import_item_not_found"


def test_nothing_reaches_the_workspace_before_confirm(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    assert session["items"]

    workspace = import_client.get(f"{BASE}/workspace", headers=auth_headers).json()
    assert workspace["items"] == []


def test_confirm_creates_an_attested_workspace_item(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    item = item_of(session, "experience")

    response = import_client.post(
        f"{BASE}/imports/{session['id']}/items/{item['id']}/confirm", headers=auth_headers
    )
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["item"]["title"] == "Backend Intern"
    assert body["item"]["section"] == "experience"
    assert body["item"]["organization"] == "Example Payments Ltd"
    assert body["item"]["startDate"] == "2024-01"
    # No certificate was attached, so the item is User-attested, never Verified.
    assert body["item"]["evidence"] == "attested"
    assert body["review"]["status"] == "confirmed"
    assert body["review"]["decidedAt"]

    workspace = import_client.get(f"{BASE}/workspace", headers=auth_headers).json()
    assert [i["id"] for i in workspace["items"]] == [body["item"]["id"]]


def test_confirm_with_a_link_is_verified(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    item = item_of(session, "experience")
    url = f"{BASE}/imports/{session['id']}/items/{item['id']}"

    import_client.patch(
        url,
        json={"support": {"kind": "link", "url": "https://example.com/cert"}},
        headers=auth_headers,
    )
    body = import_client.post(f"{url}/confirm", headers=auth_headers).json()
    assert body["item"]["evidence"] == "verified"
    assert body["item"]["links"] == ["https://example.com/cert"]


def test_confirm_with_a_certificate_file_is_verified_and_attached(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    item = item_of(session, "experience")
    url = f"{BASE}/imports/{session['id']}/items/{item['id']}"

    import_client.patch(
        url, json={"support": {"kind": "file", "name": "cert.pdf"}}, headers=auth_headers
    )
    body = import_client.post(f"{url}/confirm", headers=auth_headers).json()
    assert body["item"]["evidence"] == "verified"
    assert body["item"]["attachments"][0]["name"] == "cert.pdf"
    # The file itself is not stored in B2: the attachment is an internal reference.
    assert body["item"]["attachments"][0]["url"].startswith("import://")


def test_confirm_is_idempotent(import_client: TestClient, auth_headers: dict[str, str]) -> None:
    session = session_of(upload(import_client, auth_headers))
    item = item_of(session, "experience")
    url = f"{BASE}/imports/{session['id']}/items/{item['id']}/confirm"

    first = import_client.post(url, headers=auth_headers).json()
    second = import_client.post(url, headers=auth_headers).json()
    assert first["item"]["id"] == second["item"]["id"]

    workspace = import_client.get(f"{BASE}/workspace", headers=auth_headers).json()
    assert len(workspace["items"]) == 1


def test_confirm_requires_a_title(import_client: TestClient, auth_headers: dict[str, str]) -> None:
    session = session_of(upload(import_client, auth_headers))
    item = item_of(session, "experience")
    url = f"{BASE}/imports/{session['id']}/items/{item['id']}"

    import_client.patch(url, json={"values": {"title": ""}}, headers=auth_headers)
    response = import_client.post(f"{url}/confirm", headers=auth_headers)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "values_invalid"

    # Nothing was written.
    workspace = import_client.get(f"{BASE}/workspace", headers=auth_headers).json()
    assert workspace["items"] == []


def test_confirm_unknown_item_is_404(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    response = import_client.post(
        f"{BASE}/imports/{session['id']}/items/ext-nope-9/confirm", headers=auth_headers
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "import_item_not_found"


def test_confirm_unknown_import_is_404(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = import_client.post(
        f"{BASE}/imports/imp-does-not-exist/items/ext-experience-1/confirm", headers=auth_headers
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "import_not_found"


def test_confirmed_item_does_not_leak_into_another_users_workspace(
    import_client: TestClient, auth_headers: dict[str, str]
) -> None:
    session = session_of(upload(import_client, auth_headers))
    item = item_of(session, "experience")
    import_client.post(
        f"{BASE}/imports/{session['id']}/items/{item['id']}/confirm", headers=auth_headers
    )

    other = {"Authorization": f"Bearer {make_token(sub='22222222-2222-2222-2222-222222222222')}"}
    workspace = import_client.get(f"{BASE}/workspace", headers=other).json()
    assert workspace["items"] == []
