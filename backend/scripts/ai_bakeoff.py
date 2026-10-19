"""AI bake-off harness (B3): measures providers on synthetic data.

Runs the four typed B3 tasks over the synthetic corpus in
``backend/tests/golden/synthetic_corpus.json`` (no real personal data) and
reports, per provider and model:

* **JSON validity** — the share of calls whose output satisfied the task's
  Pydantic schema, first pass and after the single repair attempt;
* **latency** — p50 and p95 of successful calls, in milliseconds;
* **grounding errors** — claims the deterministic validator rejected, counted
  with ``grounding="report"`` so a run still produces numbers instead of raising.

Live runs happen **only** when ``RUN_AI_LIVE=1`` and the provider key is present.
Otherwise the harness writes a "not run" report so the checked-in document always
states what was actually measured. Keys are never printed, logged or written.

    cd backend
    uv run python scripts/ai_bakeoff.py                 # writes docs/ai-bakeoff.md
    RUN_AI_LIVE=1 uv run python scripts/ai_bakeoff.py   # live, if keys exist
    uv run python scripts/ai_bakeoff.py --simulate      # offline self-check
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import platform
import re
import statistics
import sys
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import httpx
from pydantic import BaseModel

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.ai.cache import InMemoryResponseCache  # noqa: E402
from app.ai.client import ProviderProfile  # noqa: E402
from app.ai.consent import ConsentGrant  # noqa: E402
from app.ai.errors import AIError, AIProviderError, AIUnavailableError  # noqa: E402
from app.ai.gateway import AIGateway  # noqa: E402
from app.ai.quota import InMemoryDailyQuota  # noqa: E402
from app.ai.schemas import (  # noqa: E402
    EvidenceItem,
    ExplainGapInput,
    ExtractResumeFieldsInput,
    ParseJobRequirementsInput,
    RewriteBulletInput,
)
from app.core.config import AIProviderName, Settings  # noqa: E402

CORPUS_PATH = BACKEND_DIR / "tests" / "golden" / "synthetic_corpus.json"
DEFAULT_OUT = BACKEND_DIR.parent / "docs" / "ai-bakeoff.md"
SYNTHETIC_USER = "bakeoff-synthetic"
EVIDENCE_ID_RE = re.compile(r"^\[([\w.-]+)\] \((\w+)\) (.*)$", re.MULTILINE)


@dataclass(frozen=True)
class Case:
    name: str
    task: str
    payload: BaseModel
    evidence: tuple[EvidenceItem, ...]


@dataclass
class CaseOutcome:
    case: str
    task: str
    ok_first_pass: bool
    ok_final: bool
    latency_ms: float
    attempts: int
    repaired: bool
    violations: int
    error: str | None = None


@dataclass
class ModelReport:
    provider: str
    model: str
    outcomes: list[CaseOutcome] = field(default_factory=list)


@dataclass
class BakeoffRun:
    status: str
    reason: str
    reports: list[ModelReport]
    repeats: int
    cases_per_model: int
    simulate: bool


# --- Corpus ----------------------------------------------------------------


def load_corpus(path: Path = CORPUS_PATH) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        corpus: dict[str, Any] = json.load(handle)
    return corpus


def _evidence(raw: dict[str, Any]) -> EvidenceItem:
    return EvidenceItem(**raw)


def build_cases(corpus: dict[str, Any]) -> list[Case]:
    cases: list[Case] = []
    for resume in corpus["resumes"]:
        evidence = tuple(_evidence(item) for item in resume["evidence"])
        for bullet in resume["bullets"]:
            cases.append(
                Case(
                    name=f"{resume['id']}:{bullet['id']}",
                    task="rewrite_bullet",
                    payload=RewriteBulletInput(bullet=bullet["text"]),
                    evidence=evidence,
                )
            )
        for index, requirement in enumerate(resume.get("requirements", []), start=1):
            cases.append(
                Case(
                    name=f"{resume['id']}:gap{index}",
                    task="explain_gap",
                    payload=ExplainGapInput(requirement=requirement),
                    evidence=evidence,
                )
            )
        cases.append(
            Case(
                name=f"{resume['id']}:fields",
                task="extract_resume_fields",
                payload=ExtractResumeFieldsInput(parser_text=resume["parser_text"]),
                evidence=evidence,
            )
        )
    for jd in corpus["job_descriptions"]:
        jd_evidence = (EvidenceItem(id=f"jd-{jd['id']}", kind="job_description", text=jd["text"]),)
        cases.append(
            Case(
                name=f"{jd['id']}:requirements",
                task="parse_job_requirements",
                payload=ParseJobRequirementsInput(job_description=jd["text"]),
                evidence=jd_evidence,
            )
        )
        for index, requirement in enumerate(jd["requirements"], start=1):
            cases.append(
                Case(
                    name=f"{jd['id']}:gap{index}",
                    task="explain_gap",
                    payload=ExplainGapInput(requirement=requirement),
                    evidence=jd_evidence,
                )
            )
    return cases


# --- Providers -------------------------------------------------------------


def provider_profile(settings: Settings, name: AIProviderName, model: str) -> ProviderProfile:
    if name == "groq":
        base_url, key = settings.groq_base_url, settings.groq_api_key
    else:
        base_url, key = settings.nvidia_base_url, settings.nvidia_api_key
    return ProviderProfile(
        name=name,
        base_url=base_url,
        model=model,
        api_key=key,
        max_output_tokens=settings.ai_max_output_tokens,
    )


def gateway_for(
    settings: Settings,
    profile: ProviderProfile,
    *,
    transport: httpx.AsyncBaseTransport | None,
) -> AIGateway:
    return AIGateway(
        [profile],
        cache=InMemoryResponseCache(ttl_seconds=0, max_entries=1),
        quota=InMemoryDailyQuota(10_000),
        timeout_seconds=settings.ai_timeout_seconds,
        max_retries=settings.ai_max_retries,
        backoff_base_seconds=settings.ai_backoff_base_seconds,
        retry_after_cap_seconds=settings.ai_retry_after_cap_seconds,
        transport=transport,
    )


def parse_models(raw: str | None, settings: Settings) -> list[tuple[AIProviderName, str]]:
    if not raw:
        names: list[AIProviderName] = []
        for name in (settings.ai_primary_provider, settings.ai_secondary_provider):
            if name not in names:
                names.append(name)
        return [
            (name, settings.groq_model if name == "groq" else settings.nvidia_model)
            for name in names
        ]
    models: list[tuple[AIProviderName, str]] = []
    for item in raw.split(","):
        provider, _, model = item.partition(":")
        provider = provider.strip()
        model = model.strip()
        if provider not in ("groq", "nvidia") or not model:
            raise SystemExit(f"--models expects provider:model entries, got {item!r}")
        models.append((cast(AIProviderName, provider), model))
    return models


def _is_configured(settings: Settings, name: AIProviderName) -> bool:
    return bool(settings.groq_api_key if name == "groq" else settings.nvidia_api_key)


# --- Simulation transport --------------------------------------------------


def _simulated_transport() -> httpx.MockTransport:
    """Offline stand-in: echoes a grounded claim copied from the first evidence line."""

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        schema_name = (
            payload.get("response_format", {}).get("json_schema", {}).get("name")
            or "BulletRewriteResult"
        )
        messages = payload["messages"]
        user_prompt = messages[-1]["content"]
        match = EVIDENCE_ID_RE.search(user_prompt)
        evidence_id = match.group(1) if match else "ev1"
        snippet = (match.group(3) if match else "Synthetic evidence").strip()
        snippet = snippet[:400]
        claim: dict[str, Any] = {"text": snippet, "evidence_ids": [evidence_id]}
        if schema_name in ("parse_job_requirements", "JobRequirementsResult"):
            claim["category"] = "keyword"
        if schema_name in ("extract_resume_fields", "ResumeFieldsResult"):
            claim["field"] = "headline"
        content = json.dumps({"claims": [claim]})
        body = {
            "id": "chatcmpl-simulated",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 100, "completion_tokens": 40, "total_tokens": 140},
        }
        return httpx.Response(200, json=body)

    return httpx.MockTransport(handler)


# --- Running ---------------------------------------------------------------


async def run_case(gateway: AIGateway, case: Case) -> CaseOutcome:
    consent = ConsentGrant.for_synthetic_data(user_id=SYNTHETIC_USER)
    started = time.perf_counter()
    try:
        result = await gateway.run(
            case.task, case.payload, case.evidence, consent=consent, grounding="report"
        )
    except AIError as exc:
        return CaseOutcome(
            case=case.name,
            task=case.task,
            ok_first_pass=False,
            ok_final=False,
            latency_ms=(time.perf_counter() - started) * 1000,
            attempts=0,
            repaired=False,
            violations=0,
            error=_error_label(exc),
        )
    violations = len(result.grounding.violations) if result.grounding else 0
    return CaseOutcome(
        case=case.name,
        task=case.task,
        ok_first_pass=not result.repaired,
        ok_final=True,
        latency_ms=result.latency_ms,
        attempts=result.attempts,
        repaired=result.repaired,
        violations=violations,
    )


def _error_label(exc: AIError) -> str:
    """``code`` plus the provider status when there is one (never a body)."""
    if isinstance(exc, AIProviderError) and exc.status_code is not None:
        return f"{exc.code} ({exc.status_code})"
    if isinstance(exc, AIUnavailableError) and exc.errors:
        return f"{exc.code} ({', '.join(_error_label(error) for error in exc.errors)})"
    return exc.code


async def run_model(
    settings: Settings,
    profile: ProviderProfile,
    cases: Sequence[Case],
    *,
    repeats: int,
    transport: httpx.AsyncBaseTransport | None,
) -> ModelReport:
    gateway = gateway_for(settings, profile, transport=transport)
    report = ModelReport(provider=profile.name, model=profile.model)
    for _ in range(max(1, repeats)):
        for case in cases:
            report.outcomes.append(await run_case(gateway, case))
    return report


def percentile(values: Sequence[float], fraction: float) -> float:
    """Nearest-rank percentile; 0.0 for an empty sample."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil(fraction * len(ordered)))
    return round(ordered[rank - 1], 1)


