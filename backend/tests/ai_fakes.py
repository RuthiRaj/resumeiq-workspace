"""Shared doubles for the B3 AI tests: no test here reaches the network."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx

from app.ai.cache import InMemoryResponseCache
from app.ai.client import ProviderProfile
from app.ai.consent import ConsentGrant
from app.ai.gateway import AIGateway
from app.ai.quota import InMemoryDailyQuota
from app.ai.schemas import EvidenceItem

GROQ = ProviderProfile(
    name="groq",
    base_url="https://groq.test/openai/v1",
    model="groq-test-model",
    api_key="test-key-not-real",
    max_output_tokens=512,
)

NVIDIA = ProviderProfile(
    name="nvidia",
    base_url="https://nvidia.test/v1",
    model="nvidia-test-model",
    api_key="test-key-not-real",
    max_output_tokens=512,
)

EVIDENCE = [
    EvidenceItem(
        id="ev1",
        kind="workspace_item",
        text=(
            "Built a Python service handling 12,000 requests per day with FastAPI and "
            "PostgreSQL. Worked as a Software Engineer at Northwind Labs from 2021 to 2023."
        ),
        technologies=["Python", "FastAPI", "PostgreSQL"],
        organizations=["Northwind Labs"],
        titles=["Software Engineer"],
        dates=["2021", "2023"],
    )
]

CONSENT = ConsentGrant(user_id="user-1")


def openai_body(
    content: str, *, prompt_tokens: int = 11, completion_tokens: int = 7
) -> dict[str, Any]:
    return {
        "id": "chatcmpl-test",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


def json_response(
    payload: Any, *, status: int = 200, headers: dict[str, str] | None = None
) -> httpx.Response:
    return httpx.Response(
        status_code=status,
        content=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json", **(headers or {})},
    )


def completion(
    content: str, *, prompt_tokens: int = 11, completion_tokens: int = 7
) -> httpx.Response:
    return json_response(
        openai_body(content, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
    )


def handler_sequence(
    responses: list[httpx.Response | Exception],
) -> tuple[Callable[[httpx.Request], httpx.Response], list[httpx.Request]]:
    """Return a MockTransport handler replaying ``responses`` and the seen requests."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if not responses:
            raise AssertionError("Unexpected extra provider call")
        item = responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    return handler, seen


def make_gateway(
    providers: list[ProviderProfile],
    *,
    handler: Callable[[httpx.Request], httpx.Response],
    quota_limit: int = 50,
    max_retries: int = 1,
    sleep: Callable[[float], Any] | None = None,
    cache_ttl: int = 900,
    retry_after_cap: float = 5.0,
) -> tuple[AIGateway, list[float]]:
    delays: list[float] = []

    async def record_sleep(seconds: float) -> None:
        delays.append(seconds)

    gateway = AIGateway(
        providers,
        cache=InMemoryResponseCache(ttl_seconds=cache_ttl, max_entries=16),
        quota=InMemoryDailyQuota(quota_limit),
        timeout_seconds=1.0,
        max_retries=max_retries,
        backoff_base_seconds=0.5,
        retry_after_cap_seconds=retry_after_cap,
        transport=httpx.MockTransport(handler),
        sleep=record_sleep if sleep is None else sleep,
    )
    return gateway, delays
