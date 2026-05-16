"""Backtest pipeline — plan vs. fact.

Given an `as_of_date` in the past, run the normal optimisation pipeline as
if it were that date (no future leakage), then evaluate how the resulting
portfolio actually performed in the year that followed.

We share the entire optimiser code path with the live builder by
threading `as_of_date` through OptimizeRequest → portfolio_engine →
universe.assemble_returns → data_loader.fetch_yfinance. The data layer
crops every price series at the cutoff, so all downstream filters
(min history, negative mean, top-N by μ/σ) make decisions using only
information that was available on that day. This is what makes the
result honest — without the cutoff the optimiser would implicitly cheat
by trimming the universe with future knowledge.

The forward window is `[as_of_date, min(as_of_date + 12 months, today)]`.
If as_of is closer than 12 months ago, the realised window is shorter and
all annualised stats (Sharpe, vol) are computed from however many
monthly observations are available — clearly labelled as a partial year
in the response so the UI can show "X months of realised data".
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.models import Asset
from app.schemas import OptimizeRequest, OptimizeResponse
from app.schemas.backtest import (
    BacktestRequest,
    BacktestResponse,
    RealizedMetrics,
    RealizedAssetReturn,
    RealizedComparison,
)
from app.services import data_loader as dl
from app.services.portfolio_engine import build_portfolio


logger = logging.getLogger(__name__)


# Hard ceiling on the forward window. The user can choose any as-of date
# in the past, but we never look more than 12 months ahead for the
# realised side — the spec is a one-year compare.
FORWARD_MONTHS = 12


def run_backtest(db: Session, req: BacktestRequest) -> BacktestResponse:
    """Build the as-of portfolio and evaluate its one-year realised path."""
    as_of_dt = _parse_as_of(req.as_of_date)
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    if as_of_dt >= today:
        raise ValueError("as_of_date must be in the past")

    # 1. Build the "plan" using only data up to as_of (full optimiser path).
    opt_req = _to_optimize_request(req, as_of_dt)
    plan: OptimizeResponse = build_portfolio(db, opt_req)

    # 2. Forward window: from the month after as_of, up to today (or +12m).
    fwd_end_dt = min(as_of_dt + pd.DateOffset(months=FORWARD_MONTHS), today)
    realised = _compute_realized(
        db=db,
        plan=plan,
        as_of=as_of_dt,
        forward_end=fwd_end_dt,
        risk_free_annual=plan.risk_free_rate,
    )

    months_observed = realised.months_observed if realised else 0

    # 3. Side-by-side comparison block — what the optimiser predicted vs
    # what the market delivered. We surface these as %-deltas to make the
    # "plan vs fact" story obvious in the UI.
    comparison = _build_comparison(plan, realised)

    return BacktestResponse(
        as_of_date=as_of_dt.strftime("%Y-%m-%d"),
        forward_window_end=fwd_end_dt.strftime("%Y-%m-%d"),
        months_observed=months_observed,
        plan=plan,
        realized=realised,
        comparison=comparison,
    )


def _parse_as_of(s: str) -> datetime:
    try:
        return datetime.fromisoformat(s).replace(hour=0, minute=0, second=0, microsecond=0)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"as_of_date must be ISO YYYY-MM-DD, got {s!r}") from exc


def _to_optimize_request(req: BacktestRequest, as_of_dt: datetime) -> OptimizeRequest:
    """Translate BacktestRequest into the engine's OptimizeRequest."""
    data = req.model_dump()
    # BacktestRequest carries every OptimizeRequest field plus as_of_date,
    # so we can just round-trip it. Force the as_of to the parsed date in
    # ISO form so the engine sees a normalised value.
    data["as_of_date"] = as_of_dt.strftime("%Y-%m-%d")
    return OptimizeRequest(**data)


