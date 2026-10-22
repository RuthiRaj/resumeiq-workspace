"""Data export and account-data deletion (B6, PRD §6.9 EX-2).

The service owns the two wire promises the repository cannot express:

* an export is complete by construction -- every key in ``UserDataExport`` is
  filled from exactly one user-scoped table query, and there is no key that
  could carry an auth token or another user's row;
* deletion requires an explicit confirmation phrase before the destructive call,
  and the response states honestly that the auth identity is a remaining step
  (the backend holds no service-role key; see ADR-043).

Nothing here logs row contents, the confirmation phrase or any token.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

from app.core.logging import get_logger
from app.repositories.data_export import DataExportRepository
from app.repositories.errors import AccountConfirmationError
from app.schemas.privacy import AccountDeletionResult, UserDataExport

logger = get_logger(__name__)

#: The only accepted confirmation value (case-insensitive, trimmed).
CONFIRMATION_PHRASE = "delete my account"

#: Shown without claiming the auth user was removed.
ACCOUNT_DELETION_MESSAGE = (
    "Your ResumeIQ data was deleted. The sign-in identity still exists and must be "
    "removed by the service operator."
)


def _iso_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class PrivacyService:
    """Export and deletion over one caller-scoped repository."""

    def __init__(
        self,
        repository: DataExportRepository,
        *,
        clock: Callable[[], str] | None = None,
    ) -> None:
        self._repository = repository
        self._clock = clock or _iso_now

    async def export_user(self, user_id: str, email: str | None = None) -> UserDataExport:
        snapshot = await self._repository.export_user(user_id)
        exported = UserDataExport(
            exportedAt=self._clock(),
            userId=user_id,
            email=email,
            profile=snapshot.profile,
            **{field: rows for field, rows in snapshot.tables.items()},
        )
        logger.info(
            "data_exported",
            extra={
                "tables": len(snapshot.tables),
                "rows": sum(len(rows) for rows in snapshot.tables.values())
                + (1 if snapshot.profile else 0),
            },
        )
        return exported

    async def delete_account(self, user_id: str, confirmation: str) -> AccountDeletionResult:
        if confirmation.strip().lower() != CONFIRMATION_PHRASE:
            logger.info("account_deletion_confirmation_rejected")
            raise AccountConfirmationError()
        counts = await self._repository.delete_user_data(user_id)
        logger.info(
            "account_data_deleted",
            extra={
                "tables": len(counts),
                "rows": sum(counts.values()),
                # The auth identity is deliberately still present; never imply
                # a complete account deletion in a log or a response.
                "auth_user_deleted": False,
            },
        )
        return AccountDeletionResult(
            dataDeleted=True,
            authUserDeleted=False,
            remainingStep="auth_user",
            deletedAt=self._clock(),
            deletedCounts=counts,
            message=ACCOUNT_DELETION_MESSAGE,
        )
