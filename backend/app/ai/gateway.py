"""AI gateway placeholder (B0: intentionally empty).

Milestone B3 will implement the provider-agnostic AI gateway here
(OpenAI-compatible interface, task routing, fallback, caching, quota guards
per PRD section 10.3). Until then this module exposes nothing and the backend
makes NO external AI calls: no provider SDKs, no API keys, no network access.

Hard rules carried forward:
- Strip phone, email, address and links before any future model call.
- JSON-schema outputs with validation, repair and retry.
- Explicit user consent (see `consent_records`) before the first AI call.
- Never train on user data; re-verify provider terms at bake-off time.
"""

__all__: list[str] = []
