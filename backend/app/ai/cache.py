"""In-memory response cache keyed by a hash of the request (B3).

The key covers the task, the redacted messages, the JSON schema and the user id.
Including the user id is deliberate: results are restored to their original PII
before they are cached, so sharing a cache entry between two users could leak
one person's data to another (ADR-030). A hit never reaches a provider and never
consumes quota.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import OrderedDict
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class ResponseCache(Protocol):
    """Interface so a Redis/Postgres-backed cache can replace this one later."""

    def get(self, key: str) -> Any | None: ...

    def set(self, key: str, value: Any) -> None: ...


def request_cache_key(
    *,
    task: str,
    messages: Sequence[Mapping[str, str]],
    schema: Mapping[str, Any],
    user_id: str,
) -> str:
    """Stable SHA-256 over everything that determines a response."""
    canonical = json.dumps(
        {"task": task, "messages": messages, "schema": schema, "user_id": user_id},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class InMemoryResponseCache:
    """TTL + LRU cache. Single-process only; bounded by ``max_entries``."""

    def __init__(
        self,
        *,
        ttl_seconds: int,
        max_entries: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl = ttl_seconds
        self._max_entries = max(1, max_entries)
        self._clock = clock
        self._entries: OrderedDict[str, tuple[float, Any]] = OrderedDict()

    def get(self, key: str) -> Any | None:
        if self._ttl <= 0:
            return None
        entry = self._entries.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at <= self._clock():
            self._entries.pop(key, None)
            return None
        self._entries.move_to_end(key)
        return value

    def set(self, key: str, value: Any) -> None:
        if self._ttl <= 0:
            return
        self._entries[key] = (self._clock() + self._ttl, value)
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)

    def clear(self) -> None:
        self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)
