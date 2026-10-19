"""Deterministic analysis engine (B4, PRD §6.4–6.7).

This package is a faithful Python port of the F4 reference engine in
``frontend/src/lib/analysis/`` (ADR-021). B4 serves exactly the shapes that
engine produces, and ``backend/tests/test_analysis_parity.py`` diffs the port
against golden vectors exported from the TypeScript engine, so the two can
never drift.

Pipeline::

    taxonomy -> extract_requirements -> match_requirements -> compute_factors
             -> compute_ats_report -> assemble_report

Nothing here calls a language model: the score, the classifications and the
ATS checks are deterministic and identical for identical inputs (JD-5). AI is
strictly an optional enrichment layered on top (see ``enrichment.py``) and can
never change the deterministic baseline.
"""

from app.analysis.matching import (
    EvidenceIndex,
    build_evidence_index,
    match_requirements,
)
from app.analysis.report import assemble_report, build_analysis_report
from app.analysis.requirements import RequirementDraft, extract_requirements

__all__ = [
    "EvidenceIndex",
    "RequirementDraft",
    "assemble_report",
    "build_analysis_report",
    "build_evidence_index",
    "extract_requirements",
    "match_requirements",
]
