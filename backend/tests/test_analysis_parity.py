"""Golden parity: the B4 Python engine vs the F4 TypeScript reference engine.

``analysis_vectors.json`` was exported by running the frontend engine
(``frontend/src/lib/analysis``) over the three documented fixtures plus the edge
cases from ``analysis.test.ts``. This test runs the Python port on the same
inputs and asserts the reports are semantically identical -- same scores, same
factor breakdowns, same requirement classifications/gap types, same ATS output,
same skills/content/roadmap.

``None``/absent are treated as equivalent for optional fields: the TypeScript
wire object omits ``pattern`` for skill requirements while the Python model
carries ``None``. Every other value is compared exactly (JD-5).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.analysis.report import build_analysis_report
from app.schemas.analysis import JobTarget
from app.schemas.workspace import WorkspaceItemResponse

GOLDEN_PATH = Path(__file__).parent / "golden" / "analysis_vectors.json"


def _strip_none(value: Any) -> Any:
    """Drop ``None`` object members recursively; recurse into lists."""
    if isinstance(value, dict):
        return {key: _strip_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_strip_none(item) for item in value]
    return value


def _load_cases() -> list[dict[str, Any]]:
    payload = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    return list(payload["cases"])


CASES = _load_cases()


def _run(case: dict[str, Any]) -> dict[str, Any]:
    report = build_analysis_report(
        target=JobTarget.model_validate(case["target"]),
        items=[WorkspaceItemResponse.model_validate(item) for item in case["items"]],
        workspace_version=case["workspaceVersion"],
        workspace_updated_at=case["workspaceUpdatedAt"],
        generated_at=case["generatedAt"],
    )
    return report.model_dump(mode="json")


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_report_matches_typescript_reference(case: dict[str, Any]) -> None:
    actual = _strip_none(_run(case))
    expected = _strip_none(case["expected"])
    assert actual == expected


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_score_and_classifications_match(case: dict[str, Any]) -> None:
    """A focused assertion so a full-report diff failure points at the culprit."""
    actual = _run(case)
    expected = case["expected"]
    assert actual["score"] == expected["score"]
    assert actual["factors"] == expected["factors"]
    actual_requirements = [
        {
            "id": requirement["id"],
            "status": requirement["status"],
            "gapType": requirement.get("gapType"),
            "pattern": requirement.get("pattern"),
            "text": requirement["text"],
        }
        for requirement in actual["requirements"]
    ]
    expected_requirements = [
        {
            "id": requirement["id"],
            "status": requirement["status"],
            "gapType": requirement.get("gapType"),
            "pattern": requirement.get("pattern"),
            "text": requirement["text"],
        }
        for requirement in expected["requirements"]
    ]
    assert actual_requirements == expected_requirements
