"""Config loading: defaults, env overrides, derived JWKS/issuer URLs."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import MissingSettingsError, Settings, get_settings
from app.main import create_app


def test_defaults() -> None:
    # `_env_file=None` keeps the test hermetic: a developer's local backend/.env
    # (real Supabase values, git-ignored) must not change these defaults.
    settings = Settings(_env_file=None)
    assert settings.api_v1_prefix == "/api/v1"
    assert settings.supabase_jwt_audience == "authenticated"
    assert settings.max_request_bytes == 1_048_576
    assert settings.rate_limit_per_minute == 60
    assert settings.cors_origins == ["http://localhost:3000"]
    assert settings.auth_configured is False
    assert settings.data_api_configured is False


def test_data_api_configured_requires_url_and_key() -> None:
    url_only = Settings(_env_file=None, supabase_url="https://x.supabase.co")
    key_only = Settings(_env_file=None, supabase_publishable_key="pk")
    assert url_only.data_api_configured is False
    assert key_only.data_api_configured is False
    settings = Settings(
        _env_file=None, supabase_url="https://x.supabase.co/", supabase_publishable_key="pk"
    )
    assert settings.rest_url == "https://x.supabase.co/rest/v1"
    assert settings.data_api_configured is True


def test_env_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://xyzcompany.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "s3cret")
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example, https://b.example")
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "120")
    get_settings.cache_clear()
    try:
        settings = get_settings()
    finally:
        get_settings.cache_clear()
    assert settings.supabase_url == "https://xyzcompany.supabase.co"
    assert settings.cors_origins == ["https://a.example", "https://b.example"]
    assert settings.rate_limit_per_minute == 120
    assert settings.auth_configured is True


def test_jwks_url_derived_from_project_url() -> None:
    settings = Settings(_env_file=None, supabase_url="https://xyzcompany.supabase.co/")
    assert settings.jwks_url == "https://xyzcompany.supabase.co/auth/v1/.well-known/jwks.json"
    assert settings.jwt_issuer == "https://xyzcompany.supabase.co/auth/v1"


def test_explicit_jwks_url_wins() -> None:
    settings = Settings(
        _env_file=None,
        supabase_url="https://xyzcompany.supabase.co",
        supabase_jwks_url="https://custom.example/jwks.json",
        supabase_jwt_issuer="https://custom.example/auth/v1",
    )
    assert settings.jwks_url == "https://custom.example/jwks.json"
    assert settings.jwt_issuer == "https://custom.example/auth/v1"


def test_missing_required_names_variables_but_never_values() -> None:
    settings = Settings(_env_file=None)
    assert settings.missing_required() == ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]
    with pytest.raises(MissingSettingsError) as excinfo:
        settings.validate_required()
    message = str(excinfo.value)
    assert "SUPABASE_URL" in message
    assert "SUPABASE_PUBLISHABLE_KEY" in message


def test_validate_required_passes_when_configured() -> None:
    secret_value = "placeholder-not-a-real-key"
    settings = Settings(
        _env_file=None,
        supabase_url="https://test.supabase.co",
        supabase_publishable_key=secret_value,
    )
    assert settings.missing_required() == []
    settings.validate_required()  # must not raise


def test_startup_fails_fast_when_required_settings_are_missing() -> None:
    app = create_app(Settings(_env_file=None, environment="development"))
    with pytest.raises(MissingSettingsError) as excinfo, TestClient(app):
        pass
    assert "SUPABASE_URL" in str(excinfo.value)