def summarize(report: ModelReport) -> dict[str, Any]:
    total = len(report.outcomes)
    valid = [outcome for outcome in report.outcomes if outcome.ok_final]
    latencies = [outcome.latency_ms for outcome in valid]
    return {
        "calls": total,
        "first_pass": sum(1 for o in report.outcomes if o.ok_first_pass),
        "final": len(valid),
        "repaired": sum(1 for o in report.outcomes if o.repaired),
        "p50": percentile(latencies, 0.5),
        "p95": percentile(latencies, 0.95),
        "mean": round(statistics.fmean(latencies), 1) if latencies else 0.0,
        "grounding_errors": sum(o.violations for o in report.outcomes),
        "ungrounded_calls": sum(1 for o in report.outcomes if o.violations),
        "errors": [o.error for o in report.outcomes if o.error],
        "by_task": _by_task(report.outcomes),
    }


def _by_task(outcomes: Iterable[CaseOutcome]) -> dict[str, dict[str, Any]]:
    buckets: dict[str, list[CaseOutcome]] = {}
    for outcome in outcomes:
        buckets.setdefault(outcome.task, []).append(outcome)
    summary: dict[str, dict[str, Any]] = {}
    for task, items in sorted(buckets.items()):
        summary[task] = {
            "calls": len(items),
            "final": sum(1 for item in items if item.ok_final),
            "grounding_errors": sum(item.violations for item in items),
        }
    return summary


