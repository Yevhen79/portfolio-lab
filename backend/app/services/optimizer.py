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

    `returns` -- DataFrame indexed by date, columns are assets. Each column
    can have its own start date / NaN gaps before its first valid observation.

    HYBRID estimation (the historically buggy line `returns.dropna(how='any')`
    used to throw away ~14 years of AAPL data just because some other asset
    in the universe had only 6 years):

      * μ[i]  — per-asset arithmetic mean over each column's *full* history
                (`skipna=True`). A 20-year stock contributes 20 years to its
                own μ, even when other assets in the joint frame are younger.

      * Σ     — joint estimator (sample / EWMA / Ledoit-Wolf) needs paired
                observations, so it's still computed on the longest common
                window. The cropping here cannot be avoided without resorting
                to pairwise-missing covariance (which does not guarantee PSD).

    This hybrid is the practical compromise used in most textbooks and is
    materially closer to the truth than the previous double-cropping.
    """
    columns = list(returns.columns)
    if returns.empty or len(columns) < 2:
        raise ValueError("Not enough data for estimation")

    # μ: per-asset mean using each column's own full history.
    mu = returns.mean(skipna=True).values.astype(float)

    # Σ: joint estimator on the longest common window.
    returns_common = returns.dropna(how="any")
    if returns_common.shape[0] < 12:
        # Common window shorter than 1 year → unreliable joint estimate.
        # Fall back to per-asset variance with zero correlation rather than
        # crashing — better to return a diagonal Σ than to fail.
        diag_var = returns.var(skipna=True).values.astype(float)
        sigma = np.diag(diag_var)
    else:
        if method == "sample":
            sigma = returns_common.cov().values.astype(float)
        elif method == "ewma":
            mu_common = returns_common.mean().values
            weights = np.array(
                [ewma_lambda ** i for i in range(len(returns_common) - 1, -1, -1)]
            )
            weights /= weights.sum()
            centered = returns_common.values - mu_common
            sigma = (centered.T * weights) @ centered
        else:  # ledoit_wolf default
            lw = LedoitWolf().fit(returns_common.values)
            sigma = lw.covariance_.astype(float)

    sigma = (sigma + sigma.T) / 2.0  # numerical symmetrization
    return mu, sigma, columns


def annualize(mu_monthly: np.ndarray, sigma_monthly: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    return mu_monthly * 12.0, sigma_monthly * 12.0


# ---------------------------------------------------------------------------
# Core optimizers
# ---------------------------------------------------------------------------

def _solve(problem: cp.Problem) -> bool:
    import logging
    log = logging.getLogger(__name__)
    last_err: Exception | None = None
    last_status: str | None = None
    for solver in ("CLARABEL", "ECOS", "SCS", "OSQP"):
        try:
            problem.solve(solver=solver, verbose=False)
            last_status = problem.status
            if problem.status in ("optimal", "optimal_inaccurate"):
                return True
        except Exception as exc:
            last_err = exc
            continue
    log.warning("All solvers failed. Last status=%s, last err=%s", last_status, last_err)
    return False


def _make_psd(sigma: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    sigma = (sigma + sigma.T) / 2.0
    eigvals, eigvecs = np.linalg.eigh(sigma)
    eigvals = np.clip(eigvals, eps, None)
    return (eigvecs * eigvals) @ eigvecs.T


def _apply_max_weight(w_var, constraints, max_weight: Optional[float], n: int) -> None:
    """Append the per-asset cap `w_i <= max_weight` if a meaningful cap is set.

    Skipped when `max_weight` is None or ≥ 1.0 (i.e. unconstrained) and
    when the cap would be vacuous (cap × n < 1, mathematically infeasible
    with `sum(w) = 1`). Caller's responsibility to fall back if the
    constrained problem turns out infeasible — we just record the constraint
    when it's meaningful and let cvxpy report status.
    """
    if max_weight is None or max_weight >= 1.0:
        return
    if max_weight * n < 1.0 - 1e-9:
        # cap × n < 1 means the simplex is empty under the constraint;
        # skip rather than guarantee an infeasibility report.
        return
    constraints.append(w_var <= max_weight)


def optimize_min_variance(
    sigma: np.ndarray,
    long_only: bool = True,
    max_weight: Optional[float] = None,
) -> Optional[np.ndarray]:
    n = sigma.shape[0]
    sigma_psd = _make_psd(sigma)
    w = cp.Variable(n)
    constraints = [cp.sum(w) == 1]
    if long_only:
        constraints.append(w >= 0)
    _apply_max_weight(w, constraints, max_weight, n)
    objective = cp.Minimize(cp.quad_form(w, cp.psd_wrap(sigma_psd)))
    if not _solve(cp.Problem(objective, constraints)):
        return None
    return np.asarray(w.value).flatten()


def optimize_max_sharpe(
    mu: np.ndarray,
    sigma: np.ndarray,
    rf_monthly: float = 0.0,
    long_only: bool = True,
    max_weight: Optional[float] = None,
) -> Optional[np.ndarray]:
    """Maximize (mu' w - rf) / sqrt(w' Sigma w).

    Reformulated as a quadratic program via change of variables y = w / k,
    where k is a positive scalar. Then solve:
        min y' Sigma y
        s.t. (mu - rf*1)' y == 1, y >= 0 (if long-only).
    Recover w = y / sum(y).

    Per-asset cap: w_i <= M  ⇔  y_i <= M * sum(y) since w = y/sum(y).
    """
    n = sigma.shape[0]
    sigma_psd = _make_psd(sigma)
    excess = mu - rf_monthly
    if np.all(excess <= 0):
        # all assets dominated by risk-free → fall back to min-variance
        return optimize_min_variance(sigma, long_only=long_only, max_weight=max_weight)

    y = cp.Variable(n)
    constraints = [excess @ y == 1]
    if long_only:
        constraints.append(y >= 0)
    if max_weight is not None and max_weight < 1.0 and max_weight * n >= 1.0 - 1e-9:
        # w_i <= M  →  y_i <= M * sum(y). Linear in y.
        constraints.append(y <= max_weight * cp.sum(y))
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
    max_weight: Optional[float] = None,
) -> Optional[np.ndarray]:
    n = sigma.shape[0]
    sigma_psd = _make_psd(sigma)
    w = cp.Variable(n)
    constraints = [cp.sum(w) == 1, mu @ w >= target_return_monthly]
    if long_only:
        constraints.append(w >= 0)
    _apply_max_weight(w, constraints, max_weight, n)
    objective = cp.Minimize(cp.quad_form(w, cp.psd_wrap(sigma_psd)))
    if not _solve(cp.Problem(objective, constraints)):
        return None
    return np.asarray(w.value).flatten()


def optimize_target_risk(
    mu: np.ndarray,
    sigma: np.ndarray,
    target_vol_monthly: float,
    long_only: bool = True,
    max_weight: Optional[float] = None,
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
    _apply_max_weight(w, constraints, max_weight, n)
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

    Uses two ingredients:
      1. Absolute caps so a universe with crazy crypto outliers (vol_max ≈ 200%)
         doesn't blow the moderate target up to 100%+.
      2. The GMVP volatility (`vol_min`) as the floor — we never set a target
         below what's achievable.
    """
    abs_targets = {
        "conservative": 0.10,
        "moderate": 0.18,
        "aggressive": 0.30,
    }
    target = abs_targets.get(risk_tolerance.lower(), 0.18)
    # Floor: must be ≥ GMVP vol (otherwise infeasible)
    target = max(target, vol_min * 1.001)
    # Cap: must be ≤ highest-vol single asset (above this is unreachable too)
    target = min(target, vol_max * 0.999)
    return target
