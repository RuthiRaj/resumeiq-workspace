"""Shared pytest fixtures: per-test app with isolated settings."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

TEST_AUDIENCE = "authenticated"
TEST_ISSUER = "https://test.supabase.co/auth/v1"
TEST_JWKS_URL = "https://test.supabase.co/auth/v1/.well-known/jwks.json"
TEST_HS256_SECRET = "test-legacy-secret-that-is-not-real"  # tests only, never a real secret


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
