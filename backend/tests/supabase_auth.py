"""Sign-in helper for the opt-in Supabase integration tests (B1 verification).

Reads the runtime project values from ``backend/.env`` and the test-only gate and
credentials from ``backend/.env.test`` (git-ignored; see ``.env.test.example``)
via pydantic-settings. Keeping the credentials out of the runtime ``.env`` means a
deployed backend never holds test passwords.

The two test users' email/password are exchanged for access tokens through
Supabase Auth (password grant). Nothing here logs or prints a password or a
token, and importing the module is silent, so a skipped run stays quiet.

Values (see ``backend/.env.test.example``):

    RUN_SUPABASE_INTEGRATION=1
    SUPABASE_TEST_EMAIL_A / SUPABASE_TEST_PASSWORD_A
    SUPABASE_TEST_EMAIL_B / SUPABASE_TEST_PASSWORD_B   # optional (isolation)
    RUN_LIVE_SMOKE / RUN_LIVE_E2E                     # optional live gates

``SUPABASE_URL`` and ``SUPABASE_PUBLISHABLE_KEY`` are read from the runtime
``backend/.env``.

An explicit ``SUPABASE_TEST_TOKEN_A`` / ``SUPABASE_TEST_TOKEN_B`` wins over the
email/password pair when present, so an already-signed-in token can be reused.
"""

from __future__ import annotations

import functools
import os
from pathlib import Path

import httpx
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Runtime project values (URL + publishable key), from ``backend/.env``.
_RUNTIME_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
#: Test-only gate + credentials, from ``backend/.env.test``. Loaded last so it
#: wins over the runtime file for any name that appears in both.
_TEST_ENV_FILE = Path(__file__).resolve().parents[1] / ".env.test"
_TIMEOUT_SECONDS = 20.0


class MissingCredentialsError(RuntimeError):
    """A required integration credential is absent, or sign-in failed."""


class _IntegrationEnv(BaseSettings):
    """Only the fields the integration tests need; unknown vars are ignored.

    Loads the runtime ``.env`` (project URL + publishable key) first, then
    ``.env.test`` (gate + credentials) so the test file wins on any overlap.
    """

    model_config = SettingsConfigDict(env_file=(_RUNTIME_ENV_FILE, _TEST_ENV_FILE), extra="ignore")

    run_supabase_integration: bool = False
    #: Opt-in gates for the live smoke and the live Playwright suite. They may
    #: live in ``backend/.env.test`` so no terminal export is needed.
    run_live_smoke: bool = False
    run_live_e2e: bool = False
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
    """Name every condition that currently disables the integration tests."""
    settings = env()
    missing: list[str] = []
    if not settings.run_supabase_integration:
        missing.append("RUN_SUPABASE_INTEGRATION is not 1 in backend/.env.test")
    if not settings.supabase_url or not settings.supabase_publishable_key:
        missing.append("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are missing from backend/.env")
    if not _has_account_a(settings):
        missing.append("user A credentials are missing from backend/.env.test")
    if not missing:
        return "integration tests are enabled"
    return "integration tests disabled: " + "; ".join(missing)


def live_smoke_enabled() -> bool:
    """True when ``RUN_LIVE_SMOKE=1`` is exported or set in ``.env.test``."""
    return os.environ.get("RUN_LIVE_SMOKE") == "1" or env().run_live_smoke


def live_e2e_enabled() -> bool:
    """True when ``RUN_LIVE_E2E=1`` is exported or set in ``.env.test``.

    Kept here for parity with the Python side; the Playwright config and specs
    read the same file directly in Node (they cannot import this module).
    """
    return os.environ.get("RUN_LIVE_E2E") == "1" or env().run_live_e2e


