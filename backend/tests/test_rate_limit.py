"""Rate limiting: per IP for anonymous callers, per verified user after sign-in.

A shared per-IP bucket lets one signed-in person exhaust everybody behind the
same NAT/office IP. Authenticated requests are therefore keyed by the verified
`sub` from the bearer token, with their own (higher) budget.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from tests.conftest import make_token

USER_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
USER_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"


def token_for(sub: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub=sub)}"}


def build_client(settings: Settings, **overrides: int) -> TestClient:
    configured = settings.model_copy(update=overrides)
    return TestClient(create_app(configured))


def test_authenticated_limit_is_higher_by_default() -> None:
    settings = Settings(_env_file=None)

    assert settings.authenticated_rate_limit_per_minute == 240
    assert settings.authenticated_rate_limit_per_minute > settings.rate_limit_per_minute


def test_one_user_cannot_exhaust_another_users_allowance(settings: Settings) -> None:
    client = build_client(
        settings,
        rate_limit_per_minute=1000,
        authenticated_rate_limit_per_minute=2,
    )

    first = client.get("/api/v1/me", headers=token_for(USER_A))
    second = client.get("/api/v1/me", headers=token_for(USER_A))
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text

    exhausted = client.get("/api/v1/me", headers=token_for(USER_A))
    assert exhausted.status_code == 429
    assert exhausted.json()["detail"]["code"] == "rate_limited"
    assert "Retry-After" in exhausted.headers

    # Same IP, different verified user: their own fresh budget.
    other_user = client.get("/api/v1/me", headers=token_for(USER_B))
    assert other_user.status_code == 200, other_user.text


def test_anonymous_requests_keep_the_per_ip_limit(settings: Settings) -> None:
    client = build_client(
        settings,
        rate_limit_per_minute=1,
        authenticated_rate_limit_per_minute=1000,
    )

    assert client.get("/health").status_code == 200
    limited = client.get("/health")
    assert limited.status_code == 429
    assert "Retry-After" in limited.headers
