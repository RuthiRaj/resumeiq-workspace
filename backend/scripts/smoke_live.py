"""Opt-in live smoke test for the ResumeIQ backend (stack audit).

Walks every mounted endpoint in order against a *running local server* that is
connected to the real Supabase project, using test user A from
``backend/.env.test`` (via ``tests.supabase_auth``). Every request prints one
line -- method, path, status, milliseconds and the contract error code -- and
only names, statuses and counts are printed. Tokens, passwords, bodies and
document text are never printed.

The script is opt-in twice over:

* ``RUN_LIVE_SMOKE=1`` must be set (so a normal test run never touches live
  data), and
* the Supabase integration gate and user A's credentials must be present
  (``RUN_SUPABASE_INTEGRATION`` + ``SUPABASE_TEST_*_A`` in
  ``backend/.env.test``).

It creates synthetic workspace items, two synthetic imports (PDF and DOCX built
in code), one target, an analysis run and -- only if user A had no live grant --
one consent row. Cleanup runs in a ``finally`` block and removes exactly the
rows this run created (workspace items, import sessions, target and, when
created here, the consent row). The append-only ``change_log`` and
``workspace_versions`` rows cannot be deleted by design (RLS has no DELETE
policy); the script says so instead of pretending otherwise.

Usage (server must already be running on port 8000)::

    cd backend
    $env:RUN_LIVE_SMOKE = "1"
    uv run python scripts/smoke_live.py

Optional: ``SMOKE_BASE_URL`` (default ``http://127.0.0.1:8000``).
"""

from __future__ import annotations

import io
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from tests import supabase_auth  # noqa: E402  (import after sys.path setup)

BASE_URL = os.environ.get("SMOKE_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
API = "/api/v1"
TIMEOUT_SECONDS = 30.0
POLL_INTERVAL_SECONDS = 0.3
POLL_TIMEOUT_SECONDS = 120.0

PDF_LINES = [
    "EXAMPLE CANDIDATE",
    "Example City, EX",
    "example.candidate@example.com",
    "",
    "EXPERIENCE",
    "Smoke Audit Intern",
    "Example Smoke Ltd",
    "Jan 2024 - Sep 2024",
    "- Built an internal reporting endpoint for the support team.",
    "",
    "EDUCATION",
    "BSc Computer Science",
    "Example University",
    "Sep 2019 - Jun 2022",
    "",
    "SKILLS",
    "TypeScript, Python",
]


class SmokeError(RuntimeError):
    """A call returned an unexpected status; the message names only the code."""


# --- Synthetic documents (generated in code, fictional content only) --------


def _escape_pdf_text(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def build_pdf(pages: list[list[str]]) -> bytes:
    """A minimal but valid text PDF (Helvetica, real xref table)."""
    page_count = len(pages)
    font_obj = 3 + 2 * page_count
    objects: dict[int, bytes] = {}
    kids = " ".join(f"{3 + 2 * index} 0 R" for index in range(page_count))
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {page_count} >>".encode()
    objects[font_obj] = (
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    )
    for index, lines in enumerate(pages):
        page_obj = 3 + 2 * index
        content_obj = page_obj + 1
        body = ["BT", "/F1 12 Tf", "14 TL", "72 740 Td"]
        for line in lines:
            body.append(f"({_escape_pdf_text(line)}) Tj")
            body.append("T*")
        body.append("ET")
        content = "\n".join(body).encode("latin-1", "replace")
        objects[page_obj] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_obj} 0 R >> >> /Contents {content_obj} 0 R >>"
        ).encode()
        objects[content_obj] = (
            b"<< /Length "
            + str(len(content)).encode()
            + b" >>\nstream\n"
            + content
            + b"\nendstream"
        )

    out = bytearray(b"%PDF-1.4\n")
    offsets: dict[int, int] = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n"

    xref_position = len(out)
    size = max(objects) + 1
    out += f"xref\n0 {size}\n".encode()
    out += b"0000000000 65535 f \n"
    for number in range(1, size):
        if number in offsets:
            out += f"{offsets[number]:010d} 00000 n \n".encode()
        else:
            out += b"0000000000 65535 f \n"
    out += f"trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref_position}\n%%EOF\n".encode()
    return bytes(out)


def build_docx(paragraphs: list[str]) -> bytes:
    """A DOCX with one paragraph per line (fictional content only)."""
    import docx  # imported lazily: only the live smoke path needs it

    document = docx.Document()
    for line in paragraphs:
        document.add_paragraph(line)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


