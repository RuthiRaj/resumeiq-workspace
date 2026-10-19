"""AI-processing consent (PRD EX-3, §11).

No AI call may run without a recorded grant in ``consent_records``. The FastAPI
dependency ``app.api.deps.require_ai_consent`` returns a :class:`ConsentGrant`
only after the store confirms one, and :class:`~app.ai.gateway.AIGateway`
requires that token as an argument — so the gateway cannot be called without
going through the dependency.

A Supabase-backed store reads ``consent_records`` through the Data API with the
*caller's* JWT, so RLS applies; it fails closed (deny) when the store is
unreachable. The in-memory store exists for tests and for local development
before the consent UI lands.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)

ConsentPurpose = Literal["ai_processing"]


@dataclass(frozen=True)
class ConsentGrant:
    """Proof that a grant was checked. Only the dependency may mint one."""

    user_id: str
    purpose: ConsentPurpose = "ai_processing"
    source: str = "consent_records"

    @classmethod
    def for_synthetic_data(cls, *, user_id: str) -> ConsentGrant:
        """Bake-off only: synthetic fixtures contain no real person's data."""
        return cls(user_id=user_id, source="synthetic_fixture")


@runtime_checkable
class ConsentStore(Protocol):
    """Read-only view of recorded consents."""

    def has_ai_consent(self, user_id: str) -> bool: ...


class InMemoryConsentStore:
    """Test/dev double. ``grant`` records a grant the way the future API will."""

    def __init__(self, *, granted: set[str] | None = None) -> None:
        self._granted: set[str] = set(granted or ())

    def grant(self, user_id: str) -> None:
        self._granted.add(user_id)

    def revoke(self, user_id: str) -> None:
        self._granted.discard(user_id)

    def has_ai_consent(self, user_id: str) -> bool:
        return user_id in self._granted


class SupabaseConsentStore:
    """Reads ``consent_records`` via PostgREST with the caller's JWT."""

    def __init__(
        self,
        rest_url: str,
        api_key: str,
        access_token: str,
        *,
        timeout_seconds: float = 5.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._rest_url = rest_url.rstrip("/")
        self._api_key = api_key
        self._access_token = access_token
        self._timeout = timeout_seconds
        self._transport = transport

    def has_ai_consent(self, user_id: str) -> bool:
        params = {
            "select": "id",
            "user_id": f"eq.{user_id}",
            "purpose": "eq.ai_processing",
            "granted": "is.true",
            "revoked_at": "is.null",
            "limit": "1",
        }
        headers = {
            "apikey": self._api_key,
            "Authorization": f"Bearer {self._access_token}",
            "Accept": "application/json",
        }
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                response = client.get(
                    f"{self._rest_url}/consent_records", params=params, headers=headers
                )
        except httpx.HTTPError as exc:
            # Fail closed: no answer is not consent. Only the error type is logged.
            logger.info("ai_consent_lookup_failed", extra={"code": type(exc).__name__})
            return False
        if response.status_code != 200:
            logger.info("ai_consent_lookup_failed", extra={"code": f"http_{response.status_code}"})
            return False
        try:
            rows = response.json()
        except ValueError:
            logger.info("ai_consent_lookup_failed", extra={"code": "invalid_json"})
            return False
        return isinstance(rows, list) and len(rows) > 0
