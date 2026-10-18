"""Shared pytest fixtures: per-test app with isolated settings."""

import time
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_import_repository, get_workspace_repository
from app.core.config import Settings
from app.main import create_app
from app.repositories.import_memory import InMemoryImportRepository
from app.repositories.memory import InMemoryWorkspaceRepository

TEST_AUDIENCE = "authenticated"
TEST_ISSUER = "https://test.supabase.co/auth/v1"
TEST_JWKS_URL = "https://test.supabase.co/auth/v1/.well-known/jwks.json"
TEST_HS256_SECRET = "test-legacy-secret-that-is-not-real"  # tests only, never a real secret

TEST_SUBJECT = "123e4567-e89b-12d3-a456-426614174000"
FIXED_CLOCK = "2026-10-17T12:00:00.000Z"


def make_token(**overrides: Any) -> str:
    """A valid legacy-HS256 token for the test project (mirrors the auth tests)."""
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": TEST_SUBJECT,
        "email": "user@example.com",
        "role": "authenticated",
        "aud": TEST_AUDIENCE,
        "iss": TEST_ISSUER,
        "iat": now,
        "exp": now + 3600,
    }
    payload.update(overrides)
    return jwt.encode(payload, TEST_HS256_SECRET, algorithm="HS256")


@pytest.fixture()
def settings() -> Settings:
    return Settings(
        environment="test",
        cors_origins=["http://localhost:3000"],
        supabase_url="https://test.supabase.co",
        supabase_jwt_secret=TEST_HS256_SECRET,
        supabase_jwt_audience=TEST_AUDIENCE,
        supabase_jwt_issuer=TEST_ISSUER,
        max_request_bytes=1_048_576,
        rate_limit_per_minute=1000,  # effectively off unless a test lowers it
    )


@pytest.fixture()
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))


@pytest.fixture()
def fake_repo() -> InMemoryWorkspaceRepository:
    return InMemoryWorkspaceRepository(clock=lambda: FIXED_CLOCK)


@pytest.fixture()
def workspace_client(settings: Settings, fake_repo: InMemoryWorkspaceRepository) -> TestClient:
    """App whose workspace repository is the in-memory double (no network)."""
    app = create_app(settings)
    app.dependency_overrides[get_workspace_repository] = lambda: fake_repo
    return TestClient(app)


@pytest.fixture()
def import_repo(fake_repo: InMemoryWorkspaceRepository) -> InMemoryImportRepository:
    """One in-memory import repository shared by every request in a test."""
    return InMemoryImportRepository(fake_repo)


@pytest.fixture()
def import_client(
    settings: Settings,
    fake_repo: InMemoryWorkspaceRepository,
    import_repo: InMemoryImportRepository,
) -> TestClient:
    """App whose import and workspace repositories are the in-memory doubles.

    The real extraction engine is kept, so the endpoint tests exercise real PDF
    and DOCX parsing over the synthetic documents.
    """
    app = create_app(settings)
    app.dependency_overrides[get_workspace_repository] = lambda: fake_repo
    app.dependency_overrides[get_import_repository] = lambda: import_repo
    return TestClient(app)


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token()}"}
