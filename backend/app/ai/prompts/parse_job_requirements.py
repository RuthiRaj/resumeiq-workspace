"""Parse job requirements (B4 will consume this)."""

from __future__ import annotations

from collections.abc import Sequence

from app.ai.prompts.base import NO_NEW_FACTS, evidence_block
from app.ai.schemas import EvidenceItem, ParseJobRequirementsInput

SYSTEM_PROMPT = (
    "You extract requirements from a job description. Classify each requirement as "
    "must_have, nice_to_have, responsibility or keyword. Keep the employer's own "
    "wording where possible; do not soften or upgrade it. " + NO_NEW_FACTS
)


def build_user_prompt(payload: ParseJobRequirementsInput, evidence: Sequence[EvidenceItem]) -> str:
    return (
        f"JOB DESCRIPTION:\n{payload.job_description}\n\n"
        f"{evidence_block(evidence)}\n\n"
        "Return every requirement as a claim. Cite the job-description evidence id. "
        "Do not infer requirements that the description does not state."
    )
