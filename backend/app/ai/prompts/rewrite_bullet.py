"""Rewrite one resume bullet, grounded in the supplied evidence."""

from __future__ import annotations

from collections.abc import Sequence

from app.ai.prompts.base import NO_NEW_FACTS, evidence_block
from app.ai.schemas import EvidenceItem, RewriteBulletInput

SYSTEM_PROMPT = (
    "You rewrite a single resume bullet for clarity and concision. Keep the same "
    "meaning, tense and scope. Preserve every number exactly as written; do not "
    "round, aggregate or invent one. " + NO_NEW_FACTS
)


def build_user_prompt(payload: RewriteBulletInput, evidence: Sequence[EvidenceItem]) -> str:
    role = (
        f"\nTARGET ROLE (context only, not evidence): {payload.target_role}"
        if payload.target_role
        else ""
    )
    return (
        f"BULLET TO REWRITE:\n{payload.bullet}{role}\n\n"
        f"{evidence_block(evidence)}\n\n"
        "Return exactly one claim: the rewritten bullet, citing the evidence it came from."
    )