@functools.lru_cache(maxsize=1)
def import_schema_status() -> tuple[bool, str]:
    """Probe the Data API read-only for the import tables (migration 0004).

    Returns ``(available, detail)``. The probe uses the publishable key as the
    ``anon`` role: PostgREST reports a missing table before privileges are
    checked (404 ``PGRST205``), while an applied table answers 401/403 for
    ``anon`` because 0004 revokes its access. No user credential is needed and
    nothing is written, so this is safe to call from a skip check.
    """
    settings = env()
    if not (settings.supabase_url and settings.supabase_publishable_key):
        return False, "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not set in backend/.env"
    base = settings.supabase_url.rstrip("/")
    headers = {
        "apikey": settings.supabase_publishable_key,
        "Accept": "application/json",
    }
    try:
        response = httpx.get(
            f"{base}/rest/v1/import_sessions",
            params={"select": "id", "limit": "1"},
            headers=headers,
            timeout=_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        return False, f"the Data API could not be reached ({type(exc).__name__})"

    try:
        body = response.json()
    except ValueError:
        body = None
    code = str(body.get("code", "")) if isinstance(body, dict) else ""

    if response.status_code < 400:
        return True, "import_sessions is reachable"
    if response.status_code in (401, 403) or code in {"42501", "PGRST301"}:
        # The table exists; `anon` is simply not allowed to read it (as designed).
        return True, "import_sessions exists (access limited to authenticated users)"
    if response.status_code == 404 or code in {"PGRST204", "PGRST205"}:
        return (
            False,
            "migration 0004_imports.sql is not applied "
            "(import_sessions is not in the PostgREST schema cache)",
        )
    detail = f"the Data API answered HTTP {response.status_code}"
    return False, detail + (f" ({code})" if code else "")


def _password_grant(email: str, password: str) -> tuple[int, str, str]:
    """Exchange an email/password for a token.

    Returns ``(HTTP status, Supabase error code, access token)``. The response
    body is parsed only for those fields and is never logged or printed. A
    transport failure returns status ``0`` and code ``network_error`` so no
    traceback can echo the credentials.
    """
    settings = env()
    base = settings.supabase_url.rstrip("/")
    try:
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
    except httpx.HTTPError:
        return 0, "network_error", ""

    try:
        body = response.json()
    except ValueError:
        body = None

    code = ""
    if isinstance(body, dict):
        # Supabase uses `error_code` on newer responses; older ones use
        # `error`. `code` can be the numeric HTTP status, so only keep strings.
        for key in ("error_code", "code", "error"):
            value = body.get(key)
            if isinstance(value, str) and value and not value.isdigit():
                code = value
                break

    token = ""
    if response.status_code == 200 and isinstance(body, dict):
        token = str(body.get("access_token") or "")
    return response.status_code, code, token


def password_sign_in_status(email: str, password: str) -> tuple[int, str]:
    """Attempt a password sign-in and return ``(HTTP status, error code)``.

    Used by ``scripts/check_test_users.py``. The token, if any, is discarded
    here and no email, password, token or response body is ever returned to
    the caller or printed.
    """
    status, code, _ = _password_grant(email, password)
    return status, code


def _sign_in(label: str, which: str) -> str:
    """Sign in as user ``which`` (``a``/``b``) without exposing credentials.

    The credentials are read inside this function instead of being passed as
    arguments, so a traceback header cannot echo them.
    """
    settings = env()
    if which == "b":
        email = settings.supabase_test_email_b
        password = settings.supabase_test_password_b
    else:
        email = settings.supabase_test_email_a
        password = settings.supabase_test_password_a

    status, code, token = _password_grant(email, password)
    if status != 200:
        # Deliberately omit the body: Supabase echoes the email on some errors.
        detail = f" (HTTP {status}" + (f", code {code}" if code else "") + ")"
        raise MissingCredentialsError(f"Supabase sign-in failed for {label}{detail}.")
    if not token:
        raise MissingCredentialsError(f"Supabase sign-in returned no access token for {label}.")
    return token


def _resolve(which: str) -> str:
    """Return a token for user ``which`` from an explicit token or sign-in."""
    settings = env()
    if which == "b":
        explicit = settings.supabase_test_token_b
        has_pair = bool(settings.supabase_test_email_b and settings.supabase_test_password_b)
        label = "SUPABASE_TEST_*_B"
    else:
        explicit = settings.supabase_test_token_a
        has_pair = bool(settings.supabase_test_email_a and settings.supabase_test_password_a)
        label = "SUPABASE_TEST_*_A"
    if explicit:
        return explicit
    if has_pair:
        return _sign_in(label, which)
    raise MissingCredentialsError(f"{label}: set a token or an email/password pair.")


def access_token_a() -> str:
    """Access token for test user A (the caller performing the mutations)."""
    return _resolve("a")


def access_token_b() -> str:
    """Access token for test user B (the 'other user' in isolation tests)."""
    return _resolve("b")


def current_user_id(token: str) -> str:
    """Resolve the caller's user id via Supabase Auth (token never logged)."""
    settings = env()
    base = settings.supabase_url.rstrip("/")
    response = httpx.get(
        f"{base}/auth/v1/user",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
        },
        timeout=_TIMEOUT_SECONDS,
    )
    if response.status_code != 200:
        raise MissingCredentialsError(f"Supabase /user failed (HTTP {response.status_code}).")
    user_id = response.json().get("id")
    if not user_id:
        raise MissingCredentialsError("Supabase /user returned no id.")
    return str(user_id)
