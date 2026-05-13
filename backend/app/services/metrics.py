"""Risk metrics and portfolio analytics."""
from __future__ import annotations

from typing import Dict

import numpy as np
import pandas as pd


SQRT_12 = np.sqrt(12.0)


def portfolio_return_annual(weights: np.ndarray, mu_monthly: np.ndarray) -> float:
    """Arithmetic-mean annualised return: μ_a = μ_m × 12.

    This is the quantity Markowitz uses internally (single-period model).
    For long-horizon investor expectations use `portfolio_cagr` instead —
    arithmetic mean is biased upward by variance drag.
    """
    return float(weights @ mu_monthly) * 12.0


def portfolio_vol_annual(weights: np.ndarray, sigma_monthly: np.ndarray) -> float:
    var_monthly = max(float(weights @ sigma_monthly @ weights), 0.0)
    return float(np.sqrt(var_monthly) * SQRT_12)


def cagr_from_returns(returns: np.ndarray) -> float:
    """Compound annual growth rate from a series of monthly returns.

    CAGR = ((1+r_1) × (1+r_2) × … × (1+r_n))^(12/n) − 1

    This is the *geometric* mean annual return — what a buy-and-hold
    investor would actually have realised. For high-variance assets
    (crypto, VIX, levered ETFs) CAGR is much lower than the arithmetic μ×12;
    that gap is the variance drag.
    """
    if returns.size == 0:
        return 0.0
    growth = np.prod(1.0 + returns)
    if growth <= 0:
        return -1.0  # total loss
    n = returns.size
    return float(growth ** (12.0 / n) - 1.0)


def portfolio_cagr(weights: np.ndarray, returns_df: pd.DataFrame) -> float:
    """Geometric CAGR of a portfolio using its realised historical returns.

    NaN rows (assets whose history is shorter than others) are dropped — CAGR
    is computed only over the joint window where every asset has data.
    """
    if returns_df.empty:
        return 0.0
    df = returns_df.dropna(how="any")
    if df.empty:
        return 0.0
    port_returns = df.values @ weights
    return cagr_from_returns(port_returns)


def asset_cagr_series(returns_df: pd.DataFrame) -> Dict[str, float]:
    """Per-asset CAGR over each column's own full history (no common-window crop).

    Useful for sanity-checking individual assets — e.g. VIX with arithmetic
    μ ≈ +30%/yr but CAGR ≈ −5%/yr (variance drag dominates).
    """
    out: Dict[str, float] = {}
    for col in returns_df.columns:
        s = returns_df[col].dropna()
        if len(s) > 0:
            out[col] = cagr_from_returns(s.values)
    return out


def sharpe_ratio_annual(
    weights: np.ndarray, mu_monthly: np.ndarray, sigma_monthly: np.ndarray, rf_annual: float
) -> float:
    ret_a = portfolio_return_annual(weights, mu_monthly)
    vol_a = portfolio_vol_annual(weights, sigma_monthly)
    if vol_a < 1e-9:
        return 0.0
    return (ret_a - rf_annual) / vol_a


def sortino_ratio_annual(
    weights: np.ndarray, returns_df: pd.DataFrame, rf_annual: float
) -> float:
    """Sortino ratio annualised, using the standard textbook definition.

    Standard Sortino divides by **total** observations N, treating the
    non-downside months as zero contributions to the squared sum. The earlier
    implementation divided by N_downside which inflates the denominator and
    understates the ratio by √(N_total / N_downside).

    Reference: Sortino & Price (1994); Bacon, "Practical Portfolio Performance
    Measurement and Attribution" (2nd ed.), ch. 4.
    """
    if returns_df.empty:
        return 0.0
    # Crop to the joint window so weights × returns is well-defined.
    df = returns_df.dropna(how="any")
    if df.empty:
        return 0.0
    port_returns = df.values @ weights
    n_total = port_returns.size
    rf_monthly = (1.0 + rf_annual) ** (1.0 / 12.0) - 1.0
    excess = port_returns - rf_monthly
    downside = np.where(excess < 0, excess, 0.0)
    if not (downside < 0).any():
        return float("inf")
    # Standard formula: √(Σ(downside²) / N_total), not the bugged √(mean(downside²))
    downside_dev_monthly = float(np.sqrt(np.sum(downside ** 2) / n_total))
    if downside_dev_monthly < 1e-9:
        return 0.0
    mean_excess_monthly = float(excess.mean())
    return float((mean_excess_monthly / downside_dev_monthly) * SQRT_12)


def var_cvar_annual(
    weights: np.ndarray, sigma_monthly: np.ndarray, mu_monthly: np.ndarray, alpha: float = 0.05
) -> Dict[str, float]:
    """Parametric (Gaussian) VaR and CVaR for one year, expressed as a fraction of capital."""
    mu_annual = float(weights @ mu_monthly) * 12.0
    vol_annual = portfolio_vol_annual(weights, sigma_monthly)
    z = abs(_inv_normal_cdf(alpha))
    phi = (1.0 / np.sqrt(2 * np.pi)) * np.exp(-(z ** 2) / 2.0)
    var = z * vol_annual - mu_annual
    cvar = vol_annual * (phi / alpha) - mu_annual
    return {"var": float(var), "cvar": float(cvar), "z": float(z)}


def _inv_normal_cdf(p: float) -> float:
    """Inverse of the standard normal CDF (Beasley-Springer-Moro approximation)."""
    if p <= 0 or p >= 1:
        raise ValueError("p must be in (0, 1)")
    # Coefficients for Beasley-Springer
    a = [-3.969683028665376e+01, 2.209460984245205e+02,
         -2.759285104469687e+02, 1.383577518672690e+02,
         -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02,
         -1.556989798598866e+02, 6.680131188771972e+01,
         -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01,
         -2.400758277161838e+00, -2.549732539343734e+00,
         4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01,
         2.445134137142996e+00, 3.754408661907416e+00]
    p_low = 0.02425
    p_high = 1 - p_low
    if p < p_low:
        q = np.sqrt(-2 * np.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
               ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p <= p_high:
        q = p - 0.5
        r = q * q
        return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / \
               (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
    q = np.sqrt(-2 * np.log(1 - p))
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)


def historical_max_drawdown(weights: np.ndarray, returns_df: pd.DataFrame) -> float:
    """Compute historical maximum drawdown from in-sample monthly returns.

    Requires the joint (common-window) returns frame; NaN rows are dropped.
    """
    if returns_df.empty:
        return 0.0
    df = returns_df.dropna(how="any")
    if df.empty:
        return 0.0
    port_returns = df.values @ weights
    equity = np.cumprod(1.0 + port_returns)
    peak = np.maximum.accumulate(equity)
    drawdown = (equity - peak) / peak
    return float(drawdown.min())


def correlation_from_covariance(sigma: np.ndarray) -> np.ndarray:
    std = np.sqrt(np.diag(sigma))
    std[std < 1e-12] = 1e-12
    return sigma / np.outer(std, std)
