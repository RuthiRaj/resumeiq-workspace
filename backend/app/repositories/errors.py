"""Repository-layer errors.

Kept independent of FastAPI so services and repositories stay transport-free;
the API layer maps these onto HTTP responses.
"""


class RepositoryError(Exception):
    """Base class for repository failures."""


class ItemNotFoundError(RepositoryError):
    """The requested workspace item does not exist (or is not the caller's)."""

    def __init__(self, item_id: str) -> None:
        super().__init__("That workspace item no longer exists.")
        self.item_id = item_id


class ImportSessionNotFoundError(RepositoryError):
    """The requested import session does not exist (or is not the caller's)."""

    def __init__(self, import_id: str) -> None:
        super().__init__("That import no longer exists.")
        self.import_id = import_id


class ImportReviewItemNotFoundError(RepositoryError):
    """The requested review item is not part of that import."""

    def __init__(self, item_id: str) -> None:
        super().__init__("That extracted item no longer exists.")
        self.item_id = item_id


class InvalidReorderError(RepositoryError):
    """A reorder request referenced ids outside the target section."""


class TargetNotFoundError(RepositoryError):
    """The requested job target does not exist (or is not the caller's)."""

    def __init__(self, target_id: str) -> None:
        super().__init__("That job target no longer exists.")
        self.target_id = target_id


class AnalysisRunNotFoundError(RepositoryError):
    """No analysis run has been started for that target yet."""

    def __init__(self, target_id: str) -> None:
        super().__init__("No analysis has been started for that target.")
        self.target_id = target_id


class ReportNotReadyError(RepositoryError):
    """The target exists but no analysis report has been produced yet."""

    def __init__(self, target_id: str) -> None:
        super().__init__("The analysis report is not ready yet.")
        self.target_id = target_id


class AnalysisAlreadyRunningError(RepositoryError):
    """A run for that target is already in flight (contract: 409)."""

    def __init__(self, target_id: str) -> None:
        super().__init__("An analysis is already running for that target.")
        self.target_id = target_id


class DataApiNotConfiguredError(RepositoryError):
    """The Supabase Data API (URL + publishable key) is not configured."""
