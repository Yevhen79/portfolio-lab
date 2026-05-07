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


def load_active_assets(db: Session, categories: Optional[List[str]] = None) -> List[Asset]:
    q = db.query(Asset).filter(Asset.is_active.is_(True))
    if categories:
        q = q.filter(Asset.category.in_(categories))
    return q.all()


def assemble_returns(
    db: Session,
    history_years: int = 20,
    min_history_years: int = 6,
    categories: Optional[List[str]] = None,
    max_assets: int = 300,
) -> Tuple[pd.DataFrame, List[Asset]]:
    """Return (monthly_returns_df, list_of_assets_in_order_of_columns)."""
    assets = load_active_assets(db, categories=categories)
    if not assets:
        return pd.DataFrame(), []

    # Pull prices: monthly for non-crypto, weekly for crypto (then aggregate)
    prices_by_symbol: Dict[str, pd.DataFrame] = {}
    is_crypto_map: Dict[str, bool] = {}
    asset_by_yf: Dict[str, Asset] = {}

    for a in assets:
        interval = "1wk" if a.is_crypto else "1mo"
        df = dl.fetch_yfinance(a.yf_symbol, interval=interval, years=history_years)
        if df is None or df.empty:
            continue
        prices_by_symbol[a.yf_symbol] = df
        is_crypto_map[a.yf_symbol] = a.is_crypto
        asset_by_yf[a.yf_symbol] = a

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

    returns = dl.common_window(returns)

    # Cap universe size by the highest historical Sharpe-like metric (mu/std)
    if returns.shape[1] > max_assets:
        means = returns.mean()
        stds = returns.std().replace(0, np.nan)
        score = (means / stds).fillna(-np.inf)
        keep_cols = score.sort_values(ascending=False).head(max_assets).index
        returns = returns[keep_cols]

    ordered_assets = [asset_by_yf[col] for col in returns.columns if col in asset_by_yf]
    return returns, ordered_assets