def _compute_realized(
    db: Session,
    plan: OptimizeResponse,
    as_of: datetime,
    forward_end: datetime,
    risk_free_annual: float,
) -> Optional[RealizedMetrics]:
    """Replay the picked portfolio on data from (as_of, forward_end]."""
    if not plan.weights:
        return None

    # Resolve symbol -> yf_symbol via the DB so we fetch the right series.
    syms = [w.symbol for w in plan.weights]
    rows: list[Asset] = (
        db.query(Asset).filter(Asset.symbol.in_(syms)).all()
    )
    yf_by_symbol = {a.symbol: a.yf_symbol for a in rows}
    crypto_by_symbol = {a.symbol: a.is_crypto for a in rows}

    # Build a forward-window returns DataFrame, one column per held asset.
    # We pull the FULL series (no as_of cutoff) and crop in pandas to the
    # forward bracket. Using the same data_loader keeps the cache hot.
    forward_prices: dict[str, pd.Series] = {}
    per_asset_realized: list[RealizedAssetReturn] = []
    for w in plan.weights:
        yf_sym = yf_by_symbol.get(w.symbol)
        if not yf_sym:
            continue
        interval = "1wk" if crypto_by_symbol.get(w.symbol) else "1mo"
        df = dl.fetch_yfinance(yf_sym, interval=interval, years=20)
        if df is None or df.empty:
            continue
        # Resample to month-end so weekly-crypto aligns with monthly equities.
        monthly_price = df["close"].resample("ME").last().dropna()
        # The realised window is [as_of, forward_end]. We want a return
        # that ends at forward_end and starts at the as_of price, so we
        # include the as_of-anchor row and everything up to forward_end.
        # Use the LAST month-end at or before as_of as the anchor.
        anchor_mask = monthly_price.index <= pd.Timestamp(as_of)
        if not anchor_mask.any():
            continue
        anchor_idx = monthly_price.index[anchor_mask].max()
        anchor_price = float(monthly_price.loc[anchor_idx])
        fwd_mask = (monthly_price.index > anchor_idx) & (monthly_price.index <= pd.Timestamp(forward_end))
        fwd_slice = monthly_price.loc[fwd_mask]
        if fwd_slice.empty or anchor_price <= 0:
            continue
        forward_prices[w.symbol] = pd.concat(
            [pd.Series([anchor_price], index=[anchor_idx]), fwd_slice]
        )
        # Total realised return for the asset over the window.
        final_price = float(fwd_slice.iloc[-1])
        asset_total_return = (final_price / anchor_price) - 1.0
        per_asset_realized.append(
            RealizedAssetReturn(
                symbol=w.symbol,
                name=w.name,
                weight=w.weight,
                expected_return_annual=w.expected_return_annual,
                realized_return=asset_total_return,
            )
        )

    if not forward_prices:
        return None

    # Build a monthly portfolio-return series. Each month r_t = ∑ w_i * r_i,t
    # where r_i,t = monthly pct change for asset i. We align on the union
    # of dates and skip assets that have NaN in a given month (defensible:
    # if one asset has missing data for a month, we treat its contribution
    # as zero for that month — partial coverage is rare in a 12-month
    # window and the alternative is dropping a whole month).
    prices_df = pd.DataFrame(forward_prices).sort_index()
    monthly_returns = prices_df.pct_change(fill_method=None).dropna(how="all")
    if monthly_returns.empty:
        return None

    # Re-weight to the held-asset universe and renormalise — some assets
    # may have dropped out due to delisting; we keep weights proportional
    # so the portfolio still sums to 100% of capital invested.
    held = [w for w in plan.weights if w.symbol in forward_prices]
    w_vec = np.array([w.weight for w in held], dtype=float)
    if w_vec.sum() <= 0:
        return None
    w_vec = w_vec / w_vec.sum()

    # Align the columns of monthly_returns to the same order as w_vec.
    col_order = [w.symbol for w in held]
    monthly_returns = monthly_returns.reindex(columns=col_order)
    monthly_returns = monthly_returns.fillna(0.0)  # missing month → no contribution
    port_monthly = monthly_returns.values @ w_vec  # shape (n_months,)

    months_observed = int(len(port_monthly))
    if months_observed == 0:
        return None

    # Cumulative growth path (1.0 normalised). Same convention as the
    # builder's historical_equity_curve so the UI can render a side-by-side
    # equity-line chart.
    cum_growth = np.cumprod(1.0 + port_monthly)
    equity_path = (cum_growth * float(plan.initial_capital)).tolist()
    timestamps = [str(ts.date()) for ts in monthly_returns.index]

    total_return = float(cum_growth[-1] - 1.0)
    # Annualised stats — only meaningful with ≥ 3 months. For shorter
    # windows we surface the raw total return and leave annualised None.
    if months_observed >= 3:
        mean_monthly = float(port_monthly.mean())
        std_monthly = float(port_monthly.std(ddof=1)) if months_observed >= 2 else 0.0
        return_annual = mean_monthly * 12.0
        vol_annual = std_monthly * (12 ** 0.5)
        if vol_annual > 1e-9:
            sharpe = (return_annual - risk_free_annual) / vol_annual
        else:
            sharpe = 0.0
    else:
        return_annual = None
        vol_annual = None
        sharpe = None

    # Max drawdown from the cumulative path.
    rolling_max = np.maximum.accumulate(cum_growth)
    drawdowns = (cum_growth - rolling_max) / rolling_max
    max_dd = float(drawdowns.min()) if drawdowns.size else 0.0

    # Geometric annualisation (CAGR) when the window is at least a year.
    if months_observed >= 12:
        cagr = float(cum_growth[-1] ** (12.0 / months_observed) - 1.0)
    else:
        cagr = None

    # Realised benchmark over the same window.
    bench_total_return, bench_annual = _benchmark_realized(
        as_of=as_of, forward_end=forward_end
    )

    return RealizedMetrics(
        months_observed=months_observed,
        forward_start=timestamps[0] if timestamps else "",
        forward_end=timestamps[-1] if timestamps else "",
        total_return=total_return,
        return_annual=return_annual,
        cagr_annual=cagr,
        volatility_annual=vol_annual,
        sharpe_ratio=sharpe,
        max_drawdown=max_dd,
        final_value=float(plan.initial_capital * (1.0 + total_return)),
        equity_path=equity_path,
        equity_timestamps=timestamps,
        per_asset=sorted(per_asset_realized, key=lambda x: x.weight, reverse=True),
        benchmark_total_return=bench_total_return,
        benchmark_return_annual=bench_annual,
    )


