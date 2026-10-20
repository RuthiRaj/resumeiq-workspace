"""Probe the two Supabase test users' password sign-in.

Reads the runtime ``backend/.env`` and the test credentials from
``backend/.env.test`` through ``tests/supabase_auth.py``. Output is deliberately
limited to the user label, the HTTP status and the Supabase error-code string
(for example ``invalid_credentials`` or ``email_not_confirmed``). Emails,
passwords, tokens and response bodies are never printed.

    cd backend && uv run python scripts/check_test_users.py

Exit status is 0 only when both users sign in with HTTP 200.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from tests import supabase_auth  # noqa: E402


def main() -> int:
    settings = supabase_auth.env()
    project_ready = bool(settings.supabase_url and settings.supabase_publishable_key)

    accounts = (
        ("A", settings.supabase_test_email_a, settings.supabase_test_password_a),
        ("B", settings.supabase_test_email_b, settings.supabase_test_password_b),
    )

    ok = True
    for label, email, password in accounts:
        if not project_ready:
            print(f"{label}: HTTP 0 code=missing_project_config")
            ok = False
            continue
        if not email or not password:
            print(f"{label}: HTTP 0 code=missing_credentials")
            ok = False
            continue
        try:
            status, code = supabase_auth.password_sign_in_status(email, password)
        except Exception:
            # Never render a traceback: it could include credentials.
            print(f"{label}: HTTP 0 code=probe_error")
            ok = False
            continue

        suffix = f" code={code}" if code else ""
        print(f"{label}: HTTP {status}{suffix}")
        if status != 200:
            ok = False

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
