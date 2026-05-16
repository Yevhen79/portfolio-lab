"""Backtest schemas — plan vs realised one-year compare.

`BacktestRequest` is structurally a superset of `OptimizeRequest`: every
builder parameter passes through unchanged, plus a required `as_of_date`
that pins the "as if I had built this on date X" moment.

The response wraps the existing `OptimizeResponse` as the "plan" block
so the frontend can reuse all current result-rendering components, then
adds a `realized` block with what actually happened, and a flat
`comparison` table for the side-by-side display.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.schemas.portfolio import OptimizeRequest, OptimizeResponse


class BacktestRequest(OptimizeRequest):
    """Same shape as OptimizeRequest, but `as_of_date` is required here.

    `forward_end_date` lets the caller pick any future date (relative to
    as_of) up to today for the "fact" side. Default is the lesser of
    today and as_of + 12 months — preserving the original "year ahead"
    UX while letting power users measure realised performance over any
    horizon they care about (3 months for a tactical bet, 5 years for a
    long-term allocation, etc.).
    """
    as_of_date: str = Field(
        description="ISO 'YYYY-MM-DD'. Must be in the past — the optimiser sees data up to and including this date."
    )
    forward_end_date: Optional[str] = Field(
        default=None,
        description="ISO 'YYYY-MM-DD'. End of the realised window. Must be after as_of_date and not in the future. Defaults to min(as_of + 12 months, today).",
    )


class RealizedAssetReturn(BaseModel):
    """Per-asset realised total return over the forward window."""
    symbol: str
    name: str
    weight: float
    expected_return_annual: float  # what the optimiser predicted (annualised μ)
    realized_return: float          # actual total return over the forward window


class RealizedMetrics(BaseModel):
    """Ex-post statistics on the picked portfolio over the forward window.

    Annualised stats (return, vol, Sharpe, CAGR) are Optional because the
    forward window may be shorter than the minimum needed to annualise
    meaningfully (e.g. if the user picked as_of = 2 months ago, we only
    have 2 monthly observations — annualising would be noise).
    """
    months_observed: int
    forward_start: str  # ISO date of the first monthly bar after as_of
    forward_end: str    # ISO date of the last monthly bar in the window

    total_return: float                       # cumulative % over window
    return_annual: Optional[float] = None     # arithmetic μ × 12 (≥ 3 months)
    cagr_annual: Optional[float] = None       # geometric (≥ 12 months)
    volatility_annual: Optional[float] = None # σ × √12 (≥ 3 months)
    sharpe_ratio: Optional[float] = None      # (μ - rf) / σ annualised (≥ 3 months)
    max_drawdown: float                       # peak-to-trough on the realised path
    final_value: float                        # initial_capital × (1 + total_return)

    # Equity curve so the frontend can render the realised path.
    equity_path: List[float]
    equity_timestamps: List[str]

    per_asset: List[RealizedAssetReturn]

    # Same forward window applied to S&P 500 so the user can see whether
    # the optimiser actually beat passive over the realised period.
    benchmark_total_return: Optional[float] = None
    benchmark_return_annual: Optional[float] = None


class RealizedComparison(BaseModel):
    """Flat list of (metric, planned, actual, format) rows for the table."""
    rows: List[Dict[str, Any]]


class BacktestResponse(BaseModel):
    as_of_date: str
    forward_window_end: str
    months_observed: int

    plan: OptimizeResponse
    realized: Optional[RealizedMetrics] = None
    comparison: RealizedComparison