def _benchmark_realized(
    as_of: datetime, forward_end: datetime
) -> tuple[Optional[float], Optional[float]]:
    """Compute S&P 500 total return + annualised over the same window."""
    df = dl.fetch_yfinance("^GSPC", interval="1mo", years=20)
    if df is None or df.empty:
        return (None, None)
    monthly = df["close"].resample("ME").last().dropna()
    anchor_mask = monthly.index <= pd.Timestamp(as_of)
    if not anchor_mask.any():
        return (None, None)
    anchor_idx = monthly.index[anchor_mask].max()
    anchor = float(monthly.loc[anchor_idx])
    fwd_mask = (monthly.index > anchor_idx) & (monthly.index <= pd.Timestamp(forward_end))
    fwd = monthly.loc[fwd_mask]
    if fwd.empty or anchor <= 0:
        return (None, None)
    total = float(fwd.iloc[-1] / anchor - 1.0)
    n = int(len(fwd))
    annual = (total + 1.0) ** (12.0 / n) - 1.0 if n >= 3 else None
    return total, annual


def _build_comparison(
    plan: OptimizeResponse, realised: Optional[RealizedMetrics]
) -> RealizedComparison:
    """Produce the "plan vs fact" rows that the comparison table renders."""
    if realised is None:
        return RealizedComparison(rows=[])

    def _row(metric: str, planned, actual, fmt: str = "pct"):
        return {
            "metric": metric,
            "planned": planned,
            "actual": actual,
            "format": fmt,
        }

    rows = [
        _row("expected_return_annual", plan.expected_return_annual, realised.return_annual),
        _row("cagr_annual", plan.cagr_annual, realised.cagr_annual),
        _row("volatility_annual", plan.volatility_annual, realised.volatility_annual),
        _row("sharpe_ratio", plan.sharpe_ratio, realised.sharpe_ratio, fmt="ratio"),
        _row("max_drawdown", -abs(plan.max_drawdown_estimate), realised.max_drawdown),
        _row(
            "final_value",
            plan.initial_capital * (1.0 + plan.expected_return_annual),
            realised.final_value,
            fmt="usd",
        ),
    ]
    return RealizedComparison(rows=rows)
