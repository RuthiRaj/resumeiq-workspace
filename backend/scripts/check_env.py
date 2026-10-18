"""Report which required environment variables are set or missing.

For the runtime app (``backend/.env``) and the opt-in integration tests
(``backend/.env.test``). Prints variable **names** and a ``set``/``missing``
status only — a value is never read into the output.

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

from app.core.config import REQUIRED_ENV_VARS  # noqa: E402
from tests import supabase_auth  # noqa: E402

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


def line(label: str, is_set: bool) -> str:
    return f"  [{'set' if is_set else 'missing'}] {label}"


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
    print(f"Integration tests would {'run' if supabase_auth.enabled() else 'be skipped'}.")

    if args.strict and app_missing:
        print()
        print("Missing app-required variables: " + ", ".join(app_missing))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
