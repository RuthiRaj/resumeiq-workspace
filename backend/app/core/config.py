"""Application configuration (pydantic-settings). No secrets in code."""

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """All backend configuration comes from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    log_level: str = "INFO"
    api_v1_prefix: str = "/api/v1"
    app_version: str = "0.1.0"

    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    supabase_url: str = ""
    supabase_jwks_url: str = ""
    supabase_jwt_secret: str = ""
    supabase_jwt_audience: str = "authenticated"
    supabase_jwt_issuer: str = ""

    # Supabase Data API (PostgREST): the publishable/anon key is the `apikey`
    # header; user data is reached with the *caller's* JWT so RLS applies. The
    # service_role key is never used (ADR-016).
    supabase_publishable_key: str = ""

    # Opt-in gate for tests that hit a real Supabase project (skipped when unset).
    run_supabase_integration: bool = False

    max_request_bytes: int = 1_048_576
    rate_limit_per_minute: int = 60

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [o.strip() for o in value.split(",") if o.strip()]
        return value

    @property
    def jwks_url(self) -> str:
        """Effective JWKS URL: explicit override, else derived from SUPABASE_URL."""
        if self.supabase_jwks_url:
            return self.supabase_jwks_url
        if self.supabase_url:
            return self.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"
        return ""

    @property
    def jwt_issuer(self) -> str:
        """Effective expected `iss` claim: explicit override, else derived."""
        if self.supabase_jwt_issuer:
            return self.supabase_jwt_issuer
        if self.supabase_url:
            return self.supabase_url.rstrip("/") + "/auth/v1"
        return ""

    @property
    def auth_configured(self) -> bool:
        """True when at least one verification path (JWKS or legacy secret) exists."""
        return bool(self.jwks_url or self.supabase_jwt_secret)

    @property
    def rest_url(self) -> str:
        """Data API base URL (``{SUPABASE_URL}/rest/v1``), or ``""`` if unset."""
        if self.supabase_url:
            return self.supabase_url.rstrip("/") + "/rest/v1"
        return ""

    @property
    def data_api_configured(self) -> bool:
        """True when the workspace Data API can be reached (URL + publishable key)."""
        return bool(self.rest_url and self.supabase_publishable_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
