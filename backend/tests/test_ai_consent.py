"""Consent: store reads, dependency gating, and the gateway's requirement."""

from __future__ import annotations

import asyncio
import json
from typing import Annotated

import httpx
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app.ai.consent import ConsentGrant, InMemoryConsentStore, SupabaseConsentStore
from app.ai.errors import AIConsentRequiredError
from app.ai.schemas import RewriteBulletInput
from app.api.deps import require_ai_consent
from app.core.config import Settings
from app.main import create_app
from tests.ai_fakes import CONSENT, EVIDENCE, GROQ, completion, handler_sequence, make_gateway
from tests.conftest import (
    TEST_AUDIENCE,
    TEST_HS256_SECRET,
    TEST_ISSUER,
    TEST_SUBJECT,
    make_token,
)

REST_URL = "https://project.supabase.co/rest/v1"


def test_in_memory_store_grant_and_revoke() -> None:
    store = InMemoryConsentStore()
    assert store.has_ai_consent("user-1") is False
    store.grant("user-1")
    assert store.has_ai_consent("user-1") is True
    store.revoke("user-1")
    assert store.has_ai_consent("user-1") is False


def test_supabase_store_queries_the_right_row_and_returns_true() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[{"id": "consent-row"}])

    store = SupabaseConsentStore(
        REST_URL, "publishable-key-not-real", "jwt-not-real", transport=httpx.MockTransport(handler)
    )
    assert store.has_ai_consent("user-1") is True
    assert len(seen) == 1
    url = seen[0].url
    assert url.path.endswith("/consent_records")
    assert url.params["user_id"] == "eq.user-1"
    assert url.params["purpose"] == "eq.ai_processing"
    assert url.params["granted"] == "is.true"
    assert url.params["revoked_at"] == "is.null"
    assert seen[0].headers["Authorization"] == "Bearer jwt-not-real"


def test_supabase_store_returns_false_when_no_row() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    store = SupabaseConsentStore(REST_URL, "k", "jwt", transport=httpx.MockTransport(handler))
    assert store.has_ai_consent("user-1") is False


def test_supabase_store_fails_closed_on_http_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"message": "boom"})

    store = SupabaseConsentStore(REST_URL, "k", "jwt", transport=httpx.MockTransport(handler))
    assert store.has_ai_consent("user-1") is False


def test_supabase_store_fails_closed_on_network_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    store = SupabaseConsentStore(REST_URL, "k", "jwt", transport=httpx.MockTransport(handler))
    assert store.has_ai_consent("user-1") is False


def test_supabase_store_fails_closed_on_invalid_json() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json")

    store = SupabaseConsentStore(REST_URL, "k", "jwt", transport=httpx.MockTransport(handler))
    assert store.has_ai_consent("user-1") is False


def build_app(settings: Settings, store: InMemoryConsentStore | None) -> TestClient:
    app = create_app(settings)
    if store is not None:
        app.state.ai_consent_store = store

    @app.get("/needs-consent")
    def needs_consent(
        grant: Annotated[ConsentGrant, Depends(require_ai_consent)],
    ) -> dict[str, str]:
        return {"user_id": grant.user_id, "purpose": grant.purpose}

    return TestClient(app)


def test_dependency_denies_without_a_recorded_grant(settings: Settings) -> None:
    client = build_app(settings, InMemoryConsentStore())
    response = client.get("/needs-consent", headers={"Authorization": f"Bearer {make_token()}"})
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ai_consent_required"


def test_dependency_allows_with_a_recorded_grant(settings: Settings) -> None:
    store = InMemoryConsentStore()
    store.grant(TEST_SUBJECT)
    client = build_app(settings, store)
    response = client.get("/needs-consent", headers={"Authorization": f"Bearer {make_token()}"})
    assert response.status_code == 200
    assert response.json() == {"user_id": TEST_SUBJECT, "purpose": "ai_processing"}


def test_dependency_still_requires_a_valid_token(settings: Settings) -> None:
    store = InMemoryConsentStore()
    store.grant(TEST_SUBJECT)
    client = build_app(settings, store)
    assert client.get("/needs-consent").status_code in (401, 403)


def test_consent_store_is_required_to_be_configured() -> None:
    # Hermetic settings: `_env_file=None` so a developer's backend/.env (git-ignored,
    # with a real publishable key) cannot turn this into a live lookup.
    hermetic = Settings(
        _env_file=None,
        supabase_url="https://test.supabase.co",
        supabase_jwt_secret=TEST_HS256_SECRET,
        supabase_jwt_audience=TEST_AUDIENCE,
        supabase_jwt_issuer=TEST_ISSUER,
    )
    client = build_app(hermetic, None)
    response = client.get("/needs-consent", headers={"Authorization": f"Bearer {make_token()}"})
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "data_api_not_configured"


def test_gateway_refuses_a_grant_for_the_wrong_purpose() -> None:
    class WrongPurposeGrant:
        user_id = "user-1"
        purpose = "data_export"

    handler, seen = handler_sequence([])
    gateway, _ = make_gateway([GROQ], handler=handler)
    payload = RewriteBulletInput(bullet="Built a Python service.")
    with pytest.raises(AIConsentRequiredError):
        asyncio.run(gateway.run("rewrite_bullet", payload, EVIDENCE, consent=WrongPurposeGrant()))
    assert seen == []


def test_synthetic_grant_is_explicitly_labelled() -> None:
    grant = ConsentGrant.for_synthetic_data(user_id="bakeoff")
    assert grant.source == "synthetic_fixture"
    assert grant.purpose == "ai_processing"


def test_gateway_accepts_a_real_grant() -> None:
    body = json.dumps({"claims": [{"text": "Built a Python service.", "evidence_ids": ["ev1"]}]})
    handler, seen = handler_sequence([completion(body)])
    gateway, _ = make_gateway([GROQ], handler=handler)
    result = asyncio.run(
        gateway.run(
            "rewrite_bullet",
            RewriteBulletInput(bullet="Built a Python service."),
            EVIDENCE,
            consent=CONSENT,
        )
    )
    assert result.provider == "groq"
    assert len(seen) == 1
