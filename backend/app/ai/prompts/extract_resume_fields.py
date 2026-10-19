"""Refine the deterministic parser's fields; never read the original file."""

from __future__ import annotations

from collections.abc import Sequence

from app.ai.prompts.base import NO_NEW_FACTS, evidence_block
from app.ai.schemas import EvidenceItem, ExtractResumeFieldsInput

SYSTEM_PROMPT = (
    "You refine resume fields that a deterministic parser already extracted. Use only "
    "the parser text and evidence supplied. Correct casing and obvious spacing, and "
    "choose the most complete value the text supports. Never invent a value that is "
    "absent, and never merge two people's details. " + NO_NEW_FACTS
)


def build_user_prompt(payload: ExtractResumeFieldsInput, evidence: Sequence[EvidenceItem]) -> str:
    return (
        f"DETERMINISTIC PARSER OUTPUT:\n{payload.parser_text}\n\n"
        f"{evidence_block(evidence)}\n\n"
        "Return one claim per field you can support (full_name, headline, location, "
        "email, phone, website, linkedin, github). Use the value as the claim text and "
        "cite the parser evidence id."
    )
