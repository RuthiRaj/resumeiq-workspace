"""Task registry: name -> Pydantic input/result models + prompt module."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from app.ai.prompts import (
    explain_gap,
    extract_resume_fields,
    parse_job_requirements,
    rewrite_bullet,
)
from app.ai.schemas import (
    BulletRewriteResult,
    EvidenceItem,
    ExplainGapInput,
    ExtractResumeFieldsInput,
    GapExplanationResult,
    GroundedResult,
    JobRequirementsResult,
    ParseJobRequirementsInput,
    ResumeFieldsResult,
    RewriteBulletInput,
)


@dataclass(frozen=True)
class TaskSpec:
    """Everything the gateway needs to run one typed task."""

    name: str
    input_model: type[BaseModel]
    result_model: type[GroundedResult[Any]]
    system_prompt: str
    build_user_prompt: Callable[[Any, Sequence[EvidenceItem]], str]


TASKS: dict[str, TaskSpec] = {
    "parse_job_requirements": TaskSpec(
        name="parse_job_requirements",
        input_model=ParseJobRequirementsInput,
        result_model=JobRequirementsResult,
        system_prompt=parse_job_requirements.SYSTEM_PROMPT,
        build_user_prompt=parse_job_requirements.build_user_prompt,
    ),
    "rewrite_bullet": TaskSpec(
        name="rewrite_bullet",
        input_model=RewriteBulletInput,
        result_model=BulletRewriteResult,
        system_prompt=rewrite_bullet.SYSTEM_PROMPT,
        build_user_prompt=rewrite_bullet.build_user_prompt,
    ),
    "explain_gap": TaskSpec(
        name="explain_gap",
        input_model=ExplainGapInput,
        result_model=GapExplanationResult,
        system_prompt=explain_gap.SYSTEM_PROMPT,
        build_user_prompt=explain_gap.build_user_prompt,
    ),
    "extract_resume_fields": TaskSpec(
        name="extract_resume_fields",
        input_model=ExtractResumeFieldsInput,
        result_model=ResumeFieldsResult,
        system_prompt=extract_resume_fields.SYSTEM_PROMPT,
        build_user_prompt=extract_resume_fields.build_user_prompt,
    ),
}


def get_task(name: str) -> TaskSpec:
    try:
        return TASKS[name]
    except KeyError:
        raise ValueError(f"Unknown AI task: {name}") from None


def _close_objects(node: Any) -> None:
    """Groq strict mode requires ``additionalProperties: false`` on every object."""
    if isinstance(node, dict):
        if node.get("type") == "object" or "properties" in node:
            node.setdefault("additionalProperties", False)
        for value in node.values():
            _close_objects(value)
    elif isinstance(node, list):
        for value in node:
            _close_objects(value)


def strict_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """The model's JSON schema, closed for strict structured output."""
    schema: dict[str, Any] = model.model_json_schema()
    _close_objects(schema)
    return schema
