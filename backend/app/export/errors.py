"""Typed PDF-export failures."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ExportCheck:
    """The result of extracting the generated PDF back into text.

    Counts only: claim text never travels in an exception, a header or a log.
    """

    sections_checked: int = 0
    sections_missing: int = 0
    claims_checked: int = 0
    claims_missing: int = 0

    @property
    def passed(self) -> bool:
        return self.sections_missing == 0 and self.claims_missing == 0

    def headers(self) -> dict[str, str]:
        return {
            "X-Export-Text-Check": "passed" if self.passed else "failed",
            "X-Export-Sections-Checked": str(self.sections_checked),
            "X-Export-Sections-Missing": str(self.sections_missing),
            "X-Export-Claims-Checked": str(self.claims_checked),
            "X-Export-Claims-Missing": str(self.claims_missing),
        }


class ExportVerificationError(Exception):
    """The generated PDF did not round-trip its own headings/claims."""

    def __init__(self, check: ExportCheck) -> None:
        super().__init__("The generated PDF failed the text-extraction check.")
        self.check = check
