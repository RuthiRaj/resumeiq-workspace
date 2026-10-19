"""Numeric helpers that match JavaScript semantics exactly.

The F4 engine is JavaScript, and its output is the contract. Two of its
operations differ from Python's defaults, so they are reproduced here::

* ``Math.round`` rounds halves toward +Infinity, while ``round`` is banker's;
* ``Array.prototype.sort`` is stable, which :func:`sorted` already is.
"""

from __future__ import annotations

import math


def js_round(value: float) -> int:
    """``Math.round``: round half up (toward +Infinity), as JavaScript does."""
    return math.floor(value + 0.5)


def round_fixed(value: float, digits: int) -> float:
    """``Number(value.toFixed(digits))`` for the non-tie cases the engine hits."""
    return round(value, digits)
