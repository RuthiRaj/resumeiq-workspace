"""Workspace API contract tests (in-memory repository via dependency override)."""

from typing import cast

from fastapi.testclient import TestClient

BASE = "/api/v1"


def create(client: TestClient, headers: dict[str, str], **body: object) -> dict[str, object]:
    payload: dict[str, object] = {"section": "skill", "title": "TypeScript", "evidence": "attested"}
    payload.update(body)
    response = client.post(f"{BASE}/workspace/items", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return cast(dict[str, object], response.json())


def test_get_workspace_empty(workspace_client: TestClient, auth_headers: dict[str, str]) -> None:
    response = workspace_client.get(f"{BASE}/workspace", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {
        "version": 1,
        "items": [],
        "updatedAt": "2026-10-16T09:00:00.000Z",
    }


def test_requires_authentication(workspace_client: TestClient) -> None:
    assert workspace_client.get(f"{BASE}/workspace").status_code == 401
    assert workspace_client.get(f"{BASE}/resume/standard").status_code == 401


def test_create_returns_item_and_excludes_none(
    workspace_client: TestClient, auth_headers: dict[str, str]
) -> None:
    item = create(workspace_client, auth_headers)
    assert item["id"]
    assert item["section"] == "skill"
    assert item["order"] == 0
    assert item["evidence"] == "attested"
    # Optional wire fields are absent (not null), matching the frontend Zod shape.
    assert "deletedAt" not in item
    assert "organization" not in item
    assert "attachments" in item and item["attachments"] == []

    workspace = workspace_client.get(f"{BASE}/workspace", headers=auth_headers).json()
    assert workspace["version"] == 2
    assert [i["id"] for i in workspace["items"]] == [item["id"]]


def test_create_verified_without_support_is_422(
    workspace_client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = workspace_client.post(
        f"{BASE}/workspace/items",
        json={"section": "skill", "title": "Wishful", "evidence": "verified"},
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_request"


def test_update_to_verified_without_support_is_422_then_ok_with_attachment(
    workspace_client: TestClient, auth_headers: dict[str, str]
) -> None:
    item = create(workspace_client, auth_headers)
    blocked = workspace_client.patch(
        f"{BASE}/workspace/items/{item['id']}", json={"evidence": "verified"}, headers=auth_headers
    )
    assert blocked.status_code == 422
    assert blocked.json()["detail"]["code"] == "invalid_item"

    ok = workspace_client.patch(
        f"{BASE}/workspace/items/{item['id']}",
        json={
            "evidence": "verified",
            "attachments": [{"id": "a1", "name": "cert.pdf", "url": "https://example.com/c"}],
        },
        headers=auth_headers,
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["evidence"] == "verified"
    assert ok.json()["attachments"][0]["name"] == "cert.pdf"


def test_delete_then_restore_flow(
    workspace_client: TestClient, auth_headers: dict[str, str]
) -> None:
    item = create(workspace_client, auth_headers)

    deleted = workspace_client.delete(f"{BASE}/workspace/items/{item['id']}", headers=auth_headers)
    assert deleted.status_code == 204
    assert deleted.content == b""

    assert workspace_client.get(f"{BASE}/workspace", headers=auth_headers).json()["items"] == []
    log = workspace_client.get(f"{BASE}/workspace/changelog", headers=auth_headers).json()
    assert log[0]["op"] == "delete"
    assert log[0]["label"] == "TypeScript"

    restored = workspace_client.post(
        f"{BASE}/workspace/items/{item['id']}/restore", headers=auth_headers
    )
    assert restored.status_code == 200
    assert "deletedAt" not in restored.json()
    assert len(workspace_client.get(f"{BASE}/workspace", headers=auth_headers).json()["items"]) == 1
    # The undo is logged as its own op, not an edit (ADR-019).
    assert (
        workspace_client.get(f"{BASE}/workspace/changelog", headers=auth_headers).json()[0]["op"]
        == "restore"
    )


def test_patch_on_a_soft_deleted_item_is_404(
    workspace_client: TestClient, auth_headers: dict[str, str]
) -> None:
    item = create(workspace_client, auth_headers)
    workspace_client.delete(f"{BASE}/workspace/items/{item['id']}", headers=auth_headers)

    patched = workspace_client.patch(
        f"{BASE}/workspace/items/{item['id']}",
        json={"title": "Zombie"},
        headers=auth_headers,
    )
    assert patched.status_code == 404, patched.text
    assert patched.json()["detail"]["code"] == "not_found"
    # It stayed deleted: a PATCH may not resurrect it.
    assert workspace_client.get(f"{BASE}/workspace", headers=auth_headers).json()["items"] == []


def test_changelog_is_newest_first(
    workspace_client: TestClient, auth_headers: dict[str, str]
) -> None:
    create(workspace_client, auth_headers, title="First")
    create(workspace_client, auth_headers, title="Second")
    log = workspace_client.get(f"{BASE}/workspace/changelog", headers=auth_headers).json()
    assert [entry["seq"] for entry in log] == [2, 1]
    assert log[0]["label"] == "Second"


def test_reorder_updates_order_and_bumps_version_once(
    workspace_client: TestClient, auth_headers: dict[str, str]
) -> None:
    a = create(workspace_client, auth_headers, title="A")
    b = create(workspace_client, auth_headers, title="B")
    before = workspace_client.get(f"{BASE}/workspace", headers=auth_headers).json()["version"]

    response = workspace_client.post(
        f"{BASE}/workspace/reorder",
        json={"section": "skill", "orderedIds": [b["id"], a["id"]]},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version"] == before + 1
    assert {i["id"]: i["order"] for i in body["items"]} == {b["id"]: 0, a["id"]: 1}


def test_get_unknown_item_is_404(
    workspace_client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = workspace_client.get(f"{BASE}/workspace/items/missing", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"


def test_standard_resume_excludes_deleted_items(
    workspace_client: TestClient, auth_headers: dict[str, str]
) -> None:
    kept = create(workspace_client, auth_headers, title="Keeper", section="project")
    gone = create(workspace_client, auth_headers, title="Discarded", section="project")
    workspace_client.delete(f"{BASE}/workspace/items/{gone['id']}", headers=auth_headers)

    resume = workspace_client.get(f"{BASE}/resume/standard", headers=auth_headers).json()
    assert resume["kind"] == "standard"
    evidence_ids = {
        cid
        for section in resume["sections"]
        for claim in section["claims"]
        for cid in claim["evidenceIds"]
    }
    assert evidence_ids == {kept["id"]}
