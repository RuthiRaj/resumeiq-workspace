"""Provider-agnostic AI gateway (B3, PRD §10.3).

Responsibilities, in order: consent -> cache -> quota -> redaction -> provider call
with retries/backoff -> structured-output validation with one repair -> grounding
validation -> cache.

Design rules this module enforces:

* **No key, no call.** With no provider key the gateway raises
  ``AINotConfiguredError``; the app still starts (AI is optional config).
* **No consent, no call.** ``consent`` is a :class:`ConsentGrant` minted only by
  ``require_ai_consent`` after checking ``consent_records``.
* **No raw PII leaves the process.** The rendered prompt (input + evidence) is
  redacted with reversible placeholders, and generated text is restored before
  validation and return.
* **No content in logs.** Only provider, model, latency, token counts, validity,
  attempt and cache/fallback flags are logged (PRD §11).
* **Fallback only for transient failure.** 429, 5xx and timeouts retry with
  exponential backoff, then move to the secondary provider. Other 4xx fail fast.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.ai.cache import InMemoryResponseCache, ResponseCache, request_cache_key
from app.ai.claims import ClaimValidator, ValidationReport
from app.ai.client import Completion, OpenAICompatibleClient, ProviderProfile
from app.ai.consent import ConsentGrant
from app.ai.errors import (
    AIConsentRequiredError,
    AIGroundingError,
    AINotConfiguredError,
    AIProviderError,
    AIRateLimitedError,
    AISchemaError,
    AIUnavailableError,
)
from app.ai.privacy import RedactionSession
from app.ai.providers import build_provider_chain, missing_provider_keys
from app.ai.quota import InMemoryDailyQuota, QuotaStore
from app.ai.schemas import EvidenceItem, GroundedResult
from app.ai.tasks import TaskSpec, get_task, strict_json_schema
from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)

GroundingPolicy = Literal["fail", "report"]

_MAX_BACKOFF_SECONDS = 8.0


@dataclass(frozen=True)
class AICallResult:
    """What the gateway returns. ``value`` is restored and schema-valid."""

    value: GroundedResult[Any]
    task: str
    provider: str
    model: str
    latency_ms: float
    attempts: int
    repaired: bool
    cached: bool
    prompt_tokens: int
    completion_tokens: int
    grounding: ValidationReport | None = None


@dataclass
class _Generation:
    value: GroundedResult[Any]
    completion: Completion
    attempts: int
    repaired: bool


class AIGateway:
    def __init__(
        self,
        providers: Sequence[ProviderProfile],
        *,
        cache: ResponseCache,
        quota: QuotaStore,
        timeout_seconds: float = 20.0,
        max_retries: int = 1,
        backoff_base_seconds: float = 0.5,
        retry_after_cap_seconds: float = 5.0,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] | None = None,
        validator: ClaimValidator | None = None,
        missing_names: tuple[str, ...] = (),
    ) -> None:
        self._providers = list(providers)
        self._cache = cache
        self._quota = quota
        self._timeout = timeout_seconds
        self._max_retries = max(0, max_retries)
        self._backoff_base = max(0.0, backoff_base_seconds)
        self._retry_after_cap = retry_after_cap_seconds
        self._transport = transport
        self._sleep = sleep or _default_sleep
        self._validator = validator or ClaimValidator()
        self._missing_names = missing_names

    @classmethod
    def from_settings(
        cls,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] | None = None,
        cache: ResponseCache | None = None,
    ) -> AIGateway:
        return cls(
            build_provider_chain(settings),
            cache=cache
            or InMemoryResponseCache(
                ttl_seconds=settings.ai_cache_ttl_seconds,
                max_entries=settings.ai_cache_max_entries,
            ),
            quota=InMemoryDailyQuota(settings.ai_daily_quota),
            timeout_seconds=settings.ai_timeout_seconds,
            max_retries=settings.ai_max_retries,
            backoff_base_seconds=settings.ai_backoff_base_seconds,
            retry_after_cap_seconds=settings.ai_retry_after_cap_seconds,
            transport=transport,
            sleep=sleep,
            missing_names=missing_provider_keys(settings),
        )

    @property
    def configured(self) -> bool:
        return bool(self._providers)

    @property
    def provider_names(self) -> tuple[str, ...]:
        return tuple(provider.name for provider in self._providers)

    async def run(
        self,
        task: str,
        payload: Any,
        evidence: Sequence[EvidenceItem],
        *,
        consent: ConsentGrant | None,
        profile: Mapping[str, str] | None = None,
        grounding: GroundingPolicy = "fail",
    ) -> AICallResult:
        """Run one typed task. Raises a typed :class:`~app.ai.errors.AIError`."""
        if not self._providers:
            raise AINotConfiguredError(self._missing_names)
        if consent is None or not consent.user_id or consent.purpose != "ai_processing":
            raise AIConsentRequiredError()

        spec = get_task(task)
        typed_payload = spec.input_model.model_validate(payload)
        evidence_ids = [item.id for item in evidence]
        if len(set(evidence_ids)) != len(evidence_ids):
            raise ValueError("Evidence ids must be unique within a call.")

        session = RedactionSession(profile_fields=profile or {})
        # Build the prompt first, then redact the whole rendering: input text and
        # every evidence line pass through the same placeholder session.
        raw_prompt = spec.build_user_prompt(typed_payload, evidence)
        messages = _messages(spec, session.redact(raw_prompt))
        schema = strict_json_schema(spec.result_model)
        cache_key = request_cache_key(
            task=task, messages=messages, schema=schema, user_id=consent.user_id
        )

        cached = self._cache.get(cache_key)
        if isinstance(cached, GroundedResult):
            logger.info(
                "ai_call",
                extra={
                    "task": task,
                    "provider": "cache",
                    "model": "-",
                    "latency_ms": 0,
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "valid": True,
                    "cache_hit": True,
                },
            )
            return AICallResult(
                value=cached.model_copy(deep=True),
                task=task,
                provider="cache",
                model="-",
                latency_ms=0.0,
                attempts=0,
                repaired=False,
                cached=True,
                prompt_tokens=0,
                completion_tokens=0,
                grounding=self._validator.validate(cached, evidence),
            )

        self._quota.consume(consent.user_id)

        transient: list[AIProviderError] = []
        for index, provider in enumerate(self._providers):
            try:
                generation = await self._generate_once(spec, provider, messages, schema, session)
            except AIProviderError as exc:
                if not exc.retryable:
                    raise
                transient.append(exc)
                if index + 1 < len(self._providers):
                    logger.info(
                        "ai_fallback",
                        extra={
                            "task": task,
                            "provider": provider.name,
                            "model": provider.model,
                            "code": exc.code,
                        },
                    )
                continue

            report = self._validator.validate(generation.value, evidence)
            if grounding == "fail" and not report.ok:
                logger.info(
                    "ai_call",
                    extra={
                        "task": task,
                        "provider": provider.name,
                        "model": provider.model,
                        "latency_ms": round(generation.completion.latency_ms),
                        "prompt_tokens": generation.completion.prompt_tokens,
                        "completion_tokens": generation.completion.completion_tokens,
                        "valid": False,
                        "code": "ai_ungrounded",
                    },
                )
                raise AIGroundingError(task, report.violations)

            self._cache.set(cache_key, generation.value)
            logger.info(
                "ai_call",
                extra={
                    "task": task,
                    "provider": provider.name,
                    "model": provider.model,
                    "latency_ms": round(generation.completion.latency_ms),
                    "prompt_tokens": generation.completion.prompt_tokens,
                    "completion_tokens": generation.completion.completion_tokens,
                    "valid": True,
                },
            )
            return AICallResult(
                value=generation.value,
                task=task,
                provider=provider.name,
                model=provider.model,
                latency_ms=generation.completion.latency_ms,
                attempts=generation.attempts,
                repaired=generation.repaired,
                cached=False,
                prompt_tokens=generation.completion.prompt_tokens,
                completion_tokens=generation.completion.completion_tokens,
                grounding=report,
            )

        raise AIUnavailableError(tuple(transient))

    async def _generate_once(
        self,
        spec: TaskSpec,
        provider: ProviderProfile,
        messages: list[dict[str, str]],
        schema: Mapping[str, Any],
        session: RedactionSession,
    ) -> _Generation:
        completion, attempts = await self._call_with_retries(provider, messages, schema, spec.name)
        parsed, reason = _validate(spec, completion, session)
        if parsed is not None:
            return _Generation(parsed, completion, attempts, repaired=False)

        # Exactly one repair attempt, on the same provider, with the schema
        # errors and the invalid (already redacted) output as context.
        repair_messages = [
            *messages,
            {"role": "assistant", "content": completion.content[:6000]},
            {"role": "user", "content": _repair_instruction(reason)},
        ]
        completion, repair_attempts = await self._call_with_retries(
            provider, repair_messages, schema, spec.name
        )
        parsed, reason = _validate(spec, completion, session)
        if parsed is None:
            raise AISchemaError(spec.name, provider=provider.name, reason=reason)
        return _Generation(parsed, completion, attempts + repair_attempts, repaired=True)

    async def _call_with_retries(
        self,
        provider: ProviderProfile,
        messages: list[dict[str, str]],
        schema: Mapping[str, Any],
        task: str,
    ) -> tuple[Completion, int]:
        client = OpenAICompatibleClient(
            provider, timeout_seconds=self._timeout, transport=self._transport
        )
        total_attempts = 1 + self._max_retries
        for attempt in range(total_attempts):
            try:
                completion = await client.complete(messages, schema=schema, schema_name=task)
            except AIProviderError as exc:
                logger.info(
                    "ai_attempt",
                    extra={
                        "task": task,
                        "provider": provider.name,
                        "model": provider.model,
                        "attempt": attempt + 1,
                        "code": exc.code,
                        "valid": False,
                    },
                )
                if not exc.retryable or attempt == total_attempts - 1:
                    raise
                delay = self._backoff(attempt)
                if isinstance(exc, AIRateLimitedError) and exc.retry_after is not None:
                    if exc.retry_after > self._retry_after_cap:
                        raise
                    delay = exc.retry_after
                await self._sleep(delay)
                continue
            logger.info(
                "ai_attempt",
                extra={
                    "task": task,
                    "provider": provider.name,
                    "model": provider.model,
                    "attempt": attempt + 1,
                    "latency_ms": round(completion.latency_ms),
                    "prompt_tokens": completion.prompt_tokens,
                    "completion_tokens": completion.completion_tokens,
                    "valid": True,
                },
            )
            return completion, attempt + 1
        raise AssertionError("unreachable")  # pragma: no cover

    def _backoff(self, attempt: int) -> float:
        return float(min(_MAX_BACKOFF_SECONDS, self._backoff_base * (2**attempt)))


def _messages(spec: TaskSpec, user_prompt: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": spec.system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def _repair_instruction(reason: str) -> str:
    return (
        "Your previous response was rejected: "
        + reason
        + ". Return only corrected JSON that matches the supplied schema for the same "
        "task. Use the same evidence ids. Do not add facts."
    )


def _validate(
    spec: TaskSpec, completion: Completion, session: RedactionSession
) -> tuple[GroundedResult | None, str]:
    """Parse + restore + validate. Returns (result, reason); reason is safe."""
    if not completion.content.strip():
        return None, "the response was empty"
    payload = _extract_json(completion.content)
    if payload is None:
        return None, "the response was not valid JSON"
    restored = session.restore_payload(payload)
    try:
        result = spec.result_model.model_validate(restored)
    except Exception as exc:  # pydantic.ValidationError, kept out of the log
        locations = _error_locations(exc)
        return None, f"the JSON did not match the schema ({locations})"
    return result, ""


def _extract_json(content: str) -> Any | None:
    """Parse JSON, tolerating markdown fences around it."""
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text[:-3]
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except (ValueError, TypeError):
        return None


def _error_locations(exc: Exception) -> str:
    """Field paths and messages only; never the offending values."""
    errors = getattr(exc, "errors", None)
    if not callable(errors):
        return type(exc).__name__
    parts: list[str] = []
    try:
        for error in errors():
            location = ".".join(str(part) for part in error.get("loc", ()))
            parts.append(f"{location}: {error.get('msg', 'invalid')}")
    except Exception:  # pragma: no cover - defensive
        return "schema mismatch"
    return "; ".join(parts[:5]) or "schema mismatch"


async def _default_sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)
