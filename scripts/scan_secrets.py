"""Read-only secret-pattern scan for the final hardening audit.

Scans tracked files and the full git history (``git log -p --all``) and prints
counts only: no matched line, file name, value or token is ever printed. Files
whose name looks like an environment file are never read (the audit must not
read ``.env`` files); the scan reports whether any such file is tracked and
whether git ignores it.

Usage::

    python scripts/scan_secrets.py
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PATTERNS: dict[str, re.Pattern[str]] = {
    "jwt": re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    "bearer": re.compile(r"Bearer\s+[A-Za-z0-9._-]{12,}"),
    "openai_key": re.compile(r"sk-[A-Za-z0-9]{20,}"),
    "groq_key": re.compile(r"gsk_[A-Za-z0-9]{20,}"),
    "nvidia_key": re.compile(r"nvapi-[A-Za-z0-9_-]{20,}"),
    "github_token": re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    "aws_access_key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "supabase_service_key": re.compile(r"SUPABASE_SERVICE_ROLE_KEY\s*=\s*[^\s\"']+"),
    "postgres_url_with_password": re.compile(r"postgres(?:ql)?://[^:\s]+:[^@\s]+@"),
    "password_assignment": re.compile(
        r"(?i)(?:password|passwd|secret|api_key|token)\s*[:=]\s*[\"'][^\"']{8,}[\"']"
    ),
    "email_address": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
}


def git(*args: str, text: bool = True) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=text,
    )
    if result.returncode != 0:
        message = result.stderr if text else result.stderr.decode("utf-8", "replace")
        raise RuntimeError(message.strip() or f"git {' '.join(args)} failed")
    return result.stdout if text else result.stdout.decode("utf-8", "replace")


def tracked_files() -> list[str]:
    output = git("ls-files", "-z")
    return [name for name in output.split("\0") if name]


def is_env_file(path: str) -> bool:
    name = Path(path).name.lower()
    return name == ".env" or name.startswith(".env.") or name.endswith(".env")


def scan_text(text: str, counts: dict[str, int], files: dict[str, int]) -> None:
    for name, pattern in PATTERNS.items():
        matches = pattern.findall(text)
        if matches:
            counts[name] = counts.get(name, 0) + len(matches)
            files[name] = files.get(name, 0) + 1


def scan_working_tree() -> tuple[dict[str, int], dict[str, int], int, list[str]]:
    counts: dict[str, int] = {}
    files: dict[str, int] = {}
    scanned = 0
    env_files: list[str] = []
    for path in tracked_files():
        if is_env_file(path):
            env_files.append(path)
            continue
        absolute = ROOT / path
        try:
            data = absolute.read_bytes()
        except OSError:
            continue
        if b"\0" in data[:8192]:
            continue
        scanned += 1
        scan_text(data.decode("utf-8", "ignore"), counts, files)
    return counts, files, scanned, env_files


def scan_history() -> tuple[dict[str, int], dict[str, int], int]:
    counts: dict[str, int] = {}
    files: dict[str, int] = {}
    commits = 0
    process = subprocess.Popen(
        ["git", "log", "-p", "--all", "--no-color", "--no-ext-diff"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert process.stdout is not None
    current_commit_has_match = False
    for line in process.stdout:
        if line.startswith("commit "):
            if current_commit_has_match:
                commits += 1
            current_commit_has_match = False
            continue
        for name, pattern in PATTERNS.items():
            if pattern.search(line):
                counts[name] = counts.get(name, 0) + 1
                current_commit_has_match = True
                files.setdefault(name, 0)
    if current_commit_has_match:
        commits += 1
    process.wait()
    return counts, files, commits


def ignored(path: str) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", "-q", path],
        cwd=ROOT,
        check=False,
    )
    return result.returncode == 0


def main() -> int:
    counts, files, scanned, env_files = scan_working_tree()
    history_counts, history_files, commits = scan_history()

    print("secret-pattern scan (counts only; no values printed)")
    print(f"tracked files scanned: {scanned}")
    print(f"tracked env-like files skipped (not read): {len(env_files)}")
    print(f".env ignored by git: {ignored('.env')}")
    print(f".env.local ignored by git: {ignored('.env.local')}")
    print("working tree:")
    if not counts:
        print("  no pattern matched")
    for name in PATTERNS:
        print(f"  {name}: matches={counts.get(name, 0)} files={files.get(name, 0)}")
    print("git history (git log -p --all):")
    if not history_counts:
        print("  no pattern matched")
    for name in PATTERNS:
        print(f"  {name}: matching diff lines={history_counts.get(name, 0)}")
    print(f"history commits with at least one match: {commits}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
