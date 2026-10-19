"""Explain a requirement gap without inventing coverage."""

from __future__ import annotations

from collections.abc import Sequence

from app.ai.prompts.base import NO_NEW_FACTS, evidence_block
from app.ai.schemas import EvidenceItem, ExplainGapInput

SYSTEM_PROMPT = (
    "You explain why a job requirement is not evidenced by the candidate's supplied "
    "evidence. State the gap plainly and name the closest genuinely related evidence, "
    "if any. Never imply the candidate has a skill, title or experience the evidence "
    "does not show, and never promise that learning something will lead to a job. " + NO_NEW_FACTS
)


def build_user_prompt(payload: ExplainGapInput, evidence: Sequence[EvidenceItem]) -> str:
    return (
        f"REQUIREMENT:\n{payload.requirement}\n"
        f"GAP KIND: {payload.gap_kind}\n\n"
        f"{evidence_block(evidence)}\n\n"
        "Return at most five claims explaining the gap. If nothing related exists, say "
        "so using only what the evidence shows."
    )
