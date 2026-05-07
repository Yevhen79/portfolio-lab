"""Markowitz mean-variance optimizer.

All inputs/outputs operate on MONTHLY returns and covariances.
Annualization is performed by callers via metrics.py.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import cvxpy as cp
import numpy as np
import pandas as pd
from sklearn.covariance import LedoitWolf


# ---------------------------------------------------------------------------
# Estimation
# ---------------------------------------------------------------------------

def estimate_mu_sigma(
    returns: pd.DataFrame,
    method: str = "ledoit_wolf",
    ewma_lambda: float = 0.94,
) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """Estimate the mean vector and covariance matrix from monthly returns.

    `returns` -- DataFrame indexed by date, columns are assets.
    """
    returns = returns.dropna(how="any")
    columns = list(returns.columns)
    if returns.empty or len(columns) < 2:
        raise ValueError("Not enough data for estimation")

    mu = returns.mean().values.astype(float)

    if method == "sample":
        sigma = returns.cov().values.astype(float)
    elif method == "ewma":
        weights = np.array([ewma_lambda ** i for i in range(len(returns) - 1, -1, -1)])
        weights /= weights.sum()
        centered = returns.values - mu
        sigma = (centered.T * weights) @ centered
    else:  # ledoit_wolf default
        lw = LedoitWolf().fit(returns.values)
        sigma = lw.covariance_.astype(float)

    sigma = (sigma + sigma.T) / 2.0  # numerical symmetrization
    return mu, sigma, columns


def annualize(mu_monthly: np.ndarray, sigma_monthly: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    return mu_monthly * 12.0, sigma_monthly * 12.0


# ---------------------------------------------------------------------------
# Core optimizers
# ---------------------------------------------------------------------------

def _solve(problem: cp.Problem) -> bool:
    for solver in ("CLARABEL", "ECOS", "SCS", "OSQP"):
        try:
            problem.solve(solver=solver, verbose=False)
            if problem.status in ("optimal", "optimal_inaccurate"):
                return True
        except Exception:
            continue
    return False


def _make_psd(sigma: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    sigma = (sigma + sigma.T) / 2.0
    eigvals, eigvecs = np.linalg.eigh(sigma)
    eigvals = np.clip(eigvals, eps, None)
    return (eigvecs * eigvals) @ eigvecs.T


def optimize_min_variance(sigma: np.ndarray, long_only: bool = True) -> Optional[np.ndarray]:
    n = sigma.shape[0]
    sigma_psd = _make_psd(sigma)
    w = cp.Variable(n)
    constraints = [cp.sum(w) == 1]
    if long_only:
        constraints.append(w >= 0)
    objective = cp.Minimize(cp.quad_form(w, cp.psd_wrap(sigma_psd)))
    if not _solve(cp.Problem(objective, constraints)):
        return None
    return np.asarray(w.value).flatten()


def optimize_max_sharpe(
    mu: np.ndarray,
    sigma: np.ndarray,
    rf_monthly: float = 0.0,
    long_only: bool = True,
) -> Optional[np.ndarray]:
    """Maximize (mu' w - rf) / sqrt(w' Sigma w).

    Reformulated as a quadratic program via change of variables y = w / k,
    where k is a positive scalar. Then solve:
        min y' Sigma y
        s.t. (mu - rf*1)' y == 1, y >= 0 (if long-only).
    Recover w = y / sum(y).
    """
    n = sigma.shape[0]
    sigma_psd = _make_psd(sigma)
    excess = mu - rf_monthly
    if np.all(excess <= 0):
        # all assets dominated by risk-free → fall back to min-variance
        return optimize_min_variance(sigma, long_only=long_only)

    y = cp.Variable(n)
    constraints = [excess @ y == 1]
    if long_only:
        constraints.append(y >= 0)
    objective = cp.Minimize(cp.quad_form(y, cp.psd_wrap(sigma_psd)))
    if not _solve(cp.Problem(objective, constraints)):
        return None
    val = np.asarray(y.value).flatten()
    s = val.sum()
    if s <= 0:
        return None
    return val / s


def optimize_target_return(
    mu: np.ndarray,
    sigma: np.ndarray,
    target_return_monthly: float,
    long_only: bool = True,
) -> Optional[np.ndarray]:
    n = sigma.shape[0]
    sigma_psd = _make_psd(sigma)
    w = cp.Variable(n)
    constraints = [cp.sum(w) == 1, mu @ w >= target_return_monthly]
    if long_only:
        constraints.append(w >= 0)
    objective = cp.Minimize(cp.quad_form(w, cp.psd_wrap(sigma_psd)))
    if not _solve(cp.Problem(objective, constraints)):
        return None
    return np.asarray(w.value).flatten()


def optimize_target_risk(
    mu: np.ndarray,
    sigma: np.ndarray,
    target_vol_monthly: float,
    long_only: bool = True,
) -> Optional[np.ndarray]:
    n = sigma.shape[0]
    sigma_psd = _make_psd(sigma)
    w = cp.Variable(n)
    constraints = [
        cp.sum(w) == 1,
        cp.quad_form(w, cp.psd_wrap(sigma_psd)) <= target_vol_monthly ** 2,
    ]
    if long_only:
        constraints.append(w >= 0)
    objective = cp.Maximize(mu @ w)
    if not _solve(cp.Problem(objective, constraints)):
        return None
    return np.asarray(w.value).flatten()


# ---------------------------------------------------------------------------
# Efficient frontier
# ---------------------------------------------------------------------------

def efficient_frontier(
    mu: np.ndarray,
    sigma: np.ndarray,
    n_points: int = 40,
    long_only: bool = True,
) -> List[Dict[str, float]]:
    w_min = optimize_min_variance(sigma, long_only=long_only)
    if w_min is None:
        return []
    ret_min = float(mu @ w_min)
    ret_max = float(mu.max())
    if ret_max <= ret_min:
        ret_max = ret_min + abs(ret_min) * 0.5 + 1e-4

    targets = np.linspace(ret_min, ret_max, n_points)
    points: List[Dict[str, float]] = []
    for tr in targets:
        w = optimize_target_return(mu, sigma, float(tr), long_only=long_only)
        if w is None:
            continue
        actual_ret = float(mu @ w)
        actual_vol = float(np.sqrt(max(w @ sigma @ w, 0.0)))
        points.append({
            "return_monthly": actual_ret,
            "risk_monthly": actual_vol,
            "return_annual": actual_ret * 12.0,
            "risk_annual": actual_vol * np.sqrt(12.0),
        })
    return points


# ---------------------------------------------------------------------------
# Sparsification
# ---------------------------------------------------------------------------

def sparsify_weights(
    weights: np.ndarray,
    threshold: float = 0.01,
) -> np.ndarray:
    """Zero out weights below threshold and renormalize."""
    w = weights.copy()
    w[w < threshold] = 0.0
    total = w.sum()
    if total <= 0:
        return weights
    return w / total


# ---------------------------------------------------------------------------
# Risk tolerance → target params
# ---------------------------------------------------------------------------

def risk_tolerance_to_target_vol(risk_tolerance: str, vol_min: float, vol_max: float) -> float:
    """Map a categorical risk tolerance to a target annual volatility.

    `vol_min` is the minimum-variance portfolio's annual vol;
    `vol_max` is the volatility of the highest-mean asset.
    """
    rng = max(vol_max - vol_min, 1e-6)
    factor_map = {
        "conservative": 0.20,
        "moderate": 0.55,
        "aggressive": 0.90,
    }
    factor = factor_map.get(risk_tolerance.lower(), 0.55)
    return vol_min + factor * rng
