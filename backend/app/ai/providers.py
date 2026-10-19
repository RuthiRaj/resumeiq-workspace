"""Provider chain resolved from settings (B3).

Base URLs and model IDs come from ``Settings`` — the gateway never hardcodes
them. Free-tier limits and data terms live in ``_NOTES`` for documentation and
were verified in ADR-029.
"""

from __future__ import annotations

from app.ai.client import ProviderProfile
from app.core.config import AIProviderName, Settings

_NOTES = {
    "groq": (
        "Free plan per model (verified 2026-10-19): gpt-oss-120b 30 RPM / 1,000 RPD / "
        "8K TPM / 200K TPD. No retention by default; reliability logs up to 30 days; "
        "ZDR available in Data Controls. Strict json_schema structured output."
    ),
    "nvidia": (
        "Free API catalog is a trial (verified 2026-10-19): ~40 RPM global hard cap, "
        "no increases on the free tier, production requires NVIDIA AI Enterprise. "
        "Trial ToS: content not stored after the session except stated cases. "
        "response_format json_schema verified; nvext.guided_json is NIM-only in practice."
    ),
}


def _profile(settings: Settings, name: AIProviderName) -> ProviderProfile:
    if name == "groq":
        return ProviderProfile(
            name="groq",
            base_url=settings.groq_base_url,
            model=settings.groq_model,
            api_key=settings.groq_api_key,
            max_output_tokens=settings.ai_max_output_tokens,
            notes=_NOTES["groq"],
        )
    return ProviderProfile(
        name="nvidia",
        base_url=settings.nvidia_base_url,
        model=settings.nvidia_model,
        api_key=settings.nvidia_api_key,
        max_output_tokens=settings.ai_max_output_tokens,
        notes=_NOTES["nvidia"],
    )


def build_provider_chain(settings: Settings) -> list[ProviderProfile]:
    """Primary then secondary, skipping any provider without a key.

    If the primary has no key but the secondary does, the secondary is used
    alone: a configured provider should not sit idle because of key order.
    """
    order: list[AIProviderName] = []
    for name in (settings.ai_primary_provider, settings.ai_secondary_provider):
        if name not in order:
            order.append(name)
    chain = [_profile(settings, name) for name in order]
    return [profile for profile in chain if profile.configured]


def missing_provider_keys(settings: Settings) -> tuple[str, ...]:
    """Names only, for the ``ai_not_configured`` message."""
    return tuple(
        name
        for name, key in (
            ("GROQ_API_KEY", settings.groq_api_key),
            ("NVIDIA_API_KEY", settings.nvidia_api_key),
        )
        if not key
    )
