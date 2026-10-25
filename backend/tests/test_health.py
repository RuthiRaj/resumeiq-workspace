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


def test_root_endpoint_test_mode(client: TestClient) -> None:
    """Test the root endpoint in test mode (no docs exposed)."""
    response = client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "ResumeIQ API"
    assert body["status"] == "ok"
    assert body["health"] == "/health"
    # In test environment, docs should NOT be exposed (only in development)
    assert "docs" not in body
    # Version and environment should not be exposed in test mode either
    assert "version" not in body
    assert "environment" not in body


def test_root_endpoint_development_mode(settings: Settings) -> None:
    """Test the root endpoint in development mode (docs exposed)."""
    dev_settings = Settings(
        environment="development",
        supabase_url="https://test.supabase.co",
        supabase_publishable_key="test-key",
    )
    client = TestClient(create_app(dev_settings))
    response = client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "ResumeIQ API"
    assert body["status"] == "ok"
    assert body["health"] == "/health"
    # In development, docs should be exposed
    assert "docs" in body
    assert body["docs"] == "/docs"
    # Version and environment should not be exposed in any mode
    assert "version" not in body
    assert "environment" not in body


def test_root_endpoint_production_mode(settings: Settings) -> None:
    """Test the root endpoint in production mode (no docs)."""
    prod_settings = Settings(
        environment="production",
        supabase_url="https://test.supabase.co",
        supabase_publishable_key="test-key",
    )
    client = TestClient(create_app(prod_settings))
    response = client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "ResumeIQ API"
    assert body["status"] == "ok"
    assert body["health"] == "/health"
    # In production, docs should NOT be exposed
    assert "docs" not in body
    # Version and environment should not be exposed in production
    assert "version" not in body
    assert "environment" not in body