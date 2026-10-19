"""Evidence quality and the supporting-evidence rule (port of ``weights.ts``).

Relative evidence quality per state (0-1). Single source of truth: the
workspace completeness ring (F3) and the F4 match scoring both read it, so the
two can never drift apart. See docs/DECISIONS.md (ADR-021).
"""

from __future__ import annotations

from app.schemas.workspace import EvidenceState

EVIDENCE_QUALITY: dict[EvidenceState, float] = {
    "verified": 1.0,
    "attested": 0.6,
    "related": 0.3,
    "missing": 0.0,
}


def is_supporting_evidence(state: EvidenceState) -> bool:
    """A workspace item can only support a claim when its evidence is real."""
    return state == "verified" or state == "attested"


def mean_evidence_quality(states: list[EvidenceState]) -> float:
    """Mean evidence quality of a set of items (0 when empty)."""
    if not states:
        return 0.0
    return sum(EVIDENCE_QUALITY[state] for state in states) / len(states)
