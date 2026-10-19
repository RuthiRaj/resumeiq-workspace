"""Per-user daily quota, behind an interface (B3).

The in-memory implementation is correct for one process and is what B3 ships;
the protocol is the seam for a database-backed store (``ai_usage`` table) in a
later milestone. Quota is consumed only on a cache miss, so repeated identical
requests stay free.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol, runtime_checkable

from app.ai.errors import AIQuotaExceededError


@dataclass(frozen=True)
class QuotaState:
    limit: int
    used: int
    resets_at: datetime

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


@runtime_checkable
class QuotaStore(Protocol):
    """Consume one call for ``user_id`` or raise :class:`AIQuotaExceededError`."""

    def consume(self, user_id: str) -> QuotaState: ...

    def peek(self, user_id: str) -> QuotaState: ...


def _utc_day(now: datetime) -> tuple[str, datetime]:
    start = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return start.date().isoformat(), start + timedelta(days=1)


class InMemoryDailyQuota:
    """Fixed-window (UTC day) counter per user. Single-process only."""

    def __init__(self, limit: int, *, clock: Callable[[], datetime] | None = None) -> None:
        self._limit = max(0, limit)
        self._clock = clock or (lambda: datetime.now(UTC))
        self._used: dict[tuple[str, str], int] = defaultdict(int)

    def _state(self, user_id: str) -> QuotaState:
        today, resets_at = _utc_day(self._clock())
        return QuotaState(
            limit=self._limit,
            used=self._used[(user_id, today)],
            resets_at=resets_at,
        )

    def peek(self, user_id: str) -> QuotaState:
        return self._state(user_id)

    def consume(self, user_id: str) -> QuotaState:
        state = self._state(user_id)
        if state.used >= state.limit:
            raise AIQuotaExceededError(
                limit=state.limit,
                used=state.used,
                resets_at=state.resets_at.isoformat(),
            )
        today, _ = _utc_day(self._clock())
        self._used[(user_id, today)] += 1
        return self._state(user_id)
