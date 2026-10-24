"""Deployment surface hardening: docs are development-only, banner is hidden."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


@pytest.mark.parametrize("environment", ["test", "staging", "production", "PRODUCTION"])
@pytest.mark.parametrize("path", DOCS_PATHS)
def test_docs_are_not_mounted_outside_development(
    settings: Settings, environment: str, path: str
) -> None:
    client = TestClient(create_app(settings.model_copy(update={"environment": environment})))

    assert client.get(path).status_code == 404


def test_docs_stay_available_in_development() -> None:
    development = Settings(
        _env_file=None,
        environment="development",
        supabase_url="https://test.supabase.co",
        supabase_publishable_key="placeholder-not-a-real-key",
    )
    client = TestClient(create_app(development))

    for path in DOCS_PATHS:
        assert client.get(path).status_code == 200, path


def test_docker_image_hides_the_uvicorn_server_header() -> None:
    dockerfile = (BACKEND_DIR / "Dockerfile").read_text(encoding="utf-8")

    assert "--no-server-header" in dockerfile, (
        "the production image must not advertise `Server: uvicorn`"
    )


def test_documented_uvicorn_commands_hide_the_server_header() -> None:
    readmes = [
        BACKEND_DIR / "README.md",
        BACKEND_DIR.parent / "frontend" / "README.md",
    ]
    commands = [
        line.strip()
        for readme in readmes
        for line in readme.read_text(encoding="utf-8").splitlines()
        if "uvicorn app.main:app" in line
    ]

    assert commands, "expected documented uvicorn start commands"
    for command in commands:
        assert "--no-server-header" in command, command
