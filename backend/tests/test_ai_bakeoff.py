"""Bake-off harness: corpus loading, metrics, offline simulation, report shape."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]


def load_script():
    path = BACKEND_DIR / "scripts" / "ai_bakeoff.py"
    spec = importlib.util.spec_from_file_location("ai_bakeoff", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["ai_bakeoff"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def bakeoff():
    return load_script()


def test_corpus_is_synthetic_and_loads(bakeoff) -> None:
    corpus = bakeoff.load_corpus()
    assert "SYNTHETIC ONLY" in corpus["note"]
    assert corpus["resumes"] and corpus["job_descriptions"]
    # No real-looking public domains in fixtures.
    text = bakeoff.CORPUS_PATH.read_text(encoding="utf-8")
    assert "@example.com" in text


def test_cases_cover_every_task(bakeoff) -> None:
    cases = bakeoff.build_cases(bakeoff.load_corpus())
    tasks = {case.task for case in cases}
    assert tasks == {
        "rewrite_bullet",
        "explain_gap",
        "extract_resume_fields",
        "parse_job_requirements",
    }
    assert len(cases) >= 6
    for case in cases:
        assert case.evidence, case.name


def test_percentile_uses_nearest_rank(bakeoff) -> None:
    values = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0]
    assert bakeoff.percentile(values, 0.5) == 50.0
    assert bakeoff.percentile(values, 0.95) == 100.0
    assert bakeoff.percentile([], 0.5) == 0.0


def test_parse_models_defaults_and_overrides(bakeoff) -> None:
    from app.core.config import Settings

    settings = Settings(_env_file=None, groq_model="m-groq", nvidia_model="m-nvidia")
    assert bakeoff.parse_models(None, settings) == [
        ("groq", "m-groq"),
        ("nvidia", "m-nvidia"),
    ]
    assert bakeoff.parse_models("nvidia:openai/gpt-oss-20b", settings) == [
        ("nvidia", "openai/gpt-oss-20b")
    ]
    with pytest.raises(SystemExit):
        bakeoff.parse_models("openai:gpt", settings)


def test_simulated_run_produces_metrics_and_a_report(bakeoff, tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("RUN_AI_LIVE", raising=False)
    out = tmp_path / "ai-bakeoff.md"
    exit_code = bakeoff.main(["--simulate", "--out", str(out), "--models", "groq:test-model"])
    assert exit_code == 0

    markdown = out.read_text(encoding="utf-8")
    assert "Status: SIMULATED run" in markdown
    assert "grounding errors" in markdown
    assert "| groq | `test-model` |" in markdown


def test_simulated_run_numbers_are_complete(bakeoff, monkeypatch) -> None:
    from app.core.config import Settings

    monkeypatch.delenv("RUN_AI_LIVE", raising=False)
    settings = Settings(_env_file=None, ai_max_output_tokens=64)
    cases = bakeoff.build_cases(bakeoff.load_corpus())
    profile = bakeoff.provider_profile(settings, "groq", "test-model")
    import asyncio

    report = asyncio.run(
        bakeoff.run_model(
            settings, profile, cases, repeats=1, transport=bakeoff._simulated_transport()
        )
    )

    summary = bakeoff.summarize(report)
    assert summary["calls"] == len(cases)
    assert summary["final"] == len(cases)  # the simulated responses are schema-valid
    assert summary["p50"] > 0
    assert summary["p95"] >= summary["p50"]
    assert summary["grounding_errors"] == 0  # each claim copies its cited evidence


def test_live_run_without_keys_is_skipped_and_explained(bakeoff, tmp_path, monkeypatch) -> None:
    from app.core.config import Settings

    monkeypatch.setenv("RUN_AI_LIVE", "1")
    out = tmp_path / "ai-bakeoff.md"
    # Hermetic settings with no keys at all.
    monkeypatch.setattr(
        bakeoff,
        "Settings",
        lambda **_kwargs: Settings(_env_file=None),
    )
    bakeoff.main(["--out", str(out), "--models", "groq:test-model"])
    markdown = out.read_text(encoding="utf-8")
    assert "NOT RUN" in markdown
    assert "no key was present" in markdown


def test_live_flag_absent_is_skipped(bakeoff, tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("RUN_AI_LIVE", raising=False)
    out = tmp_path / "ai-bakeoff.md"
    bakeoff.main(["--out", str(out), "--models", "nvidia:test-model"])
    markdown = out.read_text(encoding="utf-8")
    assert "NOT RUN" in markdown
    assert "RUN_AI_LIVE" in markdown


def test_report_renderer_marks_simulated_runs_as_not_provider_results(bakeoff) -> None:
    run = bakeoff.BakeoffRun(
        status="simulated",
        reason="",
        reports=[],
        repeats=1,
        cases_per_model=8,
        simulate=True,
    )
    from app.core.config import Settings

    markdown = bakeoff.render_markdown(run, Settings(_env_file=None), [("groq", "test-model")])
    assert "not provider results" in markdown
    assert "ADR-029" in markdown
