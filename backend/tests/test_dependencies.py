"""Dependency floors that clear the recorded pip-audit advisories.

Pins live in `pyproject.toml`; this test makes an accidental downgrade fail CI
with the reason next to it. The authoritative check remains `pip-audit`.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]

#: Floors as of the 2026-10-24 audit. Each clears the advisory that was open.
FLOORS = {
    # starlette: PYSEC-2026-1942/-161/-2281/-2280/-249/-248 (fixed by 1.3.1).
    "starlette": (1, 3, 1),
    # fastapi: the release that declares compatibility with starlette 1.x.
    "fastapi": (0, 162, 0),
    # certifi: PYSEC-2026-4320 (fixed by 2026.10.19).
    "certifi": (2026, 10, 19),
    # pypdf: CVE-2026-115572/-115585/-115580 (fixed by 6.21.2).
    "pypdf": (6, 21, 2),
    # pytest: PYSEC-2026-1845 (fixed by 9.0.3).
    "pytest": (9, 0, 3),
}


def declared_floors() -> dict[str, tuple[int, ...]]:
    pyproject = tomllib.loads((BACKEND_DIR / "pyproject.toml").read_text(encoding="utf-8"))
    requirements: list[str] = [
        *pyproject["project"]["dependencies"],
        *pyproject["project"]["optional-dependencies"]["dev"],
        *pyproject["dependency-groups"]["dev"],
    ]
    floors: dict[str, tuple[int, ...]] = {}
    for requirement in requirements:
        name = re.split(r"[<>=!~\[]", requirement, maxsplit=1)[0].strip().lower()
        match = re.search(r">=\s*([0-9]+(?:\.[0-9]+)*)", requirement)
        if match is None:
            continue
        version = tuple(int(part) for part in match.group(1).split("."))
        version = version + (0,) * max(0, 3 - len(version))
        existing = floors.get(name)
        if existing is None or version > existing:
            floors[name] = version
    return floors


def test_every_audited_package_is_pinned_at_or_above_its_fix() -> None:
    floors = declared_floors()

    for name, required in FLOORS.items():
        assert name in floors, f"{name} must be a declared dependency"
        assert floors[name] >= required, (
            f"{name} floor {floors[name]} is below the patched {required}"
        )
