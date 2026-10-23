"""Opt-in live security probe for the ResumeIQ backend (final hardening audit).

Read-only checks against a *running local server* connected to the real
Supabase project. Nothing is created, changed or deleted. The script prints
statuses, header names/values, counts and contract error codes only; tokens,
passwords, bodies and document text are never printed.

Checks:

1. every OpenAPI operation is authenticated except ``/health`` (and the
   FastAPI documentation routes, which are public by design);
2. an invalid bearer token is rejected;
3. security headers are present on success and on 413/429 responses;
4. CORS preflight/simple responses for the configured origin and a foreign
   origin, including which response headers the browser is allowed to read;
5. the default and import request-size caps return 413;
6. the per-IP limiter returns 429 with ``Retry-After`` (run last, it exhausts
   this process's window).

Run it against a **dedicated** backend port so the limiter probe does not block
the browser or the smoke test::

    cd backend
    $env:RUN_LIVE_SECURITY = "1"
    $env:SECURITY_BASE_URL = "http://127.0.0.1:8010"
    uv run python scripts/security_probe.py

The Supabase integration gate and user A's credentials must be present in
``backend/.env.test``; user B is optional and used only for an identity check.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, cast

import httpx

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from tests import supabase_auth  # noqa: E402  (import after sys.path setup)

BASE_URL = os.environ.get("SECURITY_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
API = "/api/v1"
TIMEOUT_SECONDS = 30.0
ALLOWED_ORIGIN = "http://localhost:3000"
FOREIGN_ORIGIN = "http://evil.example"
DUMMY = "00000000-0000-0000-0000-000000000000"
SECURITY_HEADERS = (
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "content-security-policy",
)


def _code(response: httpx.Response) -> str:
    try:
        detail = response.json().get("detail")
    except Exception:
        return ""
    if isinstance(detail, dict):
        return str(detail.get("code", ""))
    return ""


def _print_call(label: str, method: str, path: str, response: httpx.Response) -> None:
    print(f"  {label:10} {method:6} {path:62} {response.status_code:3} {_code(response)}")


def _load_spec(anonymous: httpx.Client) -> dict[str, Any]:
    try:
        response = anonymous.get("/openapi.json", timeout=TIMEOUT_SECONDS)
        if response.status_code == 200:
            payload = response.json()
            if isinstance(payload, dict):
                return cast("dict[str, Any]", payload)
    except httpx.HTTPError:
        pass
    local = BACKEND_ROOT.parent / "docs" / "api" / "openapi.json"
    payload = json.loads(local.read_text(encoding="utf-8"))
    return cast("dict[str, Any]", payload)


def check_public_surface(anonymous: httpx.Client, spec: dict) -> list[str]:
    print("public surface (no Authorization header):")
    findings: list[str] = []
    health = anonymous.get("/health", timeout=5.0)
    _print_call("public", "GET", "/health", health)
    if health.status_code != 200:
        findings.append(f"/health without a token -> {health.status_code}")

    for path in ("/docs", "/redoc", "/openapi.json"):
        response = anonymous.get(path, timeout=10.0)
        _print_call("public", "GET", path, response)
        if response.status_code == 200:
            findings.append(f"{path} is public (API documentation exposure)")

    protected = 0
    for path, operations in sorted(spec.get("paths", {}).items()):
        if path == "/health":
            continue
        probe_path = re.sub(r"\{[^}]+\}", DUMMY, path)
        for method in sorted(operations):
            if method.upper() not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                continue
            response = anonymous.request(method.upper(), probe_path, timeout=TIMEOUT_SECONDS)
            protected += 1
            _print_call("no-token", method.upper(), probe_path, response)
            if response.status_code != 401:
                findings.append(
                    f"{method.upper()} {probe_path} without a token -> "
                    f"{response.status_code} ({_code(response) or 'no_code'})"
                )
    print(f"  protected operations checked: {protected}")
    return findings


def check_tokens(client: httpx.Client, token_b: str | None) -> list[str]:
    print("token checks:")
    findings: list[str] = []
    invalid = client.get(f"{API}/me", headers={"Authorization": "Bearer not-a-token"})
    _print_call("invalid", "GET", f"{API}/me", invalid)
    if invalid.status_code != 401:
        findings.append(f"invalid token -> {invalid.status_code} ({_code(invalid)})")

    me = client.get(f"{API}/me")
    _print_call("valid-A", "GET", f"{API}/me", me)
    if me.status_code != 200:
        findings.append(f"valid A token -> {me.status_code} ({_code(me)})")
    if token_b:
        other = httpx.get(
            f"{BASE_URL}{API}/me",
            headers={"Authorization": f"Bearer {token_b}"},
            timeout=TIMEOUT_SECONDS,
        )
        _print_call("valid-B", "GET", f"{API}/me", other)
        if other.status_code != 200:
            findings.append(f"valid B token -> {other.status_code} ({_code(other)})")
        if me.status_code == 200 and other.status_code == 200:
            same = me.json().get("id") == other.json().get("id")
            print(f"  A and B resolve to different users: {not same}")
            if same:
                findings.append("user A and user B tokens resolved to the same user id")
    return findings


def check_headers(responses: list[tuple[str, httpx.Response]]) -> list[str]:
    print("security headers:")
    findings: list[str] = []
    for label, response in responses:
        missing = [name for name in SECURITY_HEADERS if name not in response.headers]
        request_id = response.headers.get("x-request-id", "")
        server = response.headers.get("server", "")
        hsts = response.headers.get("strict-transport-security", "")
        print(
            f"  {label:10} status={response.status_code} missing={missing or 'none'} "
            f"request_id={'yes' if request_id else 'no'} server={server or 'none'} "
            f"hsts={'yes' if hsts else 'no'}"
        )
        if missing:
            findings.append(f"{label} response missing headers: {', '.join(missing)}")
        if not request_id:
            findings.append(f"{label} response missing X-Request-ID")
        if server:
            findings.append(f"{label} response advertises Server: {server}")
    return findings


def check_cors(anonymous: httpx.Client, client: httpx.Client) -> list[str]:
    print("CORS:")
    findings: list[str] = []
    preflight_headers = {
        "Origin": ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
    }
    preflight = anonymous.options(f"{API}/me", headers=preflight_headers)
    _print_call("preflight", "OPTIONS", f"{API}/me", preflight)
    allow_origin = preflight.headers.get("access-control-allow-origin", "")
    allow_methods = preflight.headers.get("access-control-allow-methods", "")
    allow_headers = preflight.headers.get("access-control-allow-headers", "")
    credentials = preflight.headers.get("access-control-allow-credentials", "")
    print(
        f"  allowed origin echoed: {allow_origin == ALLOWED_ORIGIN}; "
        f"methods={allow_methods or 'none'}; headers={allow_headers or 'none'}; "
        f"credentials={credentials or 'none'}"
    )
    if allow_origin != ALLOWED_ORIGIN:
        findings.append("CORS preflight did not echo the configured origin")
    if "authorization" not in allow_headers.lower():
        findings.append("CORS preflight does not allow the Authorization header")

    simple = client.get(f"{API}/me", headers={"Origin": ALLOWED_ORIGIN})
    _print_call("simple", "GET", f"{API}/me", simple)
    print(
        f"  simple response allow-origin: {simple.headers.get('access-control-allow-origin', '')}"
    )
    if simple.headers.get("access-control-allow-origin") != ALLOWED_ORIGIN:
        findings.append("CORS simple response did not echo the configured origin")

    foreign = anonymous.get(f"{API}/me", headers={"Origin": FOREIGN_ORIGIN})
    _print_call("foreign", "GET", f"{API}/me", foreign)
    if foreign.headers.get("access-control-allow-origin"):
        findings.append("CORS simple response echoed a foreign origin")

    foreign_preflight = anonymous.options(
        f"{API}/me", headers={**preflight_headers, "Origin": FOREIGN_ORIGIN}
    )
    _print_call("foreign-pre", "OPTIONS", f"{API}/me", foreign_preflight)
    if foreign_preflight.headers.get("access-control-allow-origin"):
        findings.append("CORS preflight echoed a foreign origin")

    export = client.get(f"{API}/export", headers={"Origin": ALLOWED_ORIGIN})
    _print_call("export", "GET", f"{API}/export", export)
    exposed = export.headers.get("access-control-expose-headers", "")
    print(f"  export expose-headers: {exposed or 'none'}")
    if "content-disposition" not in exposed.lower():
        findings.append("CORS does not expose Content-Disposition for the data export")

    pdf = client.get(
        f"{API}/resumes/resume-standard/export.pdf", headers={"Origin": ALLOWED_ORIGIN}
    )
    _print_call("pdf", "GET", f"{API}/resumes/resume-standard/export.pdf", pdf)
    exposed = pdf.headers.get("access-control-expose-headers", "")
    check = pdf.headers.get("x-export-text-check", "")
    print(f"  pdf check header={check or 'none'} expose-headers={exposed or 'none'}")
    if check and "x-export-text-check" not in exposed.lower():
        findings.append(
            "CORS does not expose the X-Export-* PDF check headers; the browser "
            "cannot verify the extraction check and the UI refuses to download"
        )
    return findings


def check_size_limits(client: httpx.Client) -> tuple[list[str], list[tuple[str, httpx.Response]]]:
    print("request-size limits:")
    findings: list[str] = []
    responses: list[tuple[str, httpx.Response]] = []
    oversized = b"x" * (1_048_576 + 1)
    default = client.post(
        f"{API}/workspace/items",
        content=oversized,
        headers={"Content-Type": "application/json"},
    )
    _print_call("size-default", "POST", f"{API}/workspace/items", default)
    responses.append(("size413", default))
    if default.status_code != 413 or _code(default) != "payload_too_large":
        findings.append(
            f"default 1 MiB cap -> {default.status_code} ({_code(default) or 'no_code'})"
        )

    import_oversized = b"x" * (5 * 1024 * 1024 + 8193)
    import_response = client.post(
        f"{API}/imports",
        content=import_oversized,
        headers={"Content-Type": "multipart/form-data; boundary=probe"},
    )
    _print_call("size-import", "POST", f"{API}/imports", import_response)
    responses.append(("size413", import_response))
    if import_response.status_code != 413 or _code(import_response) != "payload_too_large":
        findings.append(
            f"import cap -> {import_response.status_code} ({_code(import_response) or 'no_code'})"
        )
    return findings, responses


def check_rate_limit(anonymous: httpx.Client) -> tuple[list[str], list[tuple[str, httpx.Response]]]:
    print("rate limit (last; exhausts this process's window):")
    findings: list[str] = []
    responses: list[tuple[str, httpx.Response]] = []
    allowed = 0
    limited: httpx.Response | None = None
    for _ in range(120):
        response = anonymous.get("/health", timeout=5.0)
        if response.status_code == 429:
            limited = response
            break
        if response.status_code != 200:
            findings.append(f"GET /health under the limiter -> {response.status_code}")
            break
        allowed += 1
    if limited is None:
        findings.append("the limiter did not return 429 within 120 requests")
        print("  429 not reached")
    else:
        responses.append(("rate429", limited))
        retry_after = limited.headers.get("retry-after", "")
        print(
            f"  allowed before 429: {allowed}; retry-after={retry_after or 'none'}; "
            f"code={_code(limited) or 'none'}"
        )
        if not retry_after:
            findings.append("429 response has no Retry-After header")
    return findings, responses


def main() -> int:
    if os.environ.get("RUN_LIVE_SECURITY") != "1":
        print("security probe skipped: set RUN_LIVE_SECURITY=1 to run it.")
        return 0
    if not supabase_auth.enabled():
        print(f"security probe skipped: {supabase_auth.skip_reason()}")
        return 0

    token_a = supabase_auth.access_token_a()
    token_b = supabase_auth.access_token_b() if supabase_auth.isolation_available() else None
    headers = {"Authorization": f"Bearer {token_a}"}
    print(f"security probe against {BASE_URL} (statuses/codes/counts only)")

    findings: list[str] = []
    with httpx.Client(base_url=BASE_URL, timeout=TIMEOUT_SECONDS) as anonymous:
        spec = _load_spec(anonymous)
        findings.extend(check_public_surface(anonymous, spec))

        with httpx.Client(base_url=BASE_URL, headers=headers, timeout=TIMEOUT_SECONDS) as client:
            findings.extend(check_tokens(client, token_b))
            me = client.get(f"{API}/me")
            findings.extend(
                check_headers([("health", anonymous.get("/health", timeout=5.0)), ("me", me)])
            )
            findings.extend(check_cors(anonymous, client))
            size_findings, size_responses = check_size_limits(client)
            findings.extend(size_findings)
            findings.extend(check_headers(size_responses))

        rate_findings, rate_responses = check_rate_limit(anonymous)
        findings.extend(rate_findings)
        findings.extend(check_headers(rate_responses))

    findings = list(dict.fromkeys(findings))

    print("findings:")
    if not findings:
        print("  none")
    for finding in findings:
        print(f"  - {finding}")
    print(f"total findings: {len(findings)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
