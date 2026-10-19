"""Application configuration (pydantic-settings). No secrets in code."""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

AIProviderName = Literal["groq", "nvidia"]

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

    # --- AI gateway (B3, PRD §10.3) ---------------------------------------
    # Keys are OPTIONAL: the backend must start without them, and an AI call
    # then fails with a typed ``ai_not_configured`` error instead of reaching
    # the network. Base URLs and model IDs are configuration, never literals in
    # the gateway (ADR-029). The defaults below were verified against the
    # providers' docs **and live probes** on 2026-10-19 (see the ADR) and are
    # overridable.
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "openai/gpt-oss-120b"

    nvidia_api_key: str = ""
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    #: Verified against the live catalog on 2026-10-19: the old default
    #: ``meta/llama-3.3-70b-instruct`` is end-of-life (HTTP 410), so the default
    #: is a model that answered structured-output requests during the bake-off.
    nvidia_model: str = "openai/gpt-oss-20b"

    ai_primary_provider: AIProviderName = "groq"
    ai_secondary_provider: AIProviderName = "nvidia"
    ai_timeout_seconds: float = 20.0
    #: Retries *per provider* after the first failed attempt.
    ai_max_retries: int = 1
    ai_backoff_base_seconds: float = 0.5
    #: A 429 whose ``Retry-After`` exceeds this falls back immediately instead
    #: of sleeping, so one slow provider cannot hold the request.
    ai_retry_after_cap_seconds: float = 5.0
    #: Reasoning models spend completion tokens on reasoning before the JSON, so
    #: a 1024-token cap truncated one bake-off generation. 2048 leaves headroom
    #: for the four small result models without a material cost increase.
    ai_max_output_tokens: int = 2048
    #: Per-user, per-UTC-day AI call ceiling (in-memory in B3; the interface is
    #: ready for a database-backed store).
    ai_daily_quota: int = 50
    ai_cache_ttl_seconds: int = 900
    ai_cache_max_entries: int = 256

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

    @property
    def ai_configured(self) -> bool:
        """True when at least one AI provider key is present.

        AI is deliberately absent from ``REQUIRED_ENV_VARS``: the app must start
        without AI keys (B3 requirement), and only an AI call then fails.
        """
        return bool(self.groq_api_key or self.nvidia_api_key)

    def missing_ai_optional(self) -> list[str]:
        """Names of AI variables that are unset (never their values)."""
        names = ("GROQ_API_KEY", "NVIDIA_API_KEY")
        return [name for name in names if not getattr(self, name.lower())]

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
