"""Typed AI-gateway errors (B3).

Every error carries a stable ``code`` so B4/B5 can map it to the API's
``{"detail": {"code", "message"}}`` shape, and every message is safe to log: it
names the provider, task, status or offending token, never a prompt, a response
body or a key (PRD §11 "no personal data in logs").
"""

from __future__ import annotations

from dataclasses import dataclass


class AIError(Exception):
    """Base class for gateway failures that are safe to surface."""

    code: str = "ai_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class AINotConfiguredError(AIError):
    """No provider key is configured; the app starts, AI calls fail cleanly."""

    code = "ai_not_configured"

    def __init__(self, missing_names: tuple[str, ...] = ()) -> None:
        names = ", ".join(missing_names) if missing_names else "no AI provider key"
        super().__init__(f"AI is not configured ({names}). No external call was made.")
        self.missing_names = missing_names


class AIConsentRequiredError(AIError):
    """No recorded AI-processing consent; refused before any external call."""

    code = "ai_consent_required"

    def __init__(self) -> None:
        super().__init__("AI processing consent is required before any AI call.")


class AIQuotaExceededError(AIError):
    """The per-user daily quota is exhausted."""

    code = "ai_quota_exceeded"

    def __init__(self, limit: int, used: int, resets_at: str) -> None:
        super().__init__(f"Daily AI quota reached ({used}/{limit}). It resets at {resets_at}.")
        self.limit = limit
        self.used = used
        self.resets_at = resets_at


class AIProviderError(AIError):
    """A provider call failed. ``retryable`` drives retry and fallback."""

    code = "ai_provider_error"

    def __init__(
        self,
        provider: str,
        message: str,
        *,
        retryable: bool = False,
        status_code: int | None = None,
    ) -> None:
        super().__init__(f"{provider}: {message}")
        self.provider = provider
        self.retryable = retryable
        self.status_code = status_code


class AIProviderAuthError(AIProviderError):
    """The provider rejected the key. Never retried, never echoed."""

    code = "ai_provider_auth_failed"

    def __init__(self, provider: str, status_code: int) -> None:
        super().__init__(
            provider, "authentication failed (check the provider key)", status_code=status_code
        )


class AITimeoutError(AIProviderError):
    """The provider did not answer inside the configured timeout."""

    code = "ai_timeout"

    def __init__(self, provider: str) -> None:
        super().__init__(provider, "request timed out", retryable=True)


class AIRateLimitedError(AIProviderError):
    """HTTP 429."""

    code = "ai_rate_limited"

    def __init__(self, provider: str, *, retry_after: float | None = None) -> None:
        super().__init__(provider, "rate limited", retryable=True, status_code=429)
        self.retry_after = retry_after


class AIUnavailableError(AIError):
    """Every configured provider failed with a retryable error."""

    code = "ai_unavailable"

    def __init__(self, errors: tuple[AIProviderError, ...]) -> None:
        providers = ", ".join(sorted({error.provider for error in errors})) or "none"
        super().__init__(f"No AI provider could answer (tried: {providers}).")
        self.errors = errors


class AISchemaError(AIError):
    """The response never matched the task's Pydantic model, after one repair."""

    code = "ai_invalid_output"

    def __init__(self, task: str, *, provider: str, reason: str) -> None:
        super().__init__(f"{task}: the model output did not match the schema ({reason}).")
        self.task = task
        self.provider = provider
        self.reason = reason


@dataclass(frozen=True)
class ClaimViolation:
    """One grounding failure. ``detail`` names the token, never the claim text."""

    claim_index: int
    code: str
    detail: str


class AIGroundingError(AIError):
    """The claim validator rejected a generated claim."""

    code = "ai_ungrounded"

    def __init__(self, task: str, violations: tuple[ClaimViolation, ...]) -> None:
        codes = ", ".join(sorted({violation.code for violation in violations}))
        super().__init__(f"{task}: {len(violations)} ungrounded claim(s) rejected ({codes}).")
        self.task = task
        self.violations = violations
