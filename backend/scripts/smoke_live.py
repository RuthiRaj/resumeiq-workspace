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
one consent row. It then walks the whole B5/B6 surface: the standard resume,
tailored generation, a hand edit, versions, restore, stale, diff, refresh,
version purge/delete, resume purge, PDF export (including the ``X-Export-*``
extraction-check headers), capabilities and the data export. When user B's
credentials are present it also asserts that B cannot read or delete A's
resume and that B's export contains none of A's ids. Cleanup runs in a
``finally`` block and removes exactly the rows this run created (resumes,
workspace items, import sessions, target and, when created here, the consent
row). The append-only ``change_log`` and ``workspace_versions`` rows cannot be
deleted by design (RLS has no DELETE policy); the script says so instead of
pretending otherwise.

The account-deletion success path is destructive, so it is opt-in a third
time: ``SMOKE_DELETE_ACCOUNT=1`` calls ``DELETE /api/v1/account`` with the
exact confirmation at the very end. Without it the script still calls the route
with a wrong phrase and asserts the 400, so the route and its guard are
covered without deleting the shared test account.

Usage (server must already be running on port 8000)::

    cd backend
    $env:RUN_LIVE_SMOKE = "1"
    uv run python scripts/smoke_live.py

Optional: ``SMOKE_BASE_URL`` (default ``http://127.0.0.1:8000``) and
``SMOKE_DELETE_ACCOUNT=1`` for the destructive account-deletion pass.
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

    def __init__(self, token: str, rest_url: str, api_key: str, token_b: str | None = None) -> None:
        self._rest_url = rest_url
        self._api_key = api_key
        self._token_b = token_b or ""
        self._client = httpx.Client(
            base_url=BASE_URL,
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT_SECONDS,
        )
        self.workspace_item_ids: list[str] = []
        self.import_ids: list[str] = []
        self.target_ids: list[str] = []
        self.consent_ids: list[str] = []
        self.resume_ids: list[str] = []
        self.account_deleted = False
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
        # The live server keeps the default 60 requests/minute per-IP limiter.
        # A full audit walk is more traffic than a person generates, so honour
        # Retry-After instead of turning the limiter into a false failure. The
        # limiter itself is probed separately by security_probe.py.
        for attempt in range(5):
            started = time.perf_counter()
            response = self._client.request(method, path, **kwargs)
            self._print_call(method, path, response, (time.perf_counter() - started) * 1000)
            if response.status_code != 429 or attempt == 4:
                return response
            retry_after = min(max(float(response.headers.get("Retry-After", "2")), 1.0), 60.0)
            print(f"       429 rate_limited; retrying after {retry_after:.0f}s")
            time.sleep(retry_after)
        return response  # pragma: no cover - the loop always returns

    def call_with_token(
        self, token: str, method: str, path: str, expected: int, **kwargs: Any
    ) -> httpx.Response:
        """Call the API as another user (isolation checks); prints no token."""
        for attempt in range(5):
            started = time.perf_counter()
            response = httpx.request(
                method,
                f"{BASE_URL}{path}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=TIMEOUT_SECONDS,
                **kwargs,
            )
            self._print_call(f"{method}(B)", path, response, (time.perf_counter() - started) * 1000)
            if response.status_code != 429 or attempt == 4:
                break
            retry_after = min(max(float(response.headers.get("Retry-After", "2")), 1.0), 60.0)
            print(f"       429 rate_limited; retrying after {retry_after:.0f}s")
            time.sleep(retry_after)
        if response.status_code != expected:
            code = _error_code(response) or "no_code"
            raise SmokeError(f"{method}(B) {path} -> {response.status_code} ({code})")
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

        # B6 capabilities and the B5/B6 resume surface, including the PDF
        # extraction check and the complete data export (after a resume exists).
        self._capabilities()
        self._resume_flow(target_id, user_id)

        # Account deletion: the guard is always covered; the destructive
        # success path only with SMOKE_DELETE_ACCOUNT=1.
        self._account_deletion()

    def _capabilities(self) -> None:
        body = self.call_ok("GET", f"{API}/capabilities", 200)
        expected = {"ai", "pdfExport", "dataExport", "accountDeletion"}
        if set(body) != expected:
            raise SmokeError("GET /capabilities returned unexpected keys")
        ai = body.get("ai") or {}
        deletion = body.get("accountDeletion") or {}
        print(
            f"       capabilities ai={ai.get('configured')} "
            f"reword={ai.get('resumeRewording')} pdf={body.get('pdfExport')} "
            f"export={body.get('dataExport')} "
            f"deleteData={deletion.get('dataDeletion')} "
            f"deleteAuth={deletion.get('authUserDeletion')}"
        )

    def _data_export(self, user_id: str) -> None:
        response = self.call("GET", f"{API}/export")
        if response.status_code != 200:
            raise SmokeError(f"GET /export -> {response.status_code}")
        if "attachment" not in response.headers.get("content-disposition", ""):
            raise SmokeError("GET /export did not set an attachment filename")
        if "no-store" not in response.headers.get("cache-control", ""):
            raise SmokeError("GET /export did not set Cache-Control: no-store")
        body = response.json()
        if body.get("format") != "resumeiq.data-export.v1":
            raise SmokeError("GET /export returned an unexpected format")
        if str(body.get("userId")) != user_id:
            raise SmokeError("GET /export returned a different userId")
        table_keys = [
            key
            for key, value in body.items()
            if isinstance(value, list) and key not in {"format", "exportedAt", "userId", "email"}
        ]
        rows = sum(len(value) for value in body.values() if isinstance(value, list))
        foreign = 0
        for key in table_keys:
            for row in body.get(key) or []:
                if isinstance(row, dict) and "user_id" in row and str(row["user_id"]) != user_id:
                    foreign += 1
        if foreign:
            raise SmokeError(f"GET /export contained {foreign} row(s) owned by another user")
        print(f"       data export tables={len(table_keys)} rows={rows} foreignRows={foreign}")

    def _export_pdf(self, resume_id: str, label: str) -> None:
        response = self.call("GET", f"{API}/resumes/{resume_id}/export.pdf")
        if response.status_code != 200:
            raise SmokeError(
                f"GET export.pdf ({label}) -> {response.status_code} "
                f"({_error_code(response) or 'no_code'})"
            )
        headers = response.headers
        check = headers.get("x-export-text-check")
        sections = headers.get("x-export-sections-checked")
        claims = headers.get("x-export-claims-checked")
        missing = headers.get("x-export-claims-missing")
        if "application/pdf" not in headers.get("content-type", ""):
            raise SmokeError(f"export.pdf ({label}) was not a PDF content type")
        if check != "passed" or missing != "0":
            raise SmokeError(f"export.pdf ({label}) text check={check} missing={missing}")
        if "no-store" not in headers.get("cache-control", ""):
            raise SmokeError(f"export.pdf ({label}) did not set Cache-Control: no-store")
        if not response.content.startswith(b"%PDF-"):
            raise SmokeError(f"export.pdf ({label}) body was not a PDF")
        print(
            f"       pdf {label} bytes={len(response.content)} check={check} "
            f"sections={sections} claims={claims} missing={missing}"
        )

    def _cited_workspace_item(self, resume: dict[str, Any]) -> str:
        cited: set[str] = set()
        for section in resume.get("sections") or []:
            for claim in section.get("claims") or []:
                cited.update(str(item) for item in (claim.get("evidenceIds") or []))
        for item_id in self.workspace_item_ids:
            if item_id in cited:
                return item_id
        return ""

    def _resume_flow(self, target_id: str, user_id: str) -> None:
        standard = self.call_ok("GET", f"{API}/resumes/resume-standard", 200)
        print(f"       standard resume sections={len(standard.get('sections') or [])}")
        listed = self.call_list("GET", f"{API}/resumes", 200)
        if not any(row.get("id") == "resume-standard" for row in listed):
            raise SmokeError("GET /resumes did not include the standard resume")
        self._export_pdf("resume-standard", "standard")

        refused = self.call("DELETE", f"{API}/resumes/resume-standard")
        if refused.status_code != 409 or _error_code(refused) != "resume_not_tailored":
            raise SmokeError(
                f"DELETE standard resume -> {refused.status_code} ({_error_code(refused)})"
            )

        generated = self.call_ok(
            "POST",
            f"{API}/targets/{target_id}/resume",
            201,
            json={"title": "Smoke audit tailored resume"},
        )
        resume_id = str(generated.get("id") or "")
        if not resume_id:
            raise SmokeError("tailored resume generation returned no id")
        self.resume_ids.append(resume_id)
        sections = generated.get("sections") or []
        print(
            f"       tailored resume sections={len(sections)} "
            f"claims={sum(len(section.get('claims') or []) for section in sections)}"
        )

        self.call_list("GET", f"{API}/resumes", 200)
        fetched = self.call_ok("GET", f"{API}/resumes/{resume_id}", 200)

        # Cross-user isolation while the resume exists and the per-IP window
        # still has room for user B's four calls.
        self._cross_user_checks(resume_id)

        versions = self.call_list("GET", f"{API}/resumes/{resume_id}/versions", 200)
        print(f"       versions={len(versions)}")
        if versions:
            oldest = str(versions[-1].get("id") or "")
            self.call_ok("POST", f"{API}/resumes/{resume_id}/versions/{oldest}/restore", 200)

        stale = self.call_ok("POST", f"{API}/resumes/{resume_id}/stale", 200)
        print(f"       stale={stale.get('stale')}")
        diff = self.call_ok("GET", f"{API}/resumes/{resume_id}/diff", 200)
        print(
            f"       diff added={len(diff.get('added') or [])} "
            f"removed={len(diff.get('removed') or [])} "
            f"edited={len(diff.get('edited') or [])}"
        )

        # Remove one cited workspace item, prove the resume reports it, then
        # purge the claims that cite it (B6's explicit deletion path).
        cited = self._cited_workspace_item(fetched)
        if cited:
            deleted = self.call("DELETE", f"{API}/workspace/items/{cited}")
            if deleted.status_code != 204:
                raise SmokeError(f"DELETE cited workspace item -> {deleted.status_code}")
            after = self.call_ok("GET", f"{API}/resumes/{resume_id}", 200)
            removed_ids = [str(item) for item in (after.get("removedEvidenceIds") or [])]
            print(f"       removedEvidenceIds={len(removed_ids)}")
            if cited not in removed_ids:
                raise SmokeError("deleted cited item was not reported as removed")
            purge = self.call_ok("POST", f"{API}/resumes/{resume_id}/purge", 200)
            print(
                f"       purge removedClaims={purge.get('removedClaims')} "
                f"versions={purge.get('purgedVersions')}"
            )
        else:
            purge = self.call_ok("POST", f"{API}/resumes/{resume_id}/purge", 200)
            print(f"       purge (no cited item) removedClaims={purge.get('removedClaims')}")

        # Edit a surviving grounded section *after* the restore/purge so the
        # refresh below has something to skip (the edited-mark path).
        after_purge = self.call_ok("GET", f"{API}/resumes/{resume_id}", 200)
        edited_key = ""
        for section in after_purge.get("sections") or []:
            claims = [
                claim
                for claim in (section.get("claims") or [])
                if claim.get("evidenceIds") and not claim.get("removed")
            ]
            if claims:
                edited_key = str(section.get("key"))
                self.call_ok(
                    "PATCH",
                    f"{API}/resumes/{resume_id}/sections/{edited_key}",
                    200,
                    json={
                        "claims": [
                            {"text": claim["text"], "evidenceIds": claim["evidenceIds"]}
                            for claim in claims
                        ]
                    },
                )
                print(f"       edited section={edited_key} claims={len(claims)}")
                break
        if not edited_key:
            print("       edit skipped: no grounded section to edit")

        refreshed = self.call_ok(
            "POST",
            f"{API}/resumes/{resume_id}/refresh",
            200,
            json={"sections": []},
        )
        skipped = [row.get("section") for row in (refreshed.get("skippedSections") or [])]
        if edited_key and edited_key not in skipped:
            raise SmokeError("refresh did not skip the hand-edited section")
        print(
            f"       refresh sections={len(refreshed.get('refreshedSections') or [])} "
            f"skipped={len(skipped)}"
        )

        versions = self.call_list("GET", f"{API}/resumes/{resume_id}/versions", 200)
        if len(versions) >= 2:
            version_id = str(versions[0].get("id") or "")
            self.call_ok("POST", f"{API}/resumes/{resume_id}/versions/{version_id}/purge", 200)
            removed = self.call("DELETE", f"{API}/resumes/{resume_id}/versions/{version_id}")
            if removed.status_code != 204:
                raise SmokeError(f"DELETE resume version -> {removed.status_code}")
            print(f"       version purge+delete id={version_id[:8]}...")

        self._export_pdf(resume_id, "tailored")

        # The export now has workspace, import, target, report and resume rows.
        self._data_export(user_id)

        deleted_resume = self.call("DELETE", f"{API}/resumes/{resume_id}")
        if deleted_resume.status_code != 204:
            raise SmokeError(f"DELETE resume -> {deleted_resume.status_code}")
        gone = self.call("GET", f"{API}/resumes/{resume_id}")
        if gone.status_code != 404:
            raise SmokeError(f"GET deleted resume -> {gone.status_code}")
        self.resume_ids.remove(resume_id)
        print("       resume deleted; GET now returns 404")

    def _cross_user_checks(self, resume_id: str) -> None:
        if not self._token_b:
            print("       cross-user checks skipped: user B credentials are absent")
            return
        listing = self.call_with_token(self._token_b, "GET", f"{API}/resumes", 200)
        if any(row.get("id") == resume_id for row in listing.json()):
            raise SmokeError("user B's resume list contains user A's resume")
        self.call_with_token(self._token_b, "GET", f"{API}/resumes/{resume_id}", 404)
        self.call_with_token(self._token_b, "DELETE", f"{API}/resumes/{resume_id}", 404)
        export = self.call_with_token(self._token_b, "GET", f"{API}/export", 200).json()
        serialized = str(export)
        leaked = resume_id in serialized
        if leaked:
            raise SmokeError("user B's export contains user A's resume id")
        print("       cross-user: B list/get/delete/export isolated (resume id absent)")

    def _account_deletion(self) -> None:
        wrong = self.call("DELETE", f"{API}/account", json={"confirmation": "not the phrase"})
        if wrong.status_code != 400 or _error_code(wrong) != "account_confirmation_required":
            raise SmokeError(
                f"DELETE account (wrong phrase) -> {wrong.status_code} ({_error_code(wrong)})"
            )
        print("       account deletion guard: wrong phrase refused, nothing deleted")
        if os.environ.get("SMOKE_DELETE_ACCOUNT") != "1":
            print("       account deletion success path skipped (SMOKE_DELETE_ACCOUNT!=1)")
            return
        result = self.call_ok(
            "DELETE", f"{API}/account", 200, json={"confirmation": "delete my account"}
        )
        self.account_deleted = True
        print(
            f"       account data deleted={result.get('dataDeleted')} "
            f"authUserDeleted={result.get('authUserDeleted')} "
            f"remainingStep={result.get('remainingStep')} "
            f"tables={len(result.get('deletedCounts') or {})}"
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
        for resume_id in reversed(self.resume_ids):
            # Best effort through the Data API (no per-IP API limiter); a failed
            # run may leave a tailored resume behind. RLS still scopes it to A.
            self.data_api("DELETE", f"/resumes?id=eq.{resume_id}")
        for import_id in reversed(self.import_ids):
            self.data_api("DELETE", f"/import_sessions?id=eq.{import_id}")
        for item_id in reversed(self.workspace_item_ids):
            self.data_api("DELETE", f"/workspace_items?id=eq.{item_id}")
        for target_id in reversed(self.target_ids):
            self.data_api("DELETE", f"/targets?id=eq.{target_id}")
        for consent_id in reversed(self.consent_ids):
            self.data_api("DELETE", f"/consent_records?id=eq.{consent_id}")
        if (
            self.workspace_item_ids
            or self.import_ids
            or self.target_ids
            or self.consent_ids
            or self.resume_ids
        ):
            print(
                "cleanup: removed "
                f"{len(self.resume_ids)} resume(s), "
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
    token_b = supabase_auth.access_token_b() if supabase_auth.isolation_available() else None
    settings = supabase_auth.env()
    smoke = Smoke(
        token,
        settings.supabase_url.rstrip("/") + "/rest/v1",
        settings.supabase_publishable_key,
        token_b,
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
