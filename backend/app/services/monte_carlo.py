"""Monte Carlo simulation for portfolio paths.

We assume monthly returns ~ MultivariateNormal(mu_monthly, Sigma_monthly).
"""
from __future__ import annotations

from typing import Dict, List

import numpy as np


def simulate_portfolio_paths(
    weights: np.ndarray,
    mu_monthly: np.ndarray,
    sigma_monthly: np.ndarray,
    initial_capital: float,
    n_months: int = 12,
    n_simulations: int = 5000,
    seed: int | None = 42,
) -> Dict:
    rng = np.random.default_rng(seed)
    n_assets = len(weights)

    # Cholesky for correlated normal samples
    sigma_psd = (sigma_monthly + sigma_monthly.T) / 2.0
    eps = 1e-10
    while True:
        try:
            L = np.linalg.cholesky(sigma_psd + eps * np.eye(n_assets))
            break
        except np.linalg.LinAlgError:
            eps *= 10
            if eps > 1.0:
                L = np.eye(n_assets) * np.sqrt(np.diag(sigma_monthly).clip(min=1e-10))
                break

    paths = np.zeros((n_simulations, n_months + 1))
    paths[:, 0] = initial_capital

    for t in range(1, n_months + 1):
        z = rng.standard_normal((n_simulations, n_assets))
        asset_returns = mu_monthly + z @ L.T  # shape (n_sim, n_assets)
        port_returns = asset_returns @ weights
        port_returns = np.clip(port_returns, -0.95, 5.0)  # safety cap
        paths[:, t] = paths[:, t - 1] * (1.0 + port_returns)

    final_values = paths[:, -1]
    pct_5 = float(np.percentile(final_values, 5))
    pct_25 = float(np.percentile(final_values, 25))
    pct_50 = float(np.percentile(final_values, 50))
    pct_75 = float(np.percentile(final_values, 75))
    pct_95 = float(np.percentile(final_values, 95))

    expected_value = float(np.mean(final_values))
    expected_return_pct = (expected_value / initial_capital - 1.0) * 100.0

    var_95 = float(initial_capital - pct_5)
    tail = final_values[final_values <= pct_5]
    cvar_95 = float(initial_capital - (np.mean(tail) if len(tail) else pct_5))

    median_path = np.percentile(paths, 50, axis=0).tolist()
    p5_path = np.percentile(paths, 5, axis=0).tolist()
    p25_path = np.percentile(paths, 25, axis=0).tolist()
    p75_path = np.percentile(paths, 75, axis=0).tolist()
    p95_path = np.percentile(paths, 95, axis=0).tolist()

    sample_indices = rng.choice(n_simulations, size=min(50, n_simulations), replace=False)
    paths_sample: List[List[float]] = paths[sample_indices].tolist()

    return {
        "n_simulations": int(n_simulations),
        "n_months": int(n_months),
        "initial_capital": float(initial_capital),
        "expected_value": expected_value,
        "expected_return_pct": float(expected_return_pct),
        "percentiles": {
            "p5": pct_5,
            "p25": pct_25,
            "p50": pct_50,
            "p75": pct_75,
            "p95": pct_95,
        },
        "var_95": var_95,
        "cvar_95": cvar_95,
        "median_path": median_path,
        "p5_path": p5_path,
        "p25_path": p25_path,
        "p75_path": p75_path,
        "p95_path": p95_path,
        "paths_sample": paths_sample,
        "months": list(range(n_months + 1)),
    }
