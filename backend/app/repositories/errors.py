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


class DataApiNotConfiguredError(RepositoryError):
    """The Supabase Data API (URL + publishable key) is not configured."""
