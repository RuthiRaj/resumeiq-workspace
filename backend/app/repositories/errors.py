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


class ResumeNotFoundError(RepositoryError):
    """The requested resume does not exist (or is not the caller's)."""

    def __init__(self, resume_id: str) -> None:
        super().__init__("That resume no longer exists.")
        self.resume_id = resume_id


class ResumeVersionNotFoundError(RepositoryError):
    """The requested resume version does not exist for that resume."""

    def __init__(self, version_id: str) -> None:
        super().__init__("That resume version no longer exists.")
        self.version_id = version_id


class ResumeSectionNotFoundError(RepositoryError):
    """The resume has no such section to edit."""

    def __init__(self, section: str) -> None:
        super().__init__("That resume section does not exist.")
        self.section = section


class ResumeSectionInvalidError(RepositoryError):
    """A refresh named a section that is not part of the resume contract."""

    def __init__(self, section: str) -> None:
        super().__init__("That is not a resume section.")
        self.section = section


class ResumeReadOnlyError(RepositoryError):
    """The standard resume is derived live and cannot be edited or versioned."""

    def __init__(self) -> None:
        super().__init__("The standard resume is always derived from the workspace.")


class ResumeEvidenceNotFoundError(RepositoryError):
    """An edit cited an item that is not in the caller's current workspace."""

    def __init__(self, item_id: str) -> None:
        super().__init__("That evidence item is not in your current workspace.")
        self.item_id = item_id


class ResumeClaimUngroundedError(RepositoryError):
    """A hand-edited or AI-rewritten claim adds facts the evidence lacks."""

    def __init__(self, section: str) -> None:
        super().__init__("A statement in that section is not supported by its evidence.")
        self.section = section


class AnalysisRequiredError(RepositoryError):
    """A tailored resume needs a successful analysis report first."""

    def __init__(self, target_id: str) -> None:
        super().__init__("Run the analysis before generating a tailored resume.")
        self.target_id = target_id


class AnalysisStaleError(RepositoryError):
    """The analysis predates the current workspace, so selection would be stale."""

    def __init__(self, target_id: str) -> None:
        super().__init__("The analysis is older than your workspace. Re-run it first.")
        self.target_id = target_id


class AccountConfirmationError(RepositoryError):
    """The account-deletion body did not carry the explicit confirmation phrase."""


class DataExportUnavailableError(RepositoryError):
    """The complete-data export could not be read from the store."""


class AccountDeletionUnavailableError(RepositoryError):
    """The destructive account RPC is missing or the store is unavailable."""


class DataApiNotConfiguredError(RepositoryError):
    """The Supabase Data API (URL + publishable key) is not configured."""
