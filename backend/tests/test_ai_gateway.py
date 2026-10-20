"""Gateway reliability: not-configured, retries, fallback, cache, quota, logging."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Sequence
from typing import Any

import httpx
import pytest

from app.ai.consent import ConsentGrant
from app.ai.errors import (
    AIConsentRequiredError,
    AINotConfiguredError,
    AIProviderAuthError,
    AIQuotaExceededError,
    AIUnavailableError,
)
from app.ai.gateway import AICallResult, AIGateway
from app.ai.schemas import EvidenceItem, RewriteBulletInput
from tests.ai_fakes import (
    CONSENT,
    EVIDENCE,
    GROQ,
    NVIDIA,
    completion,
    handler_sequence,
    json_response,
    make_gateway,
)

VALID = json.dumps(
    {
        "claims": [
            {
                "text": "Built a Python service handling 12,000 requests per day.",
                "evidence_ids": ["ev1"],
            }
        ]
    }
)
PAYLOAD = RewriteBulletInput(bullet="Built a Python service handling 12,000 requests per day.")


def run(
    gateway: AIGateway,
    payload: Any = PAYLOAD,
    evidence: Sequence[EvidenceItem] = EVIDENCE,
    consent: ConsentGrant | None = CONSENT,
) -> AICallResult:
    return asyncio.run(gateway.run("rewrite_bullet", payload, evidence, consent=consent))


def test_no_key_means_typed_error_and_no_call() -> None:
    called: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        called.append(request)
        return completion(VALID)

    gateway, _ = make_gateway([], handler=handler)
    with pytest.raises(AINotConfiguredError) as excinfo:
        run(gateway)
    assert "GROQ_API_KEY" not in str(excinfo.value)  # names only, and none supplied
    assert called == []


def test_gateway_reports_missing_key_names_not_values() -> None:
    from app.ai.cache import InMemoryResponseCache
    from app.ai.gateway import AIGateway
    from app.ai.quota import InMemoryDailyQuota

    gateway = AIGateway(
        [],
        cache=InMemoryResponseCache(ttl_seconds=0, max_entries=1),
        quota=InMemoryDailyQuota(10),
        missing_names=("GROQ_API_KEY", "NVIDIA_API_KEY"),
    )
    with pytest.raises(AINotConfiguredError) as excinfo:
        run(gateway)
    assert "GROQ_API_KEY" in str(excinfo.value)
    assert "NVIDIA_API_KEY" in str(excinfo.value)


def test_no_consent_means_no_call() -> None:
    called: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        called.append(request)
        return completion(VALID)

    gateway, _ = make_gateway([GROQ], handler=handler)
    with pytest.raises(AIConsentRequiredError):
        run(gateway, consent=None)
    assert called == []


def test_happy_path_reports_provider_model_tokens() -> None:
    handler, seen = handler_sequence([completion(VALID, prompt_tokens=21, completion_tokens=9)])
    gateway, delays = make_gateway([GROQ], handler=handler)

    result = run(gateway)

    assert len(seen) == 1
    assert result.provider == "groq"
    assert result.model == "groq-test-model"
    assert result.prompt_tokens == 21
    assert result.completion_tokens == 9
    assert result.attempts == 1
    assert result.repaired is False
    assert result.cached is False
    assert result.latency_ms >= 0
    assert delays == []


def test_cache_hit_makes_no_call_and_consumes_no_quota() -> None:
    handler, seen = handler_sequence([completion(VALID)])
    gateway, _ = make_gateway([GROQ], handler=handler, quota_limit=1)

    first = run(gateway)
    second = run(gateway)

    assert first.cached is False
    assert second.cached is True
    assert second.provider == "cache"
    assert len(seen) == 1
    # A second *different* call would now fail if the cache hit had used quota.
    other = RewriteBulletInput(bullet="Built a Python service.")
    with pytest.raises(AIQuotaExceededError):
        run(gateway, payload=other)


def test_cache_is_scoped_per_user() -> None:
    handler, seen = handler_sequence([completion(VALID), completion(VALID)])
    gateway, _ = make_gateway([GROQ], handler=handler)

    run(gateway, consent=ConsentGrant(user_id="user-1"))
    run(gateway, consent=ConsentGrant(user_id="user-2"))
    assert len(seen) == 2


def test_429_retries_with_backoff_then_succeeds() -> None:
    handler, seen = handler_sequence(
        [json_response({}, status=429, headers={"retry-after": "1"}), completion(VALID)]
    )
    gateway, delays = make_gateway([GROQ], handler=handler)

    result = run(gateway)

    assert result.attempts == 2
    assert delays == [1.0]  # Retry-After is honoured
    assert len(seen) == 2


def test_500_retries_with_exponential_backoff() -> None:
    handler, seen = handler_sequence(
        [json_response({}, status=500), json_response({}, status=503), completion(VALID)]
    )
    gateway, delays = make_gateway([GROQ], handler=handler, max_retries=2)

    result = run(gateway)

    assert result.attempts == 3
    assert delays == [0.5, 1.0]
    assert len(seen) == 3


def test_429_beyond_retry_after_cap_falls_back_without_sleeping() -> None:
    handler, seen = handler_sequence(
        [
            json_response({}, status=429, headers={"retry-after": "120"}),
            completion(VALID),
        ]
    )
    gateway, delays = make_gateway([GROQ, NVIDIA], handler=handler, retry_after_cap=5.0)

    result = run(gateway)

    assert result.provider == "nvidia"
    assert delays == []
    assert len(seen) == 2


def test_timeout_falls_back_to_secondary() -> None:
    handler, seen = handler_sequence([httpx.ReadTimeout("slow"), completion(VALID)])
    gateway, delays = make_gateway([GROQ, NVIDIA], handler=handler, max_retries=0)

    result = run(gateway)

    assert result.provider == "nvidia"
    assert len(seen) == 2
    assert delays == []


def test_all_providers_down_raises_unavailable() -> None:
    handler, seen = handler_sequence([json_response({}, status=502), json_response({}, status=503)])
    gateway, _ = make_gateway([GROQ, NVIDIA], handler=handler, max_retries=0)

    with pytest.raises(AIUnavailableError) as excinfo:
        run(gateway)
    assert {error.provider for error in excinfo.value.errors} == {"groq", "nvidia"}
    assert len(seen) == 2


def test_auth_failure_fails_fast_without_fallback() -> None:
    handler, seen = handler_sequence([json_response({"error": "bad key"}, status=401)])
    gateway, _ = make_gateway([GROQ, NVIDIA], handler=handler)

    with pytest.raises(AIProviderAuthError):
        run(gateway)
    assert len(seen) == 1  # the secondary is never tried for a configuration error


def test_quota_is_per_user_per_day() -> None:
    handler, seen = handler_sequence([completion(VALID), completion(VALID)])
    gateway, _ = make_gateway([GROQ], handler=handler, quota_limit=1)

    run(gateway, payload=RewriteBulletInput(bullet="Built a Python service."))
    with pytest.raises(AIQuotaExceededError):
        run(gateway, payload=RewriteBulletInput(bullet="Handled 12,000 requests."))
    assert len(seen) == 1
    # A different user has their own budget.
    run(
        gateway,
        payload=RewriteBulletInput(bullet="Built a Python service."),
        consent=ConsentGrant(user_id="u2"),
    )


def test_logs_carry_metrics_but_never_prompt_or_response_text(caplog) -> None:
    secret = "Built a Python service handling 12,000 requests per day."
    handler, _ = handler_sequence([completion(VALID)])
    gateway, _ = make_gateway([GROQ], handler=handler)

    with caplog.at_level(logging.INFO, logger="app.ai.gateway"):
        run(gateway, payload=RewriteBulletInput(bullet=secret))

    assert secret not in caplog.text
    records = [
        record for record in caplog.records if record.getMessage() in {"ai_call", "ai_attempt"}
    ]
    assert records
    extra = records[-1].__dict__
    assert extra["provider"] == "groq"
    assert extra["model"] == "groq-test-model"
    assert "latency_ms" in extra
    assert extra["valid"] is True
    assert "messages" not in extra


def test_both_providers_request_json_schema_structured_output() -> None:
    # Force the primary to fail so the secondary provider is the one that answers.
    handler, seen = handler_sequence([json_response({}, status=500), completion(VALID)])
    gateway, _ = make_gateway([GROQ, NVIDIA], handler=handler, max_retries=0)

    result = run(gateway, payload=RewriteBulletInput(bullet="Built a Python service."))
    assert result.provider == "nvidia"

    groq_body = json.loads(seen[0].content)
    nvidia_body = json.loads(seen[1].content)
    for body in (groq_body, nvidia_body):
        assert body["response_format"]["type"] == "json_schema"
        assert body["response_format"]["json_schema"]["strict"] is True
        assert body["response_format"]["json_schema"]["schema"]["additionalProperties"] is False
        assert "nvext" not in body
    assert groq_body["model"] == "groq-test-model"
    assert nvidia_body["model"] == "nvidia-test-model"


def test_structured_output_schema_is_closed() -> None:
    handler, seen = handler_sequence([completion(VALID)])
    gateway, _ = make_gateway([GROQ], handler=handler)
    run(gateway)

    schema = json.loads(seen[0].content)["response_format"]["json_schema"]["schema"]
    assert schema["additionalProperties"] is False

    def walk(node: dict) -> None:
        if node.get("type") == "object" or "properties" in node:
            assert node["additionalProperties"] is False
        for value in node.values():
            if isinstance(value, dict):
                walk(value)
            elif isinstance(value, list):
                for child in value:
                    if isinstance(child, dict):
                        walk(child)

    walk(schema)


def test_unknown_task_is_rejected_before_any_call() -> None:
    called: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        called.append(request)
        return completion(VALID)

    gateway, _ = make_gateway([GROQ], handler=handler)
    with pytest.raises(ValueError):
        asyncio.run(gateway.run("make_me_a_resume", PAYLOAD, EVIDENCE, consent=CONSENT))
    assert called == []


def test_duplicate_evidence_ids_are_rejected() -> None:
    handler, seen = handler_sequence([])
    gateway, _ = make_gateway([GROQ], handler=handler)
    with pytest.raises(ValueError):
        run(gateway, evidence=[EVIDENCE[0], EVIDENCE[0]])
    assert seen == []
