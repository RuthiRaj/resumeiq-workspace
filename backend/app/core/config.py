"""Application configuration (pydantic-settings). No secrets in code."""

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

#: Variables the app cannot serve a request without. Named here so the startup
#: check can list what is missing **by name** and never print a value.
#: Integration-test credentials live in ``backend/.env.test`` (see
#: ``.env.test.example``) and are deliberately not part of the runtime settings.
REQUIRED_ENV_VARS = ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY")


class MissingSettingsError(RuntimeError):
    """Required configuration is absent; the message names variables only."""


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

    max_request_bytes: int = 1_048_576
    rate_limit_per_minute: int = 60

    # Document import (PRD §6.2 IM-1, §11). The upload cap is applied by
    # ``RequestSizeLimitMiddleware`` per import route and re-checked by the
    # import service; the extraction deadline bounds how long a single worker
    # can be held by a pathological document.
    max_import_bytes: int = 5 * 1024 * 1024
    extraction_timeout_seconds: float = 8.0

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

    def missing_required(self) -> list[str]:
        """Names of required variables that are unset (never their values)."""
        return [name for name in REQUIRED_ENV_VARS if not getattr(self, name.lower())]

    def validate_required(self) -> None:
        """Fail fast at startup when required configuration is missing.

        The raised message lists variable **names** only, so a startup failure
        can never leak a secret into logs or crash reports.
        """
        missing = self.missing_required()
        if missing:
            raise MissingSettingsError(
                "Missing required configuration: "
                + ", ".join(missing)
                + ". Set them in the environment or backend/.env "
                "(see backend/.env.example). No values are printed."
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
