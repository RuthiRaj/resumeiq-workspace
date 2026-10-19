"""Task registry, prompt grounding rules, and the API error mapping for AI errors."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.ai.errors import (
    AIConsentRequiredError,
    AIGroundingError,
    AINotConfiguredError,
    AIProviderAuthError,
    AIQuotaExceededError,
    AISchemaError,
    AIUnavailableError,
    ClaimViolation,
)
from app.ai.prompts import (
    explain_gap,
    extract_resume_fields,
    parse_job_requirements,
    rewrite_bullet,
)
from app.ai.schemas import (
    EvidenceItem,
    ExplainGapInput,
    ExtractResumeFieldsInput,
    ParseJobRequirementsInput,
    RewriteBulletInput,
)
from app.ai.tasks import TASKS, get_task, strict_json_schema
from app.core.config import Settings
from app.main import create_app

EVIDENCE = [
    EvidenceItem(id="ev1", kind="job_description", text="Must have 5 years of Python."),
    EvidenceItem(id="ev2", kind="workspace_item", text="Wrote Python services."),
]


def test_all_four_tasks_are_registered() -> None:
    assert set(TASKS) == {
        "parse_job_requirements",
        "rewrite_bullet",
        "explain_gap",
        "extract_resume_fields",
    }


def test_unknown_task_raises_a_clear_error() -> None:
    with pytest.raises(ValueError, match="Unknown AI task"):
        get_task("not_a_task")


def test_every_system_prompt_forbids_new_facts() -> None:
    for module in (
        parse_job_requirements,
        rewrite_bullet,
        explain_gap,
        extract_resume_fields,
    ):
        assert "may NOT add facts" in module.SYSTEM_PROMPT
        assert "Return JSON only" in module.SYSTEM_PROMPT


def test_user_prompts_carry_the_evidence_ids() -> None:
    prompts = [
        parse_job_requirements.build_user_prompt(
            ParseJobRequirementsInput(job_description="Must have Python."), EVIDENCE
        ),
        rewrite_bullet.build_user_prompt(RewriteBulletInput(bullet="Wrote Python."), EVIDENCE),
        explain_gap.build_user_prompt(ExplainGapInput(requirement="Kubernetes"), EVIDENCE),
        extract_resume_fields.build_user_prompt(
            ExtractResumeFieldsInput(parser_text="Alex Rivera"), EVIDENCE
        ),
    ]
    for prompt in prompts:
        assert "[ev1]" in prompt
        assert "[ev2]" in prompt
        assert "SUPPLIED EVIDENCE" in prompt


def test_strict_schema_marks_every_object_closed() -> None:
    schema = strict_json_schema(TASKS["parse_job_requirements"].result_model)
    assert schema["additionalProperties"] is False
    for definition in schema.get("$defs", {}).values():
        assert definition.get("additionalProperties") is False


def _app_raising(error: Exception, settings: Settings) -> TestClient:
    app = create_app(settings)

    @app.get("/raises-ai-error")
    def raises() -> None:
        raise error

    return TestClient(app)


@pytest.mark.parametrize(
    ("error", "expected_status", "expected_code"),
    [
        (AINotConfiguredError(("GROQ_API_KEY",)), 503, "ai_not_configured"),
        (AIConsentRequiredError(), 403, "ai_consent_required"),
        (
            AIQuotaExceededError(limit=1, used=1, resets_at="2026-10-20T00:00:00+00:00"),
            429,
            "ai_quota_exceeded",
        ),
        (
            AISchemaError("rewrite_bullet", provider="groq", reason="invalid"),
            502,
            "ai_invalid_output",
        ),
        (
            AIGroundingError("rewrite_bullet", (ClaimViolation(0, "invented_metric", "40%"),)),
            502,
            "ai_ungrounded",
        ),
        (AIUnavailableError(()), 503, "ai_unavailable"),
        (AIProviderAuthError("groq", 401), 502, "ai_provider_auth_failed"),
    ],
)
def test_ai_errors_map_to_stable_json_codes(
    settings: Settings, error: Exception, expected_status: int, expected_code: str
) -> None:
    client = _app_raising(error, settings)
    response = client.get("/raises-ai-error")
    assert response.status_code == expected_status
    detail = response.json()["detail"]
    assert detail["code"] == expected_code
    assert isinstance(detail["message"], str) and detail["message"]


def test_ai_error_messages_never_contain_a_key_value(settings: Settings) -> None:
    client = _app_raising(AINotConfiguredError(("GROQ_API_KEY",)), settings)
    body = client.get("/raises-ai-error").text
    assert "ai_not_configured" in body
    # A provider key value can never appear: the handler returns a fixed message.
    assert "test-key-not-real" not in body
    assert "sk-" not in body
