"""OpenAI-compatible HTTP client shared by every provider (B3).

Both hosted providers expose ``POST {base_url}/chat/completions`` and accept the
same structured-output request:

    response_format={"type": "json_schema", "json_schema": {"name": ..., "strict": true,
    "schema": ...}}

NVIDIA's hosted endpoint rejected ``nvext.guided_json`` for at least one current
model (400, unknown field ``guided_json``) while accepting ``response_format`` on
every model probed, so B3 uses the OpenAI-compatible form for both providers.
Verified 2026-10-19 by live probe (ADR-029).

The client never logs a URL with a key, a request body or a response body; it
returns a :class:`Completion` and raises typed errors. Groq's documented
``400 / json_validate_failed`` best-effort failure is returned as a *completion*
(not an error) so the gateway can make its single repair attempt.
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from app.ai.errors import (
    AIProviderAuthError,
    AIProviderError,
    AIRateLimitedError,
    AITimeoutError,
)


@dataclass(frozen=True)
class ProviderProfile:
    """One provider/model pair, resolved from settings (never hardcoded here)."""

    name: str
    base_url: str
    model: str
    api_key: str
    max_output_tokens: int
    #: Documentation only: free-tier limits and data terms verified in ADR-029.
    notes: str = ""

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)


@dataclass(frozen=True)
class Completion:
    provider: str
    model: str
    content: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: float
    finish_reason: str | None = None


class OpenAICompatibleClient:
    """One provider call, with timeouts and typed error mapping. No retries here."""

    def __init__(
        self,
        profile: ProviderProfile,
        *,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._profile = profile
        self._timeout = timeout_seconds
        self._transport = transport

    async def complete(
        self,
        messages: Sequence[Mapping[str, str]],
        *,
        schema: Mapping[str, Any],
        schema_name: str,
    ) -> Completion:
        payload: dict[str, Any] = {
            "model": self._profile.model,
            "messages": list(messages),
            "temperature": 0.0,
            "max_tokens": self._profile.max_output_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": schema_name,
                    "strict": True,
                    "schema": dict(schema),
                },
            },
        }

        headers = {
            "Authorization": f"Bearer {self._profile.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        url = f"{self._profile.base_url.rstrip('/')}/chat/completions"
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(
                timeout=self._timeout, transport=self._transport
            ) as client:
                response = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException:
            raise AITimeoutError(self._profile.name) from None
        except httpx.HTTPError as exc:
            raise AIProviderError(
                self._profile.name,
                f"network error ({type(exc).__name__})",
                retryable=True,
            ) from None
        latency_ms = (time.perf_counter() - started) * 1000

        status = response.status_code
        if status == 429:
            raise AIRateLimitedError(self._profile.name, retry_after=_retry_after(response))
        if status in (401, 403):
            raise AIProviderAuthError(self._profile.name, status)
        if status >= 500:
            raise AIProviderError(
                self._profile.name,
                f"server error (HTTP {status})",
                retryable=True,
                status_code=status,
            )
        if status == 400:
            invalid = _failed_generation(response)
            if invalid is not None:
                # The model answered, but its output did not satisfy the schema.
                # Hand it to the gateway as a completion so the single repair
                # attempt runs instead of failing fast on a 4xx.
                prompt_tokens, completion_tokens = _usage(response)
                return Completion(
                    provider=self._profile.name,
                    model=self._profile.model,
                    content=invalid,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    latency_ms=latency_ms,
                    finish_reason="json_validate_failed",
                )
        if status >= 400:
            # Other 4xx are request-shape or auth-configuration rejections:
            # repeating the same request cannot help, so it surfaces at once.
            raise AIProviderError(
                self._profile.name,
                f"request rejected (HTTP {status})",
                retryable=False,
                status_code=status,
            )

        try:
            body = response.json()
            choice = body["choices"][0]
            content = choice["message"].get("content") or ""
            usage = body.get("usage") or {}
            prompt_tokens = int(usage.get("prompt_tokens") or 0)
            completion_tokens = int(usage.get("completion_tokens") or 0)
            finish_reason = choice.get("finish_reason")
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            raise AIProviderError(
                self._profile.name, "malformed provider response", retryable=False
            ) from None

        return Completion(
            provider=self._profile.name,
            model=self._profile.model,
            content=content,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
            finish_reason=str(finish_reason) if finish_reason is not None else None,
        )


def _retry_after(response: httpx.Response) -> float | None:
    raw = response.headers.get("retry-after")
    if not raw:
        return None
    try:
        return max(0.0, float(raw.strip()))
    except ValueError:
        return None


def _error_code(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if isinstance(error, dict):
        code = error.get("code")
        if isinstance(code, str):
            return code
    return None


def _failed_generation(response: httpx.Response) -> str | None:
    """Return the model's invalid output when Groq reports ``json_validate_failed``.

    Groq's best-effort structured output returns HTTP 400 with that error code
    when the generated JSON does not satisfy the schema (``failed_generation``
    sits inside ``error``; a top-level copy is accepted too). Strict mode is
    guaranteed, but a truncated generation (``max_tokens``) can still land here.
    Only that documented code is treated as an invalid *output*; every other 400
    stays a hard configuration/request error. The value is never logged.
    """
    try:
        body = response.json()
    except ValueError:
        return None
    if _error_code(body) != "json_validate_failed" or not isinstance(body, dict):
        return None
    error = body.get("error")
    failed = error.get("failed_generation") if isinstance(error, dict) else None
    if not isinstance(failed, str):
        failed = body.get("failed_generation")
    return failed if isinstance(failed, str) else ""


def _usage(response: httpx.Response) -> tuple[int, int]:
    try:
        usage = response.json().get("usage") or {}
    except (ValueError, AttributeError):
        return 0, 0
    try:
        return int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)
    except (TypeError, ValueError):
        return 0, 0
