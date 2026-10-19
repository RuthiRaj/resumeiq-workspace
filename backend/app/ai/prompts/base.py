"""Prompt building blocks shared by the B3 tasks.

Rules that every prompt repeats (PRD RG-2..RG-4):

* use only the supplied evidence, cite its ids on every claim;
* never add employers, titles, dates, numbers, technologies or certificates;
* copy placeholders such as ``[[EMAIL_1]]`` verbatim;
* return JSON only.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.ai.schemas import EvidenceItem

NO_NEW_FACTS = (
    "You may reword, reorder, classify and compress. You may NOT add facts: no new "
    "employers, job titles, dates, numbers, metrics, technologies, certificates or "
    "degrees. Every claim must cite the evidence ids it comes from. If the evidence "
    "does not support a statement, omit it. Copy placeholder tokens such as "
    "[[EMAIL_1]] exactly as written. Return JSON only, matching the supplied schema."
)


def render_evidence(evidence: Sequence[EvidenceItem]) -> str:
    """One line per evidence item, id first so the model can cite it."""
    lines: list[str] = []
    for item in evidence:
        lines.append(f"[{item.id}] ({item.kind}) {item.text}")
    return "\n".join(lines)


def evidence_block(evidence: Sequence[EvidenceItem]) -> str:
    return "SUPPLIED EVIDENCE (the only permitted source):\n" + render_evidence(evidence)