def _percent(part: int, whole: int) -> str:
    return "n/a" if whole == 0 else f"{(100 * part / whole):.0f}%"


def render_markdown(run: BakeoffRun, settings: Settings, models: Sequence[tuple[str, str]]) -> str:
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    lines: list[str] = []
    lines.append("# AI bake-off (B3)")
    lines.append("")
    lines.append(f"Generated by `backend/scripts/ai_bakeoff.py` on {now}.")
    lines.append("")
    if run.status == "live":
        lines.append("**Status: LIVE run** against the configured providers.")
    elif run.status == "simulated":
        lines.append(
            "**Status: SIMULATED run** (`--simulate`). This checks the harness, not a provider: "
            "the responses are generated locally, so the numbers below are not provider results."
        )
    else:
        lines.append(f"**Status: NOT RUN — no live provider call was made.** {run.reason}")
    lines.append("")
    lines.append("## Method")
    lines.append("")
    lines.append(
        "- Corpus: `backend/tests/golden/synthetic_corpus.json` — synthetic resumes and job "
        "descriptions only; no real personal data."
    )
    lines.append(
        f"- Cases per model per repeat: {run.cases_per_model} "
        "(rewrite_bullet, explain_gap, extract_resume_fields, parse_job_requirements). "
        f"Repeats: {run.repeats}."
    )
    lines.append(
        "- Every call goes through the real gateway: redaction, cache, quota, retries, "
        "one repair attempt, then schema validation and the deterministic claim validator "
        "in report mode."
    )
    lines.append(
        "- `first-pass valid` counts outputs that needed no repair. `final valid` counts "
        "outputs that satisfied the schema after at most one repair attempt."
    )
    lines.append(
        "- `p50`/`p95` are nearest-rank percentiles of successful-call latency in "
        "milliseconds, measured around the provider HTTP call."
    )
    lines.append(
        "- `grounding errors` counts rejected claims (invented metrics, unsupported "
        "technologies/organisations, inflated titles, unsupported dates). A live result "
        "is only usable for a task whose grounding count is zero."
    )
    lines.append("")
    lines.append("## Providers")
    lines.append("")
    lines.append(
        "Base URLs, model IDs, structured-output mode, free-tier limits and data terms were "
        "verified on 2026-10-19 and are recorded in `docs/DECISIONS.md` ADR-029. "
        "Base URLs and model IDs come from settings; nothing here is hardcoded."
    )
    lines.append("")
    lines.append("Configured for this run:")
    lines.append("")
    lines.append("| provider | model |")
    lines.append("|---|---|")
    for provider, model in models:
        lines.append(f"| {provider} | `{model}` |")
    lines.append("")

    if run.reports:
        lines.append("## Results by provider and model")
        lines.append("")
        lines.append(
            "| provider | model | calls | first-pass valid | final valid | p50 ms | p95 ms | "
            "grounding errors | failed calls |"
        )
        lines.append("|---|---|---|---|---|---|---|---|---|")
        for report in run.reports:
            summary = summarize(report)
            lines.append(
                f"| {report.provider} | `{report.model}` | {summary['calls']} | "
                f"{_percent(summary['first_pass'], summary['calls'])} | "
                f"{_percent(summary['final'], summary['calls'])} | {summary['p50']} | "
                f"{summary['p95']} | {summary['grounding_errors']} "
                f"({summary['ungrounded_calls']} call(s)) | {len(summary['errors'])} |"
            )
        lines.append("")
        lines.append("## Results by task")
        lines.append("")
        lines.append("| provider | model | task | calls | final valid | grounding errors |")
        lines.append("|---|---|---|---|---|---|")
        for report in run.reports:
            summary = summarize(report)
            for task, task_summary in summary["by_task"].items():
                lines.append(
                    f"| {report.provider} | `{report.model}` | {task} | "
                    f"{task_summary['calls']} | {task_summary['final']} | "
                    f"{task_summary['grounding_errors']} |"
                )
        lines.append("")
        failures = [
            (report.provider, report.model, outcome.case, outcome.error)
            for report in run.reports
            for outcome in report.outcomes
            if outcome.error
        ]
        if failures:
            lines.append("### Failed calls")
            lines.append("")
            lines.append("| provider | model | case | error code |")
            lines.append("|---|---|---|---|")
            for provider, model, case, error in failures:
                lines.append(f"| {provider} | `{model}` | {case} | {error} |")
            lines.append("")
    else:
        lines.append("## Results")
        lines.append("")
        lines.append("No model was called, so there are no numbers to report.")
        lines.append("")
        lines.append("To produce a table:")
        lines.append("")
        lines.append("```powershell")
        lines.append("cd backend")
        lines.append(
            "$env:RUN_AI_LIVE=1   # plus a real GROQ_API_KEY / NVIDIA_API_KEY in backend/.env"
        )
        lines.append("uv run python scripts/ai_bakeoff.py")
        lines.append("```")
        lines.append("")

    lines.append("## Known gaps (v1)")
    lines.append("")
    lines.append(
        "- The claim validator is deterministic and lexicon-based: an unknown synonym of a "
        "supported technology can be rejected (fail-closed by design, ADR-030)."
    )
    lines.append("- Only one repair attempt is measured; a second repair is not attempted.")
    lines.append(
        "- Latency is measured around the HTTP call and excludes queueing on the provider side "
        "before the request is accepted."
    )
    lines.append(
        "- The corpus is small (synthetic), so the numbers are indicative, not a benchmark."
    )
    lines.append("")
    lines.append(f"Environment: Python {platform.python_version()}, {platform.system()}.")
    lines.append("")
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="B3 AI bake-off harness (synthetic data only)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="report path")
    parser.add_argument("--models", default=None, help="provider:model[,provider:model]")
    parser.add_argument("--repeats", type=int, default=1, help="repeats per case (default 1)")
    parser.add_argument(
        "--simulate", action="store_true", help="offline self-check; no provider is called"
    )
    parser.add_argument("--stdout", action="store_true", help="print the report instead of a table")
    args = parser.parse_args(argv)

    settings = Settings(_env_file=str(BACKEND_DIR / ".env"))
    corpus = load_corpus()
    cases = build_cases(corpus)
    models = parse_models(args.models, settings)

    live = os.environ.get("RUN_AI_LIVE") == "1"
    transport: httpx.AsyncBaseTransport | None = None
    status = "skipped"
    reason = "Set RUN_AI_LIVE=1 with a provider key present to run a live bake-off."

    if args.simulate:
        status = "simulated"
        reason = "--simulate was requested."
        transport = _simulated_transport()
    elif not live:
        reason = (
            "`RUN_AI_LIVE` is not set to 1, so no live call was attempted. "
            "Set `RUN_AI_LIVE=1` and provide a provider key in `backend/.env`."
        )
    else:
        configured = [item for item in models if _is_configured(settings, item[0])]
        missing = [item[0] for item in models if item not in configured]
        if not configured:
            reason = (
                "`RUN_AI_LIVE=1` was set, but no key was present for "
                + ", ".join(sorted(set(missing)))
                + "."
            )
            models = []
        else:
            status = "live"
            reason = ""
            if missing:
                reason = "Live run; no key for " + ", ".join(sorted(set(missing))) + "."

    reports: list[ModelReport] = []
    if status in ("live", "simulated"):
        for name, model in models:
            if status == "live" and not _is_configured(settings, name):
                continue
            profile = provider_profile(settings, name, model)
            reports.append(
                asyncio.run(
                    run_model(
                        settings,
                        profile,
                        cases,
                        repeats=args.repeats,
                        transport=transport,
                    )
                )
            )

    run = BakeoffRun(
        status=status,
        reason=reason,
        reports=reports,
        repeats=max(1, args.repeats),
        cases_per_model=len(cases),
        simulate=args.simulate,
    )
    markdown = render_markdown(run, settings, models)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(markdown)

    if args.stdout:
        print(markdown)
    else:
        print(f"B3 bake-off: {status}. Report written to {args.out}")
        if status == "skipped":
            print(reason)
        for report in reports:
            summary = summarize(report)
            print(
                f"  {report.provider}/{report.model}: calls={summary['calls']} "
                f"final_valid={_percent(summary['final'], summary['calls'])} "
                f"p50={summary['p50']}ms p95={summary['p95']}ms "
                f"grounding_errors={summary['grounding_errors']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
