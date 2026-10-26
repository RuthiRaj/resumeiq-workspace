"""Health endpoint + security defaults."""

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

STRICT_CSP = "default-src 'none'; frame-ancestors 'none'"


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


def test_csp_strict_on_api_routes_in_development(settings: Settings) -> None:
    """API routes always get strict CSP, even in development."""
    dev_settings = Settings(
        environment="development",
        supabase_url="https://test.supabase.co",
        supabase_publishable_key="test-key",
    )
    client = TestClient(create_app(dev_settings))

    # Health endpoint (not under /api/v1 but should still be strict)
    response = client.get("/health")
    assert response.headers["Content-Security-Policy"] == STRICT_CSP

    # API v1 route (any route under /api/v1/)
    response = client.get("/api/v1/health")
    assert response.headers["Content-Security-Policy"] == STRICT_CSP


def test_csp_strict_on_all_routes_in_production(settings: Settings) -> None:
    """All routes get strict CSP in production."""
    prod_settings = Settings(
        environment="production",
        supabase_url="https://test.supabase.co",
        supabase_publishable_key="test-key",
    )
    client = TestClient(create_app(prod_settings))

    # Health endpoint
    response = client.get("/health")
    assert response.headers["Content-Security-Policy"] == STRICT_CSP

    # Docs paths return 404 in production but still have strict CSP
    response = client.get("/docs")
    assert response.status_code == 404
    assert response.headers["Content-Security-Policy"] == STRICT_CSP

    response = client.get("/redoc")
    assert response.status_code == 404
    assert response.headers["Content-Security-Policy"] == STRICT_CSP

    response = client.get("/openapi.json")
    assert response.status_code == 404
    assert response.headers["Content-Security-Policy"] == STRICT_CSP


def test_csp_relaxed_on_docs_paths_in_development(settings: Settings) -> None:
    """Docs paths get relaxed CSP in development to allow Swagger UI assets."""
    dev_settings = Settings(
        environment="development",
        supabase_url="https://test.supabase.co",
        supabase_publishable_key="test-key",
    )
    client = TestClient(create_app(dev_settings))

    # /docs should have relaxed CSP allowing CDN scripts/styles/images
    response = client.get("/docs")
    csp = response.headers["Content-Security-Policy"]
    assert "script-src" in csp
    assert "'unsafe-inline'" in csp
    assert "https://cdn.jsdelivr.net" in csp
    assert "https://fastapi.tiangolo.com" in csp
    assert "style-src" in csp
    assert "img-src" in csp
    assert "frame-ancestors 'none'" in csp

    # /redoc should have the same relaxed CSP
    response = client.get("/redoc")
    csp = response.headers["Content-Security-Policy"]
    assert "script-src" in csp
    assert "'unsafe-inline'" in csp
    assert "https://cdn.jsdelivr.net" in csp
    assert "https://fastapi.tiangolo.com" in csp
    assert "style-src" in csp
    assert "img-src" in csp

    # /openapi.json should have the same relaxed CSP
    response = client.get("/openapi.json")
    csp = response.headers["Content-Security-Policy"]
    assert "script-src" in csp
    assert "'unsafe-inline'" in csp
    assert "https://cdn.jsdelivr.net" in csp
    assert "https://fastapi.tiangolo.com" in csp
    assert "style-src" in csp
    assert "img-src" in csp
