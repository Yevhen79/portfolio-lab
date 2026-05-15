"""High-level universe assembly: pulls assets from DB, fetches prices,
applies filters, returns a clean returns DataFrame ready for optimization.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.models import Asset
from app.services import data_loader as dl


logger = logging.getLogger(__name__)


def load_active_assets(
    db: Session,
    categories: Optional[List[str]] = None,
    exclude_symbols: Optional[List[str]] = None,
) -> List[Asset]:
    q = db.query(Asset).filter(Asset.is_active.is_(True))
    if categories:
        q = q.filter(Asset.category.in_(categories))
    assets = q.all()
    if exclude_symbols:
        # Case-insensitive set — users typing AAPL and aapl both work.
        excluded = {s.strip().upper() for s in exclude_symbols if s and s.strip()}
        if excluded:
            before = len(assets)
            assets = [a for a in assets if (a.symbol or "").upper() not in excluded]
            logger.info("Excluded %d assets from universe (%d → %d)", before - len(assets), before, len(assets))
    return assets


def assemble_returns(
    db: Session,
    history_years: int = 20,
    min_history_years: int = 6,
    categories: Optional[List[str]] = None,
    max_assets: int = 300,
    exclude_symbols: Optional[List[str]] = None,
) -> Tuple[pd.DataFrame, List[Asset]]:
    """Return (monthly_returns_df, list_of_assets_in_order_of_columns)."""
    assets = load_active_assets(db, categories=categories, exclude_symbols=exclude_symbols)
    if not assets:
        return pd.DataFrame(), []

    # Pull prices: monthly for non-crypto, weekly for crypto (then aggregate)
    prices_by_symbol: Dict[str, pd.DataFrame] = {}
    is_crypto_map: Dict[str, bool] = {}
    asset_by_yf: Dict[str, Asset] = {}

    structural_drops: list[str] = []
    for a in assets:
        interval = "1wk" if a.is_crypto else "1mo"
        df = dl.fetch_yfinance(a.yf_symbol, interval=interval, years=history_years)
        if df is None or df.empty:
            continue

        # Structural-breakage filter. Drops assets that suffered a permanent
        # impairment (regulatory destruction, fraud, post-bubble crypto, etc.)
        # and never recovered. The optimiser is otherwise math-blind to these:
        # if the pre-crash boom was strong enough, mean and Sharpe still look
        # OK over the full window, but the company / token is structurally
        # broken and no rational investor would buy it today.
        #
        # Heuristic: currently trading below 25 % of all-time high, AND that
        # high was set more than 24 months ago. A 24-month gap is enough to
        # rule out "ordinary" drawdowns (the 2020 COVID dip recovered in
        # months) and isolate genuinely-broken names like TAL (Chinese
        # ed-tech post-July-2021, –95 % in two weeks), LUNA, FTT, Wirecard,
        # etc.
        try:
            prices = df["close"].dropna()
            if len(prices) >= 24:
                max_p = float(prices.max())
                last_p = float(prices.iloc[-1])
                if max_p > 0 and last_p / max_p < 0.25:
                    max_age_days = (prices.index[-1] - prices.idxmax()).days
                    if max_age_days > 24 * 30:
                        structural_drops.append(
                            f"{a.symbol} ({last_p / max_p * 100:.0f}% of high, "
                            f"max {max_age_days // 30}mo ago)"
                        )
                        continue
        except Exception:
            # Defensive: a malformed price frame shouldn't kill the run.
            pass

        prices_by_symbol[a.yf_symbol] = df
        is_crypto_map[a.yf_symbol] = a.is_crypto
        asset_by_yf[a.yf_symbol] = a

    if structural_drops:
        logger.info(
            "Structural-breakage filter dropped %d assets: %s",
            len(structural_drops),
            ", ".join(structural_drops[:10]) + ("..." if len(structural_drops) > 10 else ""),
        )

    if not prices_by_symbol:
        return pd.DataFrame(), []

    returns = dl.compute_monthly_returns(prices_by_symbol, is_crypto=is_crypto_map)
    if returns.empty:
        return returns, []

    returns = dl.filter_universe_by_history(returns, min_history_years=min_history_years)
    if returns.empty:
        return returns, []

    returns = dl.filter_negative_mean(returns)
    if returns.empty:
        return returns, []

    # NOTE: we DO NOT call `common_window` here. Cropping to the shortest
    # asset's history throws away decades of data for older instruments —
    # the optimizer's `estimate_mu_sigma` now handles per-asset μ on full
    # history and per-pair Σ on the common window internally.

    # Cap universe size by the highest historical Sharpe-like metric (μ/σ).
    # `mean()` / `std()` handle NaN via skipna=True automatically so this
    # works on the wide-history frame too.
    if returns.shape[1] > max_assets:
        means = returns.mean()
        stds = returns.std().replace(0, np.nan)
        score = (means / stds).fillna(-np.inf)
        keep_cols = score.sort_values(ascending=False).head(max_assets).index
        returns = returns[keep_cols]

    ordered_assets = [asset_by_yf[col] for col in returns.columns if col in asset_by_yf]
    return returns, ordered_assets
