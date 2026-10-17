"""Auth dependency: valid, expired, malformed, wrong-audience (+ edge cases)."""

import time
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

import app.api.deps as deps
from app.core.config import Settings
from app.main import create_app
from tests.conftest import TEST_AUDIENCE, TEST_HS256_SECRET, TEST_ISSUER

SUBJECT = "123e4567-e89b-12d3-a456-426614174000"


def make_token(**overrides: Any) -> str:
    now = int(time.time())
    payload = {
        "sub": SUBJECT,
        "email": "user@example.com",
        "role": "authenticated",
        "aud": TEST_AUDIENCE,
        "iss": TEST_ISSUER,
        "iat": now,
        "exp": now + 3600,
    }
    payload.update(overrides)
    return jwt.encode(payload, TEST_HS256_SECRET, algorithm="HS256")


def test_me_valid_token(client: TestClient) -> None:
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {make_token()}"})
    assert response.status_code == 200, response.text
    assert response.json() == {"id": SUBJECT, "email": "user@example.com", "role": "authenticated"}


def test_me_missing_token(client: TestClient) -> None:
    response = client.get("/api/v1/me")
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "missing_credentials"


def test_me_malformed_token(client: TestClient) -> None:
    response = client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "malformed_token"


def test_me_expired_token(client: TestClient) -> None:
    token = make_token(exp=int(time.time()) - 3600)
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "token_expired"


def test_me_wrong_audience(client: TestClient) -> None:
    token = make_token(aud="someone-else")
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_audience"


def test_me_wrong_signature(client: TestClient) -> None:
    bad = jwt.encode(
        {"sub": SUBJECT, "aud": TEST_AUDIENCE, "iss": TEST_ISSUER},
        "wrong-secret-that-is-long-enough-1234567890",
        algorithm="HS256",
    )
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {bad}"})
    assert response.status_code == 401


def test_me_unconfigured_auth_returns_500() -> None:
    client = TestClient(create_app(Settings(_env_file=None, environment="test")))
    response = client.get("/api/v1/me", headers={"Authorization": "Bearer anything"})
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "auth_not_configured"


def test_me_asymmetric_jwks_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """JWKS (primary) path: RS256 token verified against a stubbed JWKS client."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    now = int(time.time())
    token = jwt.encode(
        {"sub": SUBJECT, "aud": TEST_AUDIENCE, "iss": TEST_ISSUER, "iat": now, "exp": now + 600},
        private_pem,
        algorithm="RS256",
        headers={"kid": "test-key-1"},
    )

    class StubJwksClient:
        def get_signing_key_from_jwt(self, _token: str) -> Any:
            class Key:
                key = public_pem

            return Key()

    monkeypatch.setattr(deps, "_get_jwks_client", lambda _url: StubJwksClient())
    asymmetric = Settings(
        environment="test",
        supabase_url="https://test.supabase.co",  # derives jwks_url; no HS256 secret set
        supabase_jwt_audience=TEST_AUDIENCE,
        supabase_jwt_issuer=TEST_ISSUER,
    )
    client = TestClient(create_app(asymmetric))
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.text
    assert response.json()["id"] == SUBJECT
