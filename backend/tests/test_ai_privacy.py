"""Privacy boundary: reversible redaction, and nothing raw leaves the process."""

from __future__ import annotations

import asyncio
import json

import httpx

from app.ai.privacy import RedactionSession
from app.ai.schemas import RewriteBulletInput
from tests.ai_fakes import (
    CONSENT,
    EVIDENCE,
    GROQ,
    completion,
    handler_sequence,
    make_gateway,
)


def test_redacts_email_phone_url_and_address() -> None:
    session = RedactionSession()
    text = (
        "Contact alex.rivera@example.com or +1 (555) 010-0123, "
        "profile https://example.com/alex, 42 Example Street, Apt 4."
    )
    redacted = session.redact(text)
    assert "alex.rivera@example.com" not in redacted
    assert "555" not in redacted
    assert "https://example.com/alex" not in redacted
    assert "42 Example Street" not in redacted
    assert "[[EMAIL_1]]" in redacted
    assert "[[PHONE_1]]" in redacted
    assert "[[URL_1]]" in redacted
    assert "[[ADDRESS_1]]" in redacted
    assert session.restore(redacted) == text


def test_same_value_reuses_placeholder_and_restores_each_occurrence() -> None:
    session = RedactionSession()
    redacted = session.redact("a@b.co wrote to a@b.co")
    assert redacted.count("[[EMAIL_1]]") == 2
    assert session.restore(redacted) == "a@b.co wrote to a@b.co"
    assert session.replacements == 1


def test_known_profile_fields_are_redacted_longest_first() -> None:
    session = RedactionSession(
        profile_fields={
            "full_name": "Alex Rivera",
            "location": "Springfield",
            "linkedin": "linkedin.com/in/alex",
        }
    )
    redacted = session.redact("Alex Rivera lives in Springfield: linkedin.com/in/alex")
    assert "Alex Rivera" not in redacted
    assert "Springfield" not in redacted
    assert "linkedin.com/in/alex" not in redacted
    assert session.restore(redacted) == "Alex Rivera lives in Springfield: linkedin.com/in/alex"


def test_dates_are_not_mistaken_for_phone_numbers() -> None:
    session = RedactionSession()
    text = "Worked 2020-2023 on a team of 4."
    assert session.redact(text) == text


def test_bare_numbers_and_years_are_left_alone() -> None:
    session = RedactionSession()
    text = "Processed 12000 records in 2023."
    assert session.redact(text) == text


def test_gateway_sends_no_raw_pii_and_restores_before_returning() -> None:
    payload = RewriteBulletInput(
        bullet=(
            "Emailed alex.rivera@example.com and called +1 555 010 0123 about the "
            "Python service handling 12,000 requests per day."
        ),
        target_role="Backend Engineer",
    )
    answer = json.dumps(
        {
            "claims": [
                {
                    "text": (
                        "Contact [[EMAIL_1]] about the Python service "
                        "handling 12,000 requests per day."
                    ),
                    "evidence_ids": ["ev1"],
                }
            ]
        }
    )
    handler, seen = handler_sequence([completion(answer)])
    gateway, _ = make_gateway([GROQ], handler=handler)

    result = asyncio.run(gateway.run("rewrite_bullet", payload, EVIDENCE, consent=CONSENT))

    assert len(seen) == 1
    body = seen[0].content.decode("utf-8")
    assert "alex.rivera@example.com" not in body
    assert "555 010 0123" not in body
    assert "[[EMAIL_1]]" in body
    # The restored value is what the app gets back, not the placeholder.
    assert "alex.rivera@example.com" in result.value.claims[0].text
    assert "[[EMAIL_1]]" not in result.value.claims[0].text


def test_gateway_can_redact_an_explicit_profile() -> None:
    payload = RewriteBulletInput(bullet="Alex Rivera built the Python service.")
    answer = json.dumps(
        {"claims": [{"text": "[[FIELD_1]] built the Python service.", "evidence_ids": ["ev1"]}]}
    )
    handler, seen = handler_sequence([completion(answer)])
    gateway, _ = make_gateway([GROQ], handler=handler)

    result = asyncio.run(
        gateway.run(
            "rewrite_bullet",
            payload,
            EVIDENCE,
            consent=CONSENT,
            profile={"full_name": "Alex Rivera"},
        )
    )

    assert b"Alex Rivera" not in seen[0].content
    assert result.value.claims[0].text == "Alex Rivera built the Python service."


def test_mock_transport_is_used_so_no_real_network_call_happens() -> None:
    called: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        called.append(request.url.host)
        return completion(
            json.dumps({"claims": [{"text": "Built a Python service.", "evidence_ids": ["ev1"]}]})
        )

    gateway, _ = make_gateway([GROQ], handler=handler)
    asyncio.run(
        gateway.run(
            "rewrite_bullet",
            RewriteBulletInput(bullet="Built a Python service."),
            EVIDENCE,
            consent=CONSENT,
        )
    )
    assert called == ["groq.test"]
