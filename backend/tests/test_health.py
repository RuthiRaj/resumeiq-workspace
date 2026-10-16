"""Health endpoint + security defaults."""

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_health_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"]
    assert body["environment"] == "test"


def test_health_has_security_headers(client: TestClient) -> None:
    response = client.get("/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert "Content-Security-Policy" in response.headers
    assert "X-Request-ID" in response.headers


def test_health_rejects_oversized_body(settings: Settings) -> None:
    tiny = Settings(
        environment="test",
        supabase_url="https://test.supabase.co",
        max_request_bytes=16,
        rate_limit_per_minute=1000,
    )
    client = TestClient(create_app(tiny))
    response = client.post("/health", content=b"x" * 17)
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "payload_too_large"


def test_rate_limit_returns_429(settings: Settings) -> None:
    limited = Settings(
        environment="test",
        supabase_url="https://test.supabase.co",
        rate_limit_per_minute=1,
    )
    client = TestClient(create_app(limited))
    assert client.get("/health").status_code == 200
    response = client.get("/health")
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "rate_limited"
    assert "Retry-After" in response.headers
