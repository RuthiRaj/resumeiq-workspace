"""Extraction-layer errors (transport-free: no FastAPI, no HTTP).

The API layer maps these onto the import error envelope
(``docs/api/contract-proposals.md`` §2.1). None of them carries document
content, so raising one can never leak the file or its text into a log.
"""


class ExtractionError(Exception):
    """Base class for every extraction failure."""


class UnsupportedFileTypeError(ExtractionError):
    """The bytes are not the document type the file name claims."""


class DocumentRejectedError(ExtractionError):
    """The document is structurally unsafe or unusable: empty, damaged, a zip
    bomb, or over the page/entry caps."""


class ExtractionTimeoutError(ExtractionError):
    """Parsing exceeded its deadline, so the worker is given back (PRD §11)."""


class ExtractionUnavailableError(ExtractionError):
    """The extractor itself failed (an unexpected error in the parsing pipeline)."""
