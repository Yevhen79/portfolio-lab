"""Structured errors for portfolio-build infeasibility cases.

The optimiser can fail in several distinct ways and each deserves a
specific message + suggestions on what to tweak. Raising the generic
`ValueError("Target return X is above ...")` lands in the UI as a flat
English string and asks the user to parse the prose themselves.

Instead we raise `PortfolioBuildError(code, context)`. The route layer
catches it, packs it into the FastAPI HTTPException `detail` as
`{code, context}`, and the frontend has i18n keys per code that render
a friendly localised message plus a list of concrete "try this" chips.
"""
from __future__ import annotations

from typing import Any, Dict


class PortfolioBuildError(Exception):
    """Known, user-facing reason the portfolio could not be built.

    `code` is a stable identifier the frontend translates (e.g.
    `TARGET_RETURN_TOO_HIGH`). `context` is a dict of numbers the
    localised message can interpolate (e.g. {target: 0.5, max: 0.41}).
    """

    def __init__(self, code: str, context: Dict[str, Any] | None = None):
        self.code = code
        self.context = context or {}
        super().__init__(f"{code}: {self.context}")

    def to_dict(self) -> Dict[str, Any]:
        return {"code": self.code, "context": self.context}
