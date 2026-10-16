"""Export the FastAPI OpenAPI schema to docs/api/openapi.json.

The exported file is the contract between backend and frontend (see AGENTS.md):
frontend Zod schemas and MSW handlers must match it. Run from the repo root or
from /backend:

    python backend/scripts/export_openapi.py
    # or: cd backend && python scripts/export_openapi.py

`tests/test_openapi.py` fails if the committed file is out of date.
"""

import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
OUTPUT = REPO_ROOT / "docs" / "api" / "openapi.json"

sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


def main() -> None:
    settings = Settings(environment="development")
    schema = create_app(settings).openapi()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
