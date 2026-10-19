"""Plain-text normalization shared by the preview and the section parser.

The same list of lines produces both the returned ``sourceText`` and every
1-based ``sourceLine`` in the review, so a flagged field can always be checked
against the exact text the user is shown (contract §2.3).
"""

from __future__ import annotations

import re
from typing import Final

_TRAILING_WHITESPACE: Final[re.Pattern[str]] = re.compile(r"[ \t]+$")


def normalize_lines(raw_text: str) -> list[str]:
    """Split to lines, strip trailing space, collapse blank runs, trim edges."""
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    lines = [_TRAILING_WHITESPACE.sub("", line) for line in text.split("\n")]

    out: list[str] = []
    blank_run = 0
    for line in lines:
        if line.strip() == "":
            blank_run += 1
            if blank_run > 1:
                continue
            out.append("")
        else:
            blank_run = 0
            out.append(line)

    while out and out[-1] == "":
        out.pop()
    while out and out[0] == "":
        out.pop(0)
    return out


def join_lines(lines: list[str]) -> str:
    """The preview text whose 1-based line numbers are the parser's indices."""
    return "\n".join(lines)
