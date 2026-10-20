"""Report which required environment variables are set or missing.

For the runtime app (``backend/.env``) and the opt-in integration tests
(``backend/.env.test``). Prints variable **names** and a ``set``/``missing``/
``using default`` status only — a value is never read into the output.

Optional AI base URLs and model names have built-in defaults in ``Settings``,
so an unset one is reported as ``using default`` rather than ``missing``.
Only API keys are truly ``missing`` when absent.

    cd backend && uv run python scripts/check_env.py
    cd backend && uv run python scripts/check_env.py --strict  # exit 1 if app vars missing
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import REQUIRED_ENV_VARS, Settings  # noqa: E402
from tests import supabase_auth  # noqa: E402

#: Optional AI variables, reported for visibility only (names, never values).
OPTIONAL_AI_ENV_VARS = (
    "GROQ_API_KEY",
    "GROQ_BASE_URL",
    "GROQ_MODEL",
    "NVIDIA_API_KEY",
    "NVIDIA_BASE_URL",
    "NVIDIA_MODEL",
)

#: Optional AI variables that fall back to a built-in default when unset.
#: Reporting these as "missing" was misleading: the gateway still works without
#: them, so they are shown as "using default" instead.
AI_DEFAULTED_ENV_VARS = (
    "GROQ_BASE_URL",
    "GROQ_MODEL",
    "NVIDIA_BASE_URL",
    "NVIDIA_MODEL",
)

#: Dotenv files the backend reads, in precedence order (later wins).
ENV_FILES = (BACKEND_DIR / ".env", BACKEND_DIR / ".env.test")


def present(name: str) -> bool:
    """True when ``name`` has a non-empty value in the environment or a .env file.

    Presence only: the value itself is never returned or printed.
    """
    if os.environ.get(name, "").strip():
        return True
    for path in ENV_FILES:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for raw in text.splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key.strip() == name and value.strip():
                return True
    return False


def builtin_default(name: str) -> str | None:
    """The built-in default for an optional variable, or ``None`` if it has none.

    Read from ``Settings`` so the report cannot drift from the real defaults.
    The default is configuration, not a secret, and only its existence is used.
    """
    field = Settings.model_fields.get(name.lower())
    if field is None or field.is_required():
        return None
    default = field.default
    return default if isinstance(default, str) and default else None


def line(label: str, status: bool | str) -> str:
    if isinstance(status, bool):
        status = "set" if status else "missing"
    return f"  [{status}] {label}"


def var_line(name: str) -> str:
    """``set``, ``using default`` (optional with a built-in default), or ``missing``."""
    if present(name):
        return line(name, "set")
    if name in AI_DEFAULTED_ENV_VARS and builtin_default(name):
        return line(name, "using default")
    return line(name, "missing")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Report set/missing environment variables (names only)."
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit non-zero when an app-required variable is missing",
    )
    args = parser.parse_args()

    app_missing = [name for name in REQUIRED_ENV_VARS if not present(name)]

    print("ResumeIQ environment check - names only; no values are ever printed.")
    print()
    print("App (runtime, backend/.env):")
    for name in REQUIRED_ENV_VARS:
        print(line(name, present(name)))
    print()
    print("Tests (backend/.env.test + backend/.env):")
    account_a = present("SUPABASE_TEST_TOKEN_A") or (
        present("SUPABASE_TEST_EMAIL_A") and present("SUPABASE_TEST_PASSWORD_A")
    )
    account_b = present("SUPABASE_TEST_TOKEN_B") or (
        present("SUPABASE_TEST_EMAIL_B") and present("SUPABASE_TEST_PASSWORD_B")
    )
    print(line("RUN_SUPABASE_INTEGRATION", present("RUN_SUPABASE_INTEGRATION")))
    print(line("SUPABASE_URL (shared with the app)", present("SUPABASE_URL")))
    print(
        line("SUPABASE_PUBLISHABLE_KEY (shared with the app)", present("SUPABASE_PUBLISHABLE_KEY"))
    )
    print(line("SUPABASE_TEST_*_A (token, or email + password)", account_a))
    print(line("SUPABASE_TEST_*_B (optional; isolation tests)", account_b))
    print()
    print("AI providers (optional; backend/.env):")
    for name in OPTIONAL_AI_ENV_VARS:
        print(var_line(name))
    ai_ready = present("GROQ_API_KEY") or present("NVIDIA_API_KEY")
    print(
        "AI calls would "
        + (
            "run against the configured provider(s)."
            if ai_ready
            else "fail with ai_not_configured."
        )
    )
    print()
    print(f"Integration tests would {'run' if supabase_auth.enabled() else 'be skipped'}.")

    if args.strict and app_missing:
        print()
        print("Missing app-required variables: " + ", ".join(app_missing))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
