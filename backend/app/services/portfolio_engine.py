"""End-to-end portfolio construction pipeline.

Glues together data loading, parameter estimation, optimization,
metric computation, Monte Carlo, and benchmark comparison.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.config import settings
from app.schemas import OptimizeRequest, OptimizeResponse, AssetWeight
from app.services import data_loader as dl
from app.services import metrics as M
from app.services import monte_carlo as mc
from app.services import optimizer as opt
from app.services import universe as uni


logger = logging.getLogger(__name__)


def build_portfolio(db: Session, req: OptimizeRequest) -> OptimizeResponse:
    # 1. Universe + returns
    returns, assets = uni.assemble_returns(
        db,
        history_years=req.history_years,
        min_history_years=req.min_history_years,
        categories=req.categories,
        max_assets=req.max_assets_in_universe,
    )
    if returns.empty or len(assets) < 5:
        raise ValueError(
            "Universe is empty after filtering. Try lowering min_history_years or "
            "broadening category filters."
        )

    # 2. Parameter estimation (monthly)
    mu_m, sigma_m, columns = opt.estimate_mu_sigma(returns, method=req.cov_method)
    asset_by_yf = {a.yf_symbol: a for a in assets}
    ordered_assets = [asset_by_yf[c] for c in columns]

    # 3. Risk-free rate (annual decimal)
    rf_annual = dl.fetch_risk_free_annual()
    rf_monthly = rf_annual / 12.0

    # 4. Optimize
    weights = _select_optimizer(req, mu_m, sigma_m, rf_monthly)
    if weights is None:
        raise ValueError("Optimization failed. Try a different portfolio_type or relax constraints.")

    # 5. Sparsify
    sparsified = False
    if req.sparsify:
        new_w = opt.sparsify_weights(weights, threshold=req.sparsify_threshold)
        if not np.allclose(new_w, weights):
            sparsified = True
            weights = new_w

    # 6. Annualized portfolio metrics
    ret_a = M.portfolio_return_annual(weights, mu_m)
    vol_a = M.portfolio_vol_annual(weights, sigma_m)
    sharpe = M.sharpe_ratio_annual(weights, mu_m, sigma_m, rf_annual)
    sortino = M.sortino_ratio_annual(weights, returns, rf_annual)
    var_cvar = M.var_cvar_annual(weights, sigma_m, mu_m, alpha=0.05)
    max_dd = M.historical_max_drawdown(weights, returns)

    # 7. Efficient frontier
    frontier = opt.efficient_frontier(mu_m, sigma_m, n_points=40, long_only=req.long_only)

    # 8. Monte Carlo
    sim = mc.simulate_portfolio_paths(
        weights=weights,
        mu_monthly=mu_m,
        sigma_monthly=sigma_m,
        initial_capital=req.initial_capital,
        n_months=12,
        n_simulations=settings.MONTE_CARLO_SIMULATIONS,
    )

    # 9. Correlation matrix (only on non-zero weights)
    corr_mat = _correlation_dict(ordered_assets, sigma_m, weights)

    # 10. Benchmark comparison vs S&P 500
    bench = _benchmark_comparison(req.initial_capital, ret_a, vol_a)

    # 11. Build asset weight table
    asset_weights = _build_asset_weights(
        weights=weights,
        assets=ordered_assets,
        mu_monthly=mu_m,
        sigma_monthly=sigma_m,
        initial_capital=req.initial_capital,
    )

    # 12. Estimation window string
    if not returns.empty:
        start = returns.index.min().strftime("%Y-%m-%d")
        end = returns.index.max().strftime("%Y-%m-%d")
    else:
        start = end = ""

    return OptimizeResponse(
        portfolio_type=req.portfolio_type,
        initial_capital=float(req.initial_capital),
        weights=asset_weights,
        universe_size=int(returns.shape[1]),
        sparsified=bool(sparsified),
        expected_return_annual=float(ret_a),
        volatility_annual=float(vol_a),
        sharpe_ratio=float(sharpe),
        sortino_ratio=float(sortino) if np.isfinite(sortino) else 0.0,
        var_95_annual=float(var_cvar["var"]),
        cvar_95_annual=float(var_cvar["cvar"]),
        max_drawdown_estimate=float(max_dd),
        risk_free_rate=float(rf_annual),
        efficient_frontier=frontier,
        monte_carlo=sim,
        correlation_matrix=corr_mat,
        benchmark_comparison=bench,
        history_years=int(req.history_years),
        min_history_years=int(req.min_history_years),
        cov_method=req.cov_method,
        estimation_window_start=start,
        estimation_window_end=end,
    )


def _select_optimizer(
    req: OptimizeRequest,
    mu_m: np.ndarray,
    sigma_m: np.ndarray,
    rf_monthly: float,
) -> Optional[np.ndarray]:
    pt = req.portfolio_type
    if pt == "min_variance":
        return opt.optimize_min_variance(sigma_m, long_only=req.long_only)
    if pt == "max_sharpe":
        return opt.optimize_max_sharpe(mu_m, sigma_m, rf_monthly=rf_monthly, long_only=req.long_only)
    if pt == "target_return":
        if req.target_return is None:
            raise ValueError("target_return is required for portfolio_type='target_return'")
        target_m = req.target_return / 12.0
        return opt.optimize_target_return(mu_m, sigma_m, target_m, long_only=req.long_only)
    if pt == "target_risk":
        if req.target_risk is None:
            # Map risk_tolerance → annual vol
            w_min = opt.optimize_min_variance(sigma_m, long_only=req.long_only)
            vol_min_a = M.portfolio_vol_annual(w_min, sigma_m) if w_min is not None else 0.05
            std_assets = np.sqrt(np.diag(sigma_m)) * np.sqrt(12.0)
            vol_max_a = float(std_assets.max())
            target_vol_a = opt.risk_tolerance_to_target_vol(req.risk_tolerance, vol_min_a, vol_max_a)
        else:
            target_vol_a = req.target_risk
        target_vol_m = target_vol_a / np.sqrt(12.0)
        return opt.optimize_target_risk(mu_m, sigma_m, target_vol_m, long_only=req.long_only)
    raise ValueError(f"Unknown portfolio_type: {pt}")


def _build_asset_weights(
    weights: np.ndarray,
    assets: List,
    mu_monthly: np.ndarray,
    sigma_monthly: np.ndarray,
    initial_capital: float,
) -> List[AssetWeight]:
    out: List[AssetWeight] = []
    diag = np.sqrt(np.diag(sigma_monthly))
    for i, w in enumerate(weights):
        if w <= 0:
            continue
        a = assets[i]
        out.append(AssetWeight(
            symbol=a.symbol,
            name=a.name,
            category=a.category,
            weight=float(w),
            amount_usd=float(w * initial_capital),
            expected_return_annual=float(mu_monthly[i] * 12.0),
            volatility_annual=float(diag[i] * np.sqrt(12.0)),
        ))
    out.sort(key=lambda x: x.weight, reverse=True)
    return out


def _correlation_dict(
    assets: List, sigma_monthly: np.ndarray, weights: np.ndarray
) -> Dict[str, Any]:
    nonzero = [(i, a) for i, (a, w) in enumerate(zip(assets, weights)) if w > 0]
    if not nonzero:
        return {"symbols": [], "matrix": []}
    idx = [i for i, _ in nonzero]
    syms = [a.symbol for _, a in nonzero]
    sub = sigma_monthly[np.ix_(idx, idx)]
    corr = M.correlation_from_covariance(sub)
    corr = np.clip(corr, -1.0, 1.0)
    return {"symbols": syms, "matrix": corr.tolist()}


def _benchmark_comparison(initial_capital: float, port_ret_a: float, port_vol_a: float) -> Dict[str, Any]:
    bench = dl.fetch_benchmark_returns("^GSPC", years=20)
    if bench is None or bench.empty:
        return {
            "available": False,
            "name": "S&P 500",
            "expected_return_annual": None,
            "volatility_annual": None,
            "expected_value_12m": None,
        }
    monthly_returns = bench["return"].dropna()
    bench_ret_a = float(monthly_returns.mean() * 12.0)
    bench_vol_a = float(monthly_returns.std() * np.sqrt(12.0))
    bench_value = float(initial_capital * (1.0 + bench_ret_a))
    return {
        "available": True,
        "name": "S&P 500 (^GSPC)",
        "expected_return_annual": bench_ret_a,
        "volatility_annual": bench_vol_a,
        "expected_value_12m": bench_value,
        "alpha_vs_benchmark": port_ret_a - bench_ret_a,
    }
