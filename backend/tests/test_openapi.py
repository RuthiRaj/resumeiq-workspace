"""Fails if docs/api/openapi.json is out of date. Regenerate with:

python backend/scripts/export_openapi.py
"""

import json
from pathlib import Path

from app.core.config import Settings
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]
OPENAPI_PATH = BACKEND_DIR.parent / "docs" / "api" / "openapi.json"


def test_openapi_json_is_current() -> None:
    assert OPENAPI_PATH.exists(), (
        f"{OPENAPI_PATH} is missing; run python backend/scripts/export_openapi.py"
    )
    committed = json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))
    current = create_app(Settings(environment="development")).openapi()
    assert committed == current, (
        "docs/api/openapi.json is out of date; run python backend/scripts/export_openapi.py"
    )
