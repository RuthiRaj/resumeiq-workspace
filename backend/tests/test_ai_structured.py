"""Structured output: schema request, validation, one repair, clean failure."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from app.ai.errors import AIGroundingError, AIProviderError, AISchemaError
from app.ai.gateway import AICallResult, AIGateway
from app.ai.schemas import (
    BulletRewriteResult,
    JobRequirementsResult,
    RewriteBulletInput,
)
from app.ai.tasks import strict_json_schema
from tests.ai_fakes import (
    CONSENT,
    EVIDENCE,
    GROQ,
    completion,
    handler_sequence,
    json_response,
    make_gateway,
)

PAYLOAD = RewriteBulletInput(bullet="Built a Python service handling 12,000 requests per day.")
GOOD = json.dumps(
    {
        "claims": [
            {
                "text": "Built a Python service handling 12,000 requests per day.",
                "evidence_ids": ["ev1"],
            }
        ]
    }
)
BAD_SHAPE = json.dumps({"claims": [{"text": "Built a Python service.", "evidence_ids": []}]})


def run(gateway: AIGateway, payload: Any = PAYLOAD) -> AICallResult:
    return asyncio.run(gateway.run("rewrite_bullet", payload, EVIDENCE, consent=CONSENT))


def test_invalid_json_gets_exactly_one_repair_then_succeeds() -> None:
    handler, seen = handler_sequence([completion("not json at all"), completion(GOOD)])
    gateway, _ = make_gateway([GROQ], handler=handler)

    result = run(gateway)

    assert result.repaired is True
    assert result.attempts == 2
    assert len(seen) == 2
    repair = json.loads(seen[1].content)
    assert repair["messages"][-1]["role"] == "user"
    assert "was not valid JSON" in repair["messages"][-1]["content"]
    assert any(message["role"] == "assistant" for message in repair["messages"])


def test_groq_json_validate_failed_400_is_repaired_not_a_hard_error() -> None:
    # Documented Groq best-effort behaviour: the model answered but the output did
    # not satisfy the schema, so the API returns 400 with failed_generation. That
    # is a repairable output, not a request/auth error.
    invalid = {
        "error": {
            "message": "Generated JSON does not match the expected schema.",
            "type": "invalid_request_error",
            "code": "json_validate_failed",
            "failed_generation": '{"claims": [{"text":',
        }
    }
    handler, seen = handler_sequence([json_response(invalid, status=400), completion(GOOD)])
    gateway, _ = make_gateway([GROQ], handler=handler, max_retries=0)

    result = run(gateway)

    assert result.repaired is True
    assert len(seen) == 2
    repair_messages = json.loads(seen[1].content)["messages"]
    assert repair_messages[-2]["role"] == "assistant"
    assert repair_messages[-2]["content"] == '{"claims": [{"text":'


def test_other_400s_stay_hard_errors() -> None:
    handler, seen = handler_sequence(
        [json_response({"error": {"code": "invalid_request_error"}}, status=400)]
    )
    gateway, _ = make_gateway([GROQ], handler=handler, max_retries=0)

    with pytest.raises(AIProviderError) as excinfo:
        run(gateway)

    assert excinfo.value.status_code == 400
    assert excinfo.value.retryable is False
    assert len(seen) == 1


def test_schema_mismatch_gets_one_repair_then_succeeds() -> None:
    handler, seen = handler_sequence([completion(BAD_SHAPE), completion(GOOD)])
    gateway, _ = make_gateway([GROQ], handler=handler)

    result = run(gateway)

    assert result.repaired is True
    assert len(seen) == 2
    repair_prompt = json.loads(seen[1].content)["messages"][-1]["content"]
    assert "did not match the schema" in repair_prompt
    assert "claims.0.evidence_ids" in repair_prompt


def test_two_invalid_responses_fail_cleanly_with_typed_error() -> None:
    handler, seen = handler_sequence([completion("{}"), completion("{}")])
    gateway, _ = make_gateway([GROQ], handler=handler)

    with pytest.raises(AISchemaError) as excinfo:
        run(gateway)
    assert excinfo.value.code == "ai_invalid_output"
    assert excinfo.value.provider == "groq"
    assert excinfo.value.task == "rewrite_bullet"
    assert len(seen) == 2  # no third call


def test_repair_is_attempted_only_once_even_with_spare_retries() -> None:
    handler, seen = handler_sequence([completion("{}"), completion("{}")])
    gateway, _ = make_gateway([GROQ], handler=handler, max_retries=5)

    with pytest.raises(AISchemaError):
        run(gateway)
    assert len(seen) == 2


def test_code_fenced_json_is_accepted() -> None:
    fenced = "```json\n" + GOOD + "\n```"
    handler, _ = handler_sequence([completion(fenced)])
    gateway, _ = make_gateway([GROQ], handler=handler)

    result = run(gateway)

    assert result.repaired is False


def test_prose_around_json_is_tolerated() -> None:
    handler, _ = handler_sequence([completion("Here you go: " + GOOD + " Done.")])
    gateway, _ = make_gateway([GROQ], handler=handler)

    assert run(gateway).repaired is False


def test_extra_fields_are_rejected_and_repaired() -> None:
    with_extra = json.dumps(
        {
            "claims": [
                {"text": "Built a Python service.", "evidence_ids": ["ev1"], "confidence": 0.9}
            ]
        }
    )
    handler, seen = handler_sequence([completion(with_extra), completion(GOOD)])
    gateway, _ = make_gateway([GROQ], handler=handler)

    result = run(gateway)
    assert result.repaired is True
    assert len(seen) == 2


def test_grounding_failure_rejects_the_output_and_is_not_cached() -> None:
    invented = json.dumps(
        {
            "claims": [
                {
                    "text": "Built a Python service handling 40% more traffic.",
                    "evidence_ids": ["ev1"],
                }
            ]
        }
    )
    handler, seen = handler_sequence([completion(invented), completion(invented)])
    gateway, _ = make_gateway([GROQ], handler=handler)

    with pytest.raises(AIGroundingError) as excinfo:
        run(gateway)
    assert excinfo.value.violations[0].code == "invented_metric"
    assert len(seen) == 1  # rejected, not repaired by the model

    # The rejected result must not satisfy the next identical call from cache.
    with pytest.raises(AIGroundingError):
        run(gateway)
    assert len(seen) == 2


def test_report_policy_returns_violations_instead_of_raising() -> None:
    invented = json.dumps(
        {
            "claims": [
                {
                    "text": "Built a Python service handling 40% more traffic.",
                    "evidence_ids": ["ev1"],
                }
            ]
        }
    )
    handler, _ = handler_sequence([completion(invented)])
    gateway, _ = make_gateway([GROQ], handler=handler)

    result = asyncio.run(
        gateway.run("rewrite_bullet", PAYLOAD, EVIDENCE, consent=CONSENT, grounding="report")
    )
    assert result.grounding is not None
    assert not result.grounding.ok
    assert "invented_metric" in result.grounding.codes()


def test_schema_has_one_required_claim_for_a_rewrite() -> None:
    schema = strict_json_schema(BulletRewriteResult)
    claims = schema["properties"]["claims"]
    assert claims["minItems"] == 1
    assert claims["maxItems"] == 1


def test_requirement_schema_exposes_the_category_enum() -> None:
    schema = strict_json_schema(JobRequirementsResult)
    claim_ref = schema["properties"]["claims"]["items"]
    # Pydantic uses $defs for the nested claim model.
    definition = schema["$defs"][claim_ref["$ref"].split("/")[-1]]
    assert set(definition["properties"]["category"]["enum"]) == {
        "must_have",
        "nice_to_have",
        "responsibility",
        "keyword",
    }


def test_timeout_during_repair_falls_back_to_secondary() -> None:
    from tests.ai_fakes import NVIDIA

    handler, seen = handler_sequence(
        [completion("{}"), httpx.ReadTimeout("slow"), completion(GOOD)]
    )
    gateway, _ = make_gateway([GROQ, NVIDIA], handler=handler, max_retries=0)

    result = run(gateway)

    assert result.provider == "nvidia"
    assert result.repaired is False
    assert len(seen) == 3
