"""Price data loading with parquet caching.

Primary source: yfinance (free, bulk-friendly).
Fallback: TradingView MCP via subprocess CLI (manual mode for missing tickers).

All series are aligned to month-end. Crypto is requested at weekly frequency
and then aggregated to monthly to keep the joint optimization on a single
clock — see CLAUDE-style decision documented in services docstring.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd
import yfinance as yf

from app.config import settings


logger = logging.getLogger(__name__)


CACHE_DIR = Path(settings.PRICES_CACHE_DIR)
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _cache_path(symbol: str, frequency: str) -> Path:
    safe = symbol.replace("/", "_").replace(":", "_").replace("=", "_").replace("^", "_")
    return CACHE_DIR / f"{safe}__{frequency}.parquet"


def _load_cached(path: Path, max_age_hours: int = 24) -> Optional[pd.DataFrame]:
    if not path.exists():
        return None
    age = datetime.now() - datetime.fromtimestamp(path.stat().st_mtime)
    if age > timedelta(hours=max_age_hours):
        return None
    try:
        return pd.read_parquet(path)
    except Exception as exc:
        logger.warning("Failed to read cache %s: %s", path, exc)
        return None


def _save_cache(df: pd.DataFrame, path: Path) -> None:
    try:
        df.to_parquet(path)
    except Exception as exc:
        logger.warning("Failed to save cache %s: %s", path, exc)


def fetch_yfinance(
    symbol: str,
    interval: str = "1mo",
    years: int = 20,
    use_cache: bool = True,
) -> Optional[pd.DataFrame]:
    """Download historical bars for `symbol` from Yahoo Finance.

    Returns DataFrame with a single 'close' column indexed by date.
    """
    cache_path = _cache_path(symbol, interval)
    if use_cache:
        cached = _load_cached(cache_path)
        if cached is not None and not cached.empty:
            return cached

    end = datetime.now()
    start = end - timedelta(days=years * 365)
    try:
        df = yf.download(
            symbol,
            start=start.strftime("%Y-%m-%d"),
            end=end.strftime("%Y-%m-%d"),
            interval=interval,
            progress=False,
            auto_adjust=True,
            threads=False,
        )
    except Exception as exc:
        logger.warning("yfinance failed for %s: %s", symbol, exc)
        return None
    if df is None or df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    if "Close" not in df.columns:
        return None
    out = df[["Close"]].rename(columns={"Close": "close"}).dropna()
    out.index = pd.to_datetime(out.index)
    out = out[~out.index.duplicated(keep="last")]
    _save_cache(out, cache_path)
    return out


def fetch_many(
    symbols: Iterable[str],
    interval: str = "1mo",
    years: int = 20,
    use_cache: bool = True,
) -> Dict[str, pd.DataFrame]:
    out: Dict[str, pd.DataFrame] = {}
    for sym in symbols:
        df = fetch_yfinance(sym, interval=interval, years=years, use_cache=use_cache)
        if df is not None and not df.empty:
            out[sym] = df
    return out


def to_monthly_close(df: pd.DataFrame) -> pd.DataFrame:
    """Resample a price series to month-end (last available close per month)."""
    if df.empty:
        return df
    monthly = df.resample("ME").last().dropna()
    return monthly


def compute_monthly_returns(
    prices_by_symbol: Dict[str, pd.DataFrame],
    is_crypto: Dict[str, bool] | None = None,
) -> pd.DataFrame:
    """Combine per-symbol price frames into a single returns DataFrame.

    Crypto series are resampled to monthly (their natural cadence is weekly).
    Stock/index/commodity/FX series are already monthly.
    """
    if is_crypto is None:
        is_crypto = {}
    monthly_prices: Dict[str, pd.Series] = {}
    for sym, df in prices_by_symbol.items():
        series = df["close"].copy()
        if is_crypto.get(sym, False):
            series = series.resample("ME").last()
        monthly_prices[sym] = series.dropna()

    if not monthly_prices:
        return pd.DataFrame()

    aligned = pd.DataFrame(monthly_prices)
    returns = aligned.pct_change().dropna(how="all")
    return returns


def filter_universe_by_history(
    returns: pd.DataFrame, min_history_years: int = 6
) -> pd.DataFrame:
    """Keep only assets with at least `min_history_years * 12` non-NaN months."""
    min_months = min_history_years * 12
    valid = returns.notna().sum() >= min_months
    return returns.loc[:, valid]


def filter_negative_mean(returns: pd.DataFrame) -> pd.DataFrame:
    """Drop columns whose mean monthly return is non-positive."""
    means = returns.mean(skipna=True)
    return returns.loc[:, means > 0]


def common_window(returns: pd.DataFrame) -> pd.DataFrame:
    """Crop to the longest common window across all surviving columns."""
    return returns.dropna(how="any")


def fetch_risk_free_annual() -> float:
    """Fetch the 10Y US Treasury yield (^TNX) and convert to a decimal rate.

    ^TNX is quoted in percent (e.g., 4.5 → 4.5%). We return the decimal
    fraction (0.045) and fall back to a sensible default on failure.
    """
    df = fetch_yfinance(settings.RISK_FREE_TICKER, interval="1d", years=1, use_cache=True)
    if df is None or df.empty:
        return 0.04
    last = float(df["close"].iloc[-1])
    return float(last / 100.0)


def fetch_benchmark_returns(symbol: str = "^GSPC", years: int = 20) -> Optional[pd.DataFrame]:
    df = fetch_yfinance(symbol, interval="1mo", years=years, use_cache=True)
    if df is None or df.empty:
        return None
    df = df.copy()
    df["return"] = df["close"].pct_change()
    return df.dropna()


def historical_equity_curve(
    weights: np.ndarray, returns: pd.DataFrame, initial_capital: float = 10000.0
) -> pd.DataFrame:
    if returns.empty:
        return pd.DataFrame(columns=["equity"])
    port_returns = (returns.values @ weights)
    equity = initial_capital * np.cumprod(1.0 + port_returns)
    out = pd.DataFrame({"equity": equity}, index=returns.index)
    return out
