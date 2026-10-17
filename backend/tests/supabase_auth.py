"""Sign-in helper for the opt-in Supabase integration tests (B1 verification).

Reads values from ``backend/.env`` (or the real environment) via
pydantic-settings and exchanges the two test users' email/password for access
tokens through Supabase Auth (password grant). Nothing here logs or prints a
password or a token, and importing the module is silent, so a skipped run stays
quiet.

Required values (see ``backend/.env.example``):

    RUN_SUPABASE_INTEGRATION=1
    SUPABASE_URL=https://<project>.supabase.co
    SUPABASE_PUBLISHABLE_KEY=<publishable/anon key>
    SUPABASE_TEST_EMAIL_A / SUPABASE_TEST_PASSWORD_A
    SUPABASE_TEST_EMAIL_B / SUPABASE_TEST_PASSWORD_B   # optional (isolation)

An explicit ``SUPABASE_TEST_TOKEN_A`` / ``SUPABASE_TEST_TOKEN_B`` wins over the
email/password pair when present, so an already-signed-in token can be reused.
"""

from __future__ import annotations

import functools
from pathlib import Path

import httpx
from pydantic_settings import BaseSettings, SettingsConfigDict

#: ``backend/.env`` resolved from this file, so the helper works from any CWD.
_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
_TIMEOUT_SECONDS = 20.0


class MissingCredentialsError(RuntimeError):
    """A required integration credential is absent, or sign-in failed."""


class _IntegrationEnv(BaseSettings):
    """Only the fields the integration tests need; unknown vars are ignored."""

    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    run_supabase_integration: bool = False
    supabase_url: str = ""
    supabase_publishable_key: str = ""

    supabase_test_token_a: str = ""
    supabase_test_token_b: str = ""
    supabase_test_email_a: str = ""
    supabase_test_password_a: str = ""
    supabase_test_email_b: str = ""
    supabase_test_password_b: str = ""


@functools.lru_cache(maxsize=1)
def env() -> _IntegrationEnv:
    """Read and cache the integration environment (never logged)."""
    return _IntegrationEnv()


def _has_account_a(settings: _IntegrationEnv) -> bool:
    return bool(
        settings.supabase_test_token_a
        or (settings.supabase_test_email_a and settings.supabase_test_password_a)
    )


def _has_account_b(settings: _IntegrationEnv) -> bool:
    return bool(
        settings.supabase_test_token_b
        or (settings.supabase_test_email_b and settings.supabase_test_password_b)
    )


def enabled() -> bool:
    """True when the gate, connection details and user A's credentials exist."""
    settings = env()
    return bool(
        settings.run_supabase_integration
        and settings.supabase_url
        and settings.supabase_publishable_key
        and _has_account_a(settings)
    )


def isolation_available() -> bool:
    """True when user B's credentials are present, so isolation tests can run."""
    return _has_account_b(env())


def skip_reason() -> str:
    return (
        "integration disabled: set RUN_SUPABASE_INTEGRATION=1, SUPABASE_URL, "
        "SUPABASE_PUBLISHABLE_KEY and the test-user credentials in backend/.env"
    )


def _sign_in(email: str, password: str, label: str) -> str:
    settings = env()
    base = settings.supabase_url.rstrip("/")
    response = httpx.post(
        f"{base}/auth/v1/token",
        params={"grant_type": "password"},
        headers={
            "apikey": settings.supabase_publishable_key,
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password},
        timeout=_TIMEOUT_SECONDS,
    )
    if response.status_code != 200:
        # Deliberately omit the body: Supabase echoes the email on some errors.
        raise MissingCredentialsError(
            f"Supabase sign-in failed for {label} (HTTP {response.status_code})."
        )
    token = response.json().get("access_token")
    if not token:
        raise MissingCredentialsError(f"Supabase sign-in returned no access token for {label}.")
    return str(token)


def _resolve(explicit: str, email: str, password: str, label: str) -> str:
    if explicit:
        return explicit
    if email and password:
        return _sign_in(email, password, label)
    raise MissingCredentialsError(f"{label}: set a token or an email/password pair.")


def access_token_a() -> str:
    """Access token for test user A (the caller performing the mutations)."""
    settings = env()
    return _resolve(
        settings.supabase_test_token_a,
        settings.supabase_test_email_a,
        settings.supabase_test_password_a,
        "SUPABASE_TEST_*_A",
    )


def access_token_b() -> str:
    """Access token for test user B (the 'other user' in isolation tests)."""
    settings = env()
    return _resolve(
        settings.supabase_test_token_b,
        settings.supabase_test_email_b,
        settings.supabase_test_password_b,
        "SUPABASE_TEST_*_B",
    )