# --- Reporting helpers -------------------------------------------------------


def _error_code(response: httpx.Response) -> str:
    try:
        body: Any = response.json()
    except ValueError:
        return ""
    if isinstance(body, dict):
        detail = body.get("detail")
        if isinstance(detail, dict) and detail.get("code"):
            return str(detail["code"])
        if body.get("code"):
            return str(body["code"])
    return ""


class Smoke:
    """One live smoke run; tracks what it creates so cleanup is exact."""

    def __init__(self, token: str, rest_url: str, api_key: str) -> None:
        self._rest_url = rest_url
        self._api_key = api_key
        self._client = httpx.Client(
            base_url=BASE_URL,
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT_SECONDS,
        )
        self.workspace_item_ids: list[str] = []
        self.import_ids: list[str] = []
        self.target_ids: list[str] = []
        self.consent_ids: list[str] = []
        self.calls = 0
        self.failures: list[str] = []

    def close(self) -> None:
        self._client.close()

    # -- request plumbing ---------------------------------------------------

    def _print_call(self, method: str, path: str, response: httpx.Response, ms: float) -> None:
        code = _error_code(response) if response.status_code >= 400 else ""
        print(f"{method:<6} {path} {response.status_code} {ms:8.1f}ms {code}".rstrip())
        self.calls += 1

    def call(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        started = time.perf_counter()
        response = self._client.request(method, path, **kwargs)
        self._print_call(method, path, response, (time.perf_counter() - started) * 1000)
        return response

    def call_ok(self, method: str, path: str, expected: int, **kwargs: Any) -> dict[str, Any]:
        response = self.call(method, path, **kwargs)
        if response.status_code != expected:
            code = _error_code(response) or "no_code"
            raise SmokeError(f"{method} {path} -> {response.status_code} ({code})")
        if response.status_code == 204 or not response.content:
            return {}
        body = response.json()
        if not isinstance(body, dict):
            raise SmokeError(f"{method} {path} returned a non-object body")
        return body

    def call_list(self, method: str, path: str, expected: int, **kwargs: Any) -> list[Any]:
        response = self.call(method, path, **kwargs)
        if response.status_code != expected:
            code = _error_code(response) or "no_code"
            raise SmokeError(f"{method} {path} -> {response.status_code} ({code})")
        body = response.json()
        if not isinstance(body, list):
            raise SmokeError(f"{method} {path} returned a non-list body")
        return body

    # -- Supabase Data API (consent + cleanup only) -------------------------

    def data_api(
        self, method: str, path: str, *, extra_headers: dict[str, str] | None = None, **kwargs: Any
    ) -> httpx.Response:
        headers = {
            "apikey": self._api_key,
            "Authorization": self._client.headers["Authorization"],
            "Accept": "application/json",
        }
        if extra_headers:
            headers.update(extra_headers)
        started = time.perf_counter()
        response = httpx.request(
            method,
            f"{self._rest_url}{path}",
            headers=headers,
            timeout=TIMEOUT_SECONDS,
            **kwargs,
        )
        route = path.split("?")[0]
        self._print_call(
            method, f"/rest/v1{route}", response, (time.perf_counter() - started) * 1000
        )
        return response

    # -- flow ---------------------------------------------------------------

    def run(self) -> None:
        health = self.call("GET", "/health", timeout=5.0)
        if health.status_code != 200:
            raise SmokeError(f"GET /health -> {health.status_code}")

        me = self.call_ok("GET", f"{API}/me", 200)
        user_id = str(me.get("id", ""))
        if not user_id:
            raise SmokeError("GET /api/v1/me returned no id")

        workspace = self.call_ok("GET", f"{API}/workspace", 200)
        print(
            f"       workspace version={workspace.get('version')} "
            f"items={len(workspace.get('items') or [])}"
        )

        first = self._create_workspace_item("Smoke Audit Role", "Example Smoke Ltd")
        self.call_ok("GET", f"{API}/workspace/items/{first}", 200)
        self.call_ok(
            "PATCH",
            f"{API}/workspace/items/{first}",
            200,
            json={"title": "Smoke Audit Role Updated", "location": "Example City"},
        )

        second = self._create_workspace_item("Smoke Audit Role Two", "Example Smoke Ltd")
        self.call_ok(
            "POST",
            f"{API}/workspace/reorder",
            200,
            json={"section": "experience", "orderedIds": [second, first]},
        )
        deleted = self.call("DELETE", f"{API}/workspace/items/{second}")
        if deleted.status_code != 204:
            raise SmokeError(f"DELETE workspace item -> {deleted.status_code}")
        self.call_ok("POST", f"{API}/workspace/items/{second}/restore", 200)

        self.call_list("GET", f"{API}/workspace/changelog", 200)
        self.call_ok("GET", f"{API}/resume/standard", 200)

        # Import: PDF, review, patch, confirm.
        pdf_id = self._import_document("smoke-audit.pdf", build_pdf([PDF_LINES]), "application/pdf")
        self._review_and_confirm(pdf_id)

        # Import: DOCX, review, patch, confirm.
        docx_id = self._import_document(
            "smoke-audit.docx",
            build_docx(PDF_LINES),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        self._review_and_confirm(docx_id)

        # Targets.
        target = self.call_ok(
            "POST",
            f"{API}/targets",
            201,
            json={
                "role": "Smoke Audit Engineer",
                "company": "Example Smoke Ltd",
                "jobDescription": (
                    "We are looking for a backend engineer to build reporting APIs "
                    "with Python and PostgreSQL, and to work with TypeScript on the "
                    "dashboard. Experience with REST APIs and testing is required."
                ),
                "requiredSkills": ["Python", "PostgreSQL", "TypeScript"],
            },
        )
        target_id = str(target.get("id", ""))
        if target_id:
            self.target_ids.append(target_id)
        self.call_list("GET", f"{API}/targets", 200)
        self.call_ok("GET", f"{API}/targets/{target_id}", 200)

        # Consent (the backend has no consent endpoint; live mode writes the
        # row through the Data API with the user's own JWT -- ADR-033 §6).
        self._ensure_consent(user_id)

        self.call_ok("POST", f"{API}/targets/{target_id}/analysis", 202)
        run = self._poll_run(target_id)
        print(
            f"       analysis run status={run.get('status')} "
            f"stage={run.get('stage')} stageIndex={run.get('stageIndex')}"
        )
        report = self.call_ok("GET", f"{API}/targets/{target_id}/analysis", 200)
        print(
            f"       report score={report.get('score')} "
            f"requirements={len(report.get('requirements') or [])} "
            f"ats={((report.get('ats') or {}).get('score'))}"
        )

    def _create_workspace_item(self, title: str, organization: str) -> str:
        body = self.call_ok(
            "POST",
            f"{API}/workspace/items",
            201,
            json={
                "section": "experience",
                "title": title,
                "organization": organization,
                "startDate": "2024-01",
                "endDate": "2024-06",
                "bullets": ["Synthetic audit bullet for the stack-health smoke run."],
                "tags": ["Python"],
                "evidence": "attested",
            },
        )
        item_id = str(body.get("id", ""))
        if item_id:
            self.workspace_item_ids.append(item_id)
        return item_id

    def _import_document(self, name: str, data: bytes, content_type: str) -> str:
        body = self.call_ok(
            "POST",
            f"{API}/imports",
            201,
            files={"file": (name, data, content_type)},
        )
        session = body.get("import") or {}
        import_id = str(session.get("id", ""))
        if import_id:
            self.import_ids.append(import_id)
        self.call_list("GET", f"{API}/imports", 200)
        session = self.call_ok("GET", f"{API}/imports/{import_id}", 200)
        print(
            f"       import type={session.get('fileType')} items="
            f"{len(session.get('items') or [])} preview={session.get('previewAvailable')}"
        )
        return import_id

    def _review_and_confirm(self, import_id: str) -> None:
        session = self.call_ok("GET", f"{API}/imports/{import_id}", 200)
        items = session.get("items") or []
        if not items:
            raise SmokeError("import produced no review items")
        item = next(
            (row for row in items if (row.get("values") or {}).get("title")),
            items[0],
        )
        item_id = str(item.get("id", ""))
        values = dict(item.get("values") or {})
        bullets = list(values.get("bullets") or [])
        bullets.append("Synthetic audit bullet added during review.")
        values["bullets"] = bullets
        self.call_ok(
            "PATCH",
            f"{API}/imports/{import_id}/items/{item_id}",
            200,
            json={"values": values},
        )
        confirmed = self.call_ok(
            "POST",
            f"{API}/imports/{import_id}/items/{item_id}/confirm",
            201,
        )
        workspace_item = confirmed.get("item") or {}
        workspace_item_id = str(workspace_item.get("id", ""))
        if workspace_item_id:
            self.workspace_item_ids.append(workspace_item_id)
        print(
            f"       confirmed evidence={workspace_item.get('evidence')} "
            f"section={workspace_item.get('section')}"
        )

    def _ensure_consent(self, user_id: str) -> None:
        query = (
            "/consent_records?select=id"
            f"&user_id=eq.{user_id}&purpose=eq.ai_processing"
            "&granted=is.true&revoked_at=is.null&limit=1"
        )
        response = self.data_api("GET", query)
        if response.status_code != 200:
            raise SmokeError(f"consent lookup -> {response.status_code}")
        rows = response.json() if response.content else []
        if isinstance(rows, list) and rows:
            print("       consent already recorded (left untouched)")
            return
        created = self.data_api(
            "POST",
            "/consent_records",
            extra_headers={
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            json={
                "user_id": user_id,
                "purpose": "ai_processing",
                "provider": "deterministic_engine",
                "granted": True,
                "granted_at": datetime.now(UTC).isoformat(),
            },
        )
        if created.status_code not in (200, 201):
            raise SmokeError(f"consent insert -> {created.status_code}")
        body = created.json()
        if isinstance(body, list) and body and body[0].get("id"):
            self.consent_ids.append(str(body[0]["id"]))
        print("       consent recorded for this run (will be removed)")

    def _poll_run(self, target_id: str) -> dict[str, Any]:
        started = time.monotonic()
        run: dict[str, Any] = {}
        while time.monotonic() - started < POLL_TIMEOUT_SECONDS:
            response = self.call("GET", f"{API}/targets/{target_id}/analysis/run")
            if response.status_code == 429:
                # The default per-IP limit is 60 requests/minute and the theatre
                # polls every 300 ms; honour Retry-After instead of failing the
                # whole smoke run on a limit that an honest client should respect.
                retry_after = float(response.headers.get("Retry-After", "2"))
                time.sleep(min(max(retry_after, 1.0), 60.0))
                continue
            if response.status_code != 200:
                raise SmokeError(
                    f"GET /targets/{{id}}/analysis/run -> {response.status_code} "
                    f"({_error_code(response) or 'no_code'})"
                )
            body = response.json()
            run = body.get("run") or {}
            if run.get("status") in {"succeeded", "failed"}:
                return run
            time.sleep(POLL_INTERVAL_SECONDS)
        raise SmokeError("analysis run did not finish before the poll timeout")

    # -- cleanup ------------------------------------------------------------

    def cleanup(self) -> None:
        for import_id in reversed(self.import_ids):
            self.data_api("DELETE", f"/import_sessions?id=eq.{import_id}")
        for item_id in reversed(self.workspace_item_ids):
            self.data_api("DELETE", f"/workspace_items?id=eq.{item_id}")
        for target_id in reversed(self.target_ids):
            self.data_api("DELETE", f"/targets?id=eq.{target_id}")
        for consent_id in reversed(self.consent_ids):
            self.data_api("DELETE", f"/consent_records?id=eq.{consent_id}")
        if self.workspace_item_ids or self.import_ids or self.target_ids or self.consent_ids:
            print(
                "cleanup: removed "
                f"{len(self.workspace_item_ids)} workspace item(s), "
                f"{len(self.import_ids)} import session(s), "
                f"{len(self.target_ids)} target(s), "
                f"{len(self.consent_ids)} consent row(s); "
                "change_log/workspace_versions rows are append-only and remain"
            )


def main() -> int:
    if not supabase_auth.live_smoke_enabled():
        print(
            "smoke skipped: set RUN_LIVE_SMOKE=1 in the shell "
            "or backend/.env.test to run against the live backend"
        )
        return 0
    if not supabase_auth.enabled():
        print(f"smoke skipped: {supabase_auth.skip_reason()}")
        return 0

    token = supabase_auth.access_token_a()
    settings = supabase_auth.env()
    smoke = Smoke(
        token, settings.supabase_url.rstrip("/") + "/rest/v1", settings.supabase_publishable_key
    )
    status = 1
    try:
        smoke.run()
        status = 0
    except SmokeError as exc:
        print(f"FAILED: {exc}")
    except httpx.HTTPError as exc:
        # Type only: an httpx error message can contain the URL. It never
        # contains the token, but the contract is "names and codes only".
        print(f"FAILED: transport error ({type(exc).__name__})")
    finally:
        try:
            smoke.cleanup()
        finally:
            smoke.close()

    print(f"smoke: {smoke.calls} calls, exit {status}")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
