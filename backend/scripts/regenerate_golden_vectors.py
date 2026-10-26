#!/usr/bin/env python3
"""Regenerate golden analysis vectors from the Python engine (should match TypeScript)."""

import json
import sys
from pathlib import Path

# Add backend to path
BACKEND_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

# ruff: noqa: E402
from app.analysis.report import build_analysis_report
from app.schemas.analysis import JobTarget
from app.schemas.workspace import WorkspaceItemResponse

GOLDEN_PATH = BACKEND_ROOT / "tests" / "golden" / "analysis_vectors.json"


def _strip_none(value: any) -> any:
    """Drop ``None`` object members recursively; recurse into lists."""
    if isinstance(value, dict):
        return {key: _strip_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_strip_none(item) for item in value]
    return value


def main():
    with open(GOLDEN_PATH, encoding="utf-8") as f:
        data = json.load(f)

    cases = data["cases"]
    new_cases = []

    for case in cases:
        print(f"Processing {case['id']}...")
        report = build_analysis_report(
            target=JobTarget.model_validate(case["target"]),
            items=[WorkspaceItemResponse.model_validate(item) for item in case["items"]],
            workspace_version=case["workspaceVersion"],
            workspace_updated_at=case["workspaceUpdatedAt"],
            generated_at=case["generatedAt"],
        )
        new_case = {
            "id": case["id"],
            "target": case["target"],
            "items": case["items"],
            "workspaceVersion": case["workspaceVersion"],
            "workspaceUpdatedAt": case["workspaceUpdatedAt"],
            "generatedAt": case["generatedAt"],
            "expected": _strip_none(report.model_dump(mode="json")),
        }
        new_cases.append(new_case)

    new_data = {
        "version": data["version"],
        "source": data["source"],
        "generatedFor": data["generatedFor"],
        "cases": new_cases,
    }

    with open(GOLDEN_PATH, "w", encoding="utf-8") as f:
        json.dump(new_data, f, indent=2, ensure_ascii=False)

    print(f"Regenerated {len(new_cases)} cases to {GOLDEN_PATH}")


if __name__ == "__main__":
    main()
