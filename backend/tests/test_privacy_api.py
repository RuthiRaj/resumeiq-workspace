"""B6 privacy API tests: capabilities, data export and account deletion.

In-memory repositories only: no network, no real credentials. The tests assert
the contract in ``docs/api/contract-proposals.md`` §9 and the isolation rules
that matter most for an export/delete feature:

* a caller only ever sees and deletes their own rows (A vs B);
* a wrong confirmation deletes nothing;
* the response never claims the auth identity was removed;
* no token, key or auth row can appear in the export body.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_data_export_repository
from app.core.config import Settings
from app.main import create_app
from app.repositories.data_export import ExportSnapshot
from app.repositories.data_export_memory import InMemoryDataExportRepository
from app.repositories.errors import (
    AccountDeletionUnavailableError,
    DataExportUnavailableError,
)
from tests.conftest import TEST_SUBJECT, make_token

BASE = "/api/v1"
USER_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def headers_for(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub=user_id)}"}


@pytest.fixture()
def export_repo() -> InMemoryDataExportRepository:
    return InMemoryDataExportRepository()


@pytest.fixture()
def privacy_client(settings: Settings, export_repo: InMemoryDataExportRepository) -> TestClient:
    app = create_app(settings)
    app.dependency_overrides[get_data_export_repository] = lambda: export_repo
    return TestClient(app)


def seed_rows(repo: InMemoryDataExportRepository, user_id: str, marker: str) -> None:
    repo.add("workspace", {"user_id": user_id, "id": f"{marker}-item", "title": marker})
    repo.add(
        "resumes",
        {"user_id": user_id, "id": f"{marker}-resume", "title": f"{marker} resume"},
    )
    repo.add("profile", {"user_id": user_id, "headline": f"{marker} headline"})
    repo.add("auditEvents", {"user_id": user_id, "id": f"{marker}-event"})


def test_privacy_routes_require_authentication(privacy_client: TestClient) -> None:
    assert privacy_client.get(f"{BASE}/capabilities").status_code == 401
    assert privacy_client.get(f"{BASE}/export").status_code == 401
    assert privacy_client.request("DELETE", f"{BASE}/account", json={}).status_code == 401


def test_capabilities_are_booleans_without_provider_details(settings: Settings) -> None:
    configured = settings.model_copy(
        update={
            "supabase_publishable_key": "publishable-test-key",
            "groq_api_key": "groq-secret-key",
        }
    )
    client = TestClient(create_app(configured))

    response = client.get(f"{BASE}/capabilities", headers=headers_for(TEST_SUBJECT))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "ai": {
            "configured": True,
            "analysisEnrichment": True,
            "resumeRewording": True,
        },
        "pdfExport": True,
        "dataExport": True,
        "accountDeletion": {"dataDeletion": True, "authUserDeletion": False},
    }
    # No provider name, URL or key value may travel in the response.
    text = response.text.lower()
    for forbidden in ("groq", "nvidia", "secret", "api_key", "apikey", "model"):
        assert forbidden not in text
    assert "groq-secret-key" not in response.text
    assert "publishable-test-key" not in response.text


def test_capabilities_turn_off_when_nothing_is_configured(settings: Settings) -> None:
    unconfigured = settings.model_copy(
        update={
            "supabase_publishable_key": "",
            "groq_api_key": "",
            "nvidia_api_key": "",
        }
    )
    client = TestClient(create_app(unconfigured))
    body = client.get(f"{BASE}/capabilities", headers=headers_for(TEST_SUBJECT)).json()
    assert body["ai"]["configured"] is False
    assert body["ai"]["resumeRewording"] is False
    assert body["pdfExport"] is False
    assert body["dataExport"] is False
    assert body["accountDeletion"] == {"dataDeletion": False, "authUserDeletion": False}


def test_export_returns_only_the_callers_rows(
    privacy_client: TestClient, export_repo: InMemoryDataExportRepository
) -> None:
    seed_rows(export_repo, TEST_SUBJECT, "a")
    seed_rows(export_repo, USER_B, "b")

    response = privacy_client.get(f"{BASE}/export", headers=headers_for(TEST_SUBJECT))
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["format"] == "resumeiq.data-export.v1"
    assert body["userId"] == TEST_SUBJECT
    assert body["email"] == "user@example.com"
    assert body["workspace"] == [{"user_id": TEST_SUBJECT, "id": "a-item", "title": "a"}]
    assert body["resumes"][0]["title"] == "a resume"
    assert body["profile"] == {"user_id": TEST_SUBJECT, "headline": "a headline"}
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["cache-control"] == "no-store"

    # B's data never appears anywhere in A's export.
    assert "b-item" not in response.text
    assert "b resume" not in response.text
    assert "b headline" not in response.text
    # No auth credential or key can be present: the export has no such key and
    # reads no auth table.
    serialized = json.dumps(body)
    for forbidden in ("access_token", "refresh_token", "service_role", "password"):
        assert forbidden not in serialized


def test_export_of_the_other_user_never_includes_a(
    privacy_client: TestClient, export_repo: InMemoryDataExportRepository
) -> None:
    seed_rows(export_repo, TEST_SUBJECT, "a")
    seed_rows(export_repo, USER_B, "b")

    response = privacy_client.get(f"{BASE}/export", headers=headers_for(USER_B))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["userId"] == USER_B
    assert body["workspace"] == [{"user_id": USER_B, "id": "b-item", "title": "b"}]
    assert "a-item" not in response.text
    assert "a resume" not in response.text


def test_wrong_confirmation_deletes_nothing(
    privacy_client: TestClient, export_repo: InMemoryDataExportRepository
) -> None:
    seed_rows(export_repo, TEST_SUBJECT, "a")

    for confirmation in ("delete", "delete account", "remove my account", "  "):
        response = privacy_client.request(
            "DELETE",
            f"{BASE}/account",
            json={"confirmation": confirmation},
            headers=headers_for(TEST_SUBJECT),
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"]["code"] == "account_confirmation_required"

    assert len(export_repo.rows_for("workspace", TEST_SUBJECT)) == 1
    assert len(export_repo.rows_for("resumes", TEST_SUBJECT)) == 1


def test_account_deletion_removes_only_a_and_reports_the_remaining_auth_step(
    privacy_client: TestClient, export_repo: InMemoryDataExportRepository
) -> None:
    seed_rows(export_repo, TEST_SUBJECT, "a")
    seed_rows(export_repo, USER_B, "b")

    response = privacy_client.request(
        "DELETE",
        f"{BASE}/account",
        json={"confirmation": "  DELETE MY ACCOUNT  "},
        headers=headers_for(TEST_SUBJECT),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dataDeleted"] is True
    assert body["authUserDeleted"] is False
    assert body["remainingStep"] == "auth_user"
    assert body["deletedCounts"]["workspace_items"] == 1
    assert body["deletedCounts"]["resumes"] == 1
    assert body["deletedCounts"]["profiles"] == 1
    assert "sign-in identity still exists" in body["message"]

    assert export_repo.rows_for("workspace", TEST_SUBJECT) == []
    assert export_repo.rows_for("resumes", TEST_SUBJECT) == []
    # B is untouched.
    assert len(export_repo.rows_for("workspace", USER_B)) == 1
    assert len(export_repo.rows_for("resumes", USER_B)) == 1

    # Idempotent for data: a second call deletes zero rows and says the same.
    again = privacy_client.request(
        "DELETE",
        f"{BASE}/account",
        json={"confirmation": "delete my account"},
        headers=headers_for(TEST_SUBJECT),
    )
    assert again.status_code == 200
    assert again.json()["deletedCounts"]["workspace_items"] == 0
    assert again.json()["remainingStep"] == "auth_user"


class BrokenRepository:
    """Fails both operations to exercise the contract's 503 mappings."""

    async def export_user(self, user_id: str) -> ExportSnapshot:
        raise DataExportUnavailableError("store down")

    async def delete_user_data(self, user_id: str) -> dict[str, int]:
        raise AccountDeletionUnavailableError("store down")


def test_export_failure_maps_to_a_503_without_stored_data(settings: Settings) -> None:
    app = create_app(settings)
    app.dependency_overrides[get_data_export_repository] = lambda: BrokenRepository()
    client = TestClient(app)

    response = client.get(f"{BASE}/export", headers=headers_for(TEST_SUBJECT))
    assert response.status_code == 503
    body: dict[str, Any] = response.json()
    assert body["detail"]["code"] == "data_export_unavailable"


def test_deletion_failure_maps_to_a_503(settings: Settings) -> None:
    app = create_app(settings)
    app.dependency_overrides[get_data_export_repository] = lambda: BrokenRepository()
    client = TestClient(app)

    response = client.request(
        "DELETE",
        f"{BASE}/account",
        json={"confirmation": "delete my account"},
        headers=headers_for(TEST_SUBJECT),
    )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "account_deletion_unavailable"
