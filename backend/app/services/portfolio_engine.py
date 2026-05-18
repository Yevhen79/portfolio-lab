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

from pathlib import Path

from app.config import settings
from app.schemas import OptimizeRequest, OptimizeResponse, AssetWeight
from app.services import data_loader as dl
from app.services import metrics as M
from app.services import monte_carlo as mc
from app.services import optimizer as opt
from app.services import universe as uni
from app.services.errors import PortfolioBuildError
from app.services.trace import BuildTrace


logger = logging.getLogger(__name__)


TRACES_DIR = Path(settings.BACKUPS_DIR).parent / "traces"


def build_portfolio(db: Session, req: OptimizeRequest) -> OptimizeResponse:
    # Apply deployment-mode caps (libertex_lite limits max_assets, cov_methods,
    # history years; personal mode passes through unchanged).
    max_assets_cap = settings.feature("max_assets", req.max_assets_in_universe)
    max_assets = min(req.max_assets_in_universe, max_assets_cap)

    allowed_cov_methods = settings.feature("cov_methods", ["sample", "ewma", "ledoit_wolf"])
    cov_method = req.cov_method if req.cov_method in allowed_cov_methods else "ledoit_wolf"

    history_cap = settings.feature("history_max_years", req.history_years)
    history_years = min(req.history_years, history_cap)

    # Parse optional as-of cutoff. Anything in the future is silently treated
    # as "no cutoff" — the engine doesn't need to validate that here because
    # the backtest endpoint enforces the past-date rule before calling us.
    as_of_dt: Optional[datetime] = None
    if req.as_of_date:
        try:
            as_of_dt = datetime.fromisoformat(req.as_of_date)
            if as_of_dt > datetime.now():
                as_of_dt = None
        except (TypeError, ValueError):
            as_of_dt = None

    # Initialise the trace collector. Every filter / optimisation step
    # appends to it; we render to a downloadable Markdown file at the end.
    trace = BuildTrace(
        request_summary={
            "Стратегия": req.portfolio_type,
            "Капитал, USD": req.initial_capital,
            "Риск-толерантность": req.risk_tolerance,
            "Target return": req.target_return,
            "Target risk": req.target_risk,
            "Окно истории, лет": history_years,
            "Мин. история, лет": req.min_history_years,
            "Метод ковариации": cov_method,
            "Long-only": req.long_only,
            "Sparsify": req.sparsify,
            "Sparsify ≥": req.sparsify_threshold,
            "Макс. вес одного актива": req.max_weight_per_asset,
            "Макс. drop от пика": (
                "выкл" if req.max_drop_from_peak_pct >= 1.0
                else f"{req.max_drop_from_peak_pct * 100:.0f}%"
            ),
            "Инструментов для анализа (cap)": max_assets,
            "Категории": req.categories or [],
            "Исключения": req.exclude_symbols or [],
            "Только MT-инструменты": "да" if req.mt_only else "нет",
            **({"As-of дата (бектест)": as_of_dt.strftime("%Y-%m-%d")} if as_of_dt else {}),
        }
    )

    # 1. Universe + returns (user-excluded symbols pulled out before estimation)
    returns, assets = uni.assemble_returns(
        db,
        history_years=history_years,
        min_history_years=req.min_history_years,
        categories=req.categories,
        max_assets=max_assets,
        exclude_symbols=req.exclude_symbols,
        trace=trace,
        as_of_date=as_of_dt,
        max_drop_from_peak_pct=req.max_drop_from_peak_pct,
        mt_only=req.mt_only,
    )
    if returns.empty or len(assets) < 5:
        raise PortfolioBuildError(
            "EMPTY_UNIVERSE",
            {
                "n_assets": len(assets),
                "min_history_years": req.min_history_years,
                "categories": req.categories or [],
                "exclude_count": len(req.exclude_symbols or []),
            },
        )

    asset_by_yf = {a.yf_symbol: a for a in assets}

    # 1b. Swap-cost adjustment (applied BEFORE μ/Σ estimation so it
    # propagates to every downstream metric automatically — Sortino, max
    # drawdown, Monte Carlo, CAGR all see post-swap returns).
    #
    # Libertex charges a daily overnight fee for CFD positions
    # (-0.0302%/day for US stocks ≈ -11% annual). When the user opts in we
    # subtract `swap_daily * 30` from every monthly return per asset. The
    # cost is already negative so adding it lowers the series. σ is
    # unaffected (subtracting a constant doesn't change std-dev), which
    # matches reality — swap is deterministic, contributes no variance.
    swap_count = 0
    swap_median_annual = 0.0
    if req.apply_swaps:
        adj_per_col: dict[str, float] = {}
        nz_costs: list[float] = []
        for col in returns.columns:
            a = asset_by_yf.get(col)
            if a is None:
                continue
            daily = float(a.swap_buy_daily or 0.0)
            if daily == 0:
                continue
            adj_per_col[col] = daily * 30.0  # 30-day month
            nz_costs.append(daily * 365 * 100)
        if adj_per_col:
            adj_series = pd.Series(adj_per_col, index=returns.columns).fillna(0.0)
            returns = returns + adj_series  # broadcast: each col gets its own constant
            swap_count = len(adj_per_col)
            swap_median_annual = float(np.median(nz_costs)) if nz_costs else 0.0
            logger.info(
                "Applied overnight-swap adjustment to %d assets "
                "(median annual cost %.2f%%, applied via returns shift).",
                swap_count, swap_median_annual,
            )

        # Re-apply the negative-mean filter on the POST-swap returns. The
        # universe-level filter ran on raw historical returns, but after
        # subtracting a hefty daily holding fee (~-11% annual for US stocks,
        # ~-25% for crypto) many previously-positive series flip to net
        # negative — and min_variance would happily pick those for being
        # "low vol". Drop them so the optimiser only sees instruments that
        # are still expected to make money AFTER swap costs.
        if swap_count > 0:
            before = set(returns.columns)
            monthly_means = returns.mean(skipna=True)
            keep_cols = monthly_means[monthly_means > 0].index
            returns = returns[keep_cols]
            dropped_post_swap = before - set(returns.columns)
            if dropped_post_swap:
                logger.info(
                    "Post-swap negative-mean filter dropped %d assets",
                    len(dropped_post_swap),
                )
                if trace is not None:
                    drop_rows = []
                    for col in dropped_post_swap:
                        a = asset_by_yf.get(col)
                        if a is None:
                            continue
                        net_annual = float(monthly_means.get(col, 0.0)) * 12.0
                        drop_rows.append((
                            a.symbol,
                            a.name or a.symbol,
                            f"после вычитания свопа (~{a.swap_buy_daily * 365 * 100:.1f}%/год) "
                            f"средняя стала {net_annual * 100:.2f}%/год - убыточный держатель",
                        ))
                    kept_now = [
                        (asset_by_yf[c].symbol, asset_by_yf[c].name or asset_by_yf[c].symbol)
                        for c in returns.columns if c in asset_by_yf
                    ]
                    trace.add_step(
                        name="Фильтр после-своповой убыточности",
                        kept=kept_now,
                        dropped=drop_rows,
                        note="Активы, у которых после вычитания overnight swap-комиссии "
                             "средняя месячная стала <= 0, выкидываются. Иначе min-variance "
                             "охотно берёт их за низкую σ, и план получается с отрицательной "
                             "доходностью.",
                    )

        if returns.shape[1] < 5:
            raise PortfolioBuildError(
                "ALL_NEGATIVE_AFTER_SWAPS",
                {
                    "n_assets": int(returns.shape[1]),
                    "swap_median_annual_pct": float(swap_median_annual),
                },
            )

    # 2. Parameter estimation (monthly) — cov_method clamped by deployment mode
    mu_m, sigma_m, columns = opt.estimate_mu_sigma(returns, method=cov_method)
    ordered_assets = [asset_by_yf[c] for c in columns]

    # 3. Risk-free rate (annual decimal). Geometric conversion to monthly:
    #    (1+rf_a)^(1/12) - 1, not the previously-used linear rf_a/12.
    rf_annual = dl.fetch_risk_free_annual()
    rf_monthly = (1.0 + rf_annual) ** (1.0 / 12.0) - 1.0

    # 4. Optimize
    weights = _select_optimizer(req, mu_m, sigma_m, rf_monthly)
    if weights is None:
        raise PortfolioBuildError("OPTIMIZATION_FAILED", {"portfolio_type": req.portfolio_type})

    # Trace: record the initial optimisation result before sparsify munches it.
    _trace_optimization(
        trace,
        "Первичная оптимизация",
        weights,
        ordered_assets,
        note=(
            f"С учётом overnight swap-комиссий (медиана {swap_median_annual:.2f}% в год, "
            f"применено к {swap_count} активам). "
            if req.apply_swaps and swap_count > 0
            else "Свопы не учитываются — оптимизация по чистым историческим доходностям."
        ) + f"Оптимизатор вернул {int((np.abs(weights) > 0.005).sum())} значимых позиций.",
    )

    # 5. Sparsify with constraint preservation
    #
    # Naively zeroing weights < threshold and renormalising would BREAK every
    # explicit constraint (target_return, target_risk) and degrade the
    # objective for the implicit ones (max_sharpe, min_variance). Instead we:
    #   1. Identify the support set S = {i : w*_i ≥ threshold}.
    #   2. Re-solve the SAME optimisation problem restricted to S (using
    #      μ_S and Σ_SS). cvxpy then guarantees the constraint inside the
    #      smaller universe — Sharpe drops only because we have fewer assets,
    #      not because the constraint is violated.
    #   3. If re-optimisation is infeasible on S (e.g. target_risk below the
    #      sub-portfolio's GMVP vol), fall back to simple zero+renormalise
    #      and accept the small constraint slip with a logged warning.
    sparsified = False
    # Adapt the user-supplied threshold to the actual diversification the
    # optimiser produced. Without this guardrail, a 5% threshold on a
    # max-Sharpe portfolio spread across 56 assets at ~1.8% each will kill
    # 52 of them, leaving only the few accidental >5% positions — typically
    # correlated FX pairs — and the iterative re-solve collapses to a single
    # asset. The portfolio Sharpe drops from ~1.5 to 0.06 even though the
    # math is "correct". We silently cap at 1/N where N is the count of
    # non-trivial (>0.5%) initial weights, so the cleanup never destroys
    # diversification the optimiser deliberately built in.
    effective_threshold = req.sparsify_threshold
    if req.sparsify and req.sparsify_threshold > 0:
        n_significant = int((np.abs(weights) > 0.005).sum())
        if n_significant > 0:
            diversification_cap = 1.0 / n_significant
            if effective_threshold > diversification_cap:
                logger.info(
                    "Sparsify threshold %.3f would destroy diversification across %d "
                    "non-trivial positions; capping at %.3f (1/n).",
                    effective_threshold, n_significant, diversification_cap,
                )
                effective_threshold = diversification_cap

    if req.sparsify and effective_threshold > 0:
        # Iterative sparsify-and-resolve. The naive single-pass approach
        # (`keep = w >= threshold; re-optimise on keep`) fails twice:
        #   (a) When the original portfolio is naturally diversified (every
        #       weight < threshold), `keep` is empty and sparsification is
        #       skipped — the user sees their 5% slider being ignored.
        #   (b) Even when (a) is dodged with a "top-K by weight" fallback,
        #       the re-optimisation on K assets ALSO produces a diversified
        #       mix where some weights again fall below the threshold.
        #
        # Both are symptoms of the same thing: pure Markowitz QP has no
        # cardinality / minimum-weight constraint. A proper fix is
        # mixed-integer (`w_i ≥ threshold OR w_i = 0`), which cvxpy can't
        # solve at this scale.
        #
        # Practical compromise: iterate. Keep + resolve, drop new sub-
        # threshold survivors, resolve again, up to MAX_ITERS rounds.
        # Empirically converges in 2–4 passes for thresholds in [0.5%, 5%].
        # We always guarantee ≥ 2 assets so the QP stays well-posed.
        MAX_ITERS = 6
        MIN_SUPPORT = 2

        for iteration in range(MAX_ITERS):
            keep_mask = weights >= effective_threshold
            n_keep = int(keep_mask.sum())

            # Case 1: nothing clears threshold — fallback to top-K by weight,
            # K = ceil(1/threshold). This is the densest portfolio
            # theoretically compatible with the threshold (equal-weight floor).
            if n_keep == 0:
                max_n = int(np.ceil(1.0 / effective_threshold))
                n_keep = max(MIN_SUPPORT, min(max_n, len(weights) - 1))
                idx = np.argsort(-weights)[:n_keep]
                keep_mask = np.zeros_like(weights, dtype=bool)
                keep_mask[idx] = True
                logger.info(
                    "Sparsify iter %d: threshold=%.3f cleared no assets; "
                    "top-%d fallback engaged.",
                    iteration, effective_threshold, n_keep,
                )

            # Case 2: every survivor clears threshold AND we already trimmed
            # at least once — converged, exit loop.
            if n_keep == len(weights):
                if iteration > 0:
                    sparsified = True
                break

            # Case 3: shrink and re-optimise on the support.
            n_keep = max(n_keep, MIN_SUPPORT)
            idx = np.where(keep_mask)[0]
            if len(idx) < MIN_SUPPORT:
                # Force top-2 fallback to keep the QP well-posed.
                idx = np.argsort(-weights)[:MIN_SUPPORT]

            mu_sub = mu_m[idx]
            sigma_sub = sigma_m[np.ix_(idx, idx)]
            sub_w = _select_optimizer(req, mu_sub, sigma_sub, rf_monthly)
            if sub_w is None:
                logger.warning(
                    "Sparsify iter %d: re-opt on %d assets infeasible for %s "
                    "@ threshold=%.3f; using naive zero-and-renormalise.",
                    iteration, len(idx), req.portfolio_type, effective_threshold,
                )
                new_w = opt.sparsify_weights(weights, threshold=effective_threshold)
                if not np.allclose(new_w, weights):
                    weights = new_w
                    sparsified = True
                break

            new_weights = np.zeros_like(weights)
            new_weights[idx] = sub_w
            # If the new support is identical AND nobody is below threshold,
            # we've converged.
            if np.allclose(new_weights, weights) and (sub_w >= effective_threshold).all():
                weights = new_weights
                sparsified = True
                break
            weights = new_weights
            sparsified = True

        below = int(((weights > 1e-9) & (weights < effective_threshold)).sum())
        if below > 0:
            logger.info(
                "Sparsify converged with %d/%d positions still below threshold "
                "%.3f — Markowitz diversification fights the floor; user gets the "
                "concentrated mix.",
                below, int((weights > 1e-9).sum()), effective_threshold,
            )

    # Trace: final allocation after sparsification.
    if sparsified:
        _trace_optimization(
            trace,
            f"После прореживания (sparsify ≥ {effective_threshold:.2%})",
            weights,
            ordered_assets,
            note=(
                f"Пользовательский порог {req.sparsify_threshold:.2%}, реально применённый "
                f"{effective_threshold:.2%}. "
                + (
                    "Порог автоматически снижен для сохранения диверсификации, "
                    "найденной max-Sharpe."
                    if effective_threshold < req.sparsify_threshold else ""
                )
            ),
        )

    # 6. Annualized portfolio metrics
    ret_a = M.portfolio_return_annual(weights, mu_m)        # arithmetic μ × 12
    vol_a = M.portfolio_vol_annual(weights, sigma_m)
    sharpe = M.sharpe_ratio_annual(weights, mu_m, sigma_m, rf_annual)
    sortino = M.sortino_ratio_annual(weights, returns, rf_annual)
    var_cvar = M.var_cvar_annual(weights, sigma_m, mu_m, alpha=0.05)
    max_dd = M.historical_max_drawdown(weights, returns)

    # Guard-rail: refuse to deliver a portfolio with non-positive expected
    # return. By construction this shouldn't happen — every survivor of
    # filter_negative_mean (and its post-swap counterpart above) has μ > 0,
    # and long-only weights summing to 1 give a convex combination of
    # positive numbers. But target_return with an infeasibly low target,
    # heavy swap costs eating into a thin positive universe, or weird
    # numerical edge cases CAN produce ret_a <= 0. In that case the
    # "optimal" portfolio is "lose money as slowly as possible" — clearly
    # not what the user wants to act on. Surface a clear error instead.
    if ret_a <= 0:
        raise PortfolioBuildError(
            "NEGATIVE_EXPECTED_RETURN",
            {
                "expected_return_annual": float(ret_a),
                "n_assets": int((np.abs(weights) > 0.005).sum()),
                "portfolio_type": req.portfolio_type,
                "apply_swaps": bool(req.apply_swaps),
                "swap_median_annual_pct": float(swap_median_annual),
            },
        )

    # Bug-fix #3: geometric (CAGR) annual return as sanity check. For
    # variance-heavy assets (VIX, levered ETFs, crypto on short history)
    # the arithmetic μ overstates expected long-run growth substantially —
    # CAGR is what a buy-and-hold investor would actually realise.
    cagr_portfolio = M.portfolio_cagr(weights, returns)
    cagr_assets = M.asset_cagr_series(returns) if settings.feature("geometric_mean", True) else {}

    # 7. Efficient frontier
    frontier = opt.efficient_frontier(mu_m, sigma_m, n_points=40, long_only=req.long_only)

    # 8. Monte Carlo (gated by deployment-mode flag; libertex_lite hides it)
    if settings.feature("monte_carlo", True):
        sim_count = settings.feature("monte_carlo_sims", settings.MONTE_CARLO_SIMULATIONS)
        sim = mc.simulate_portfolio_paths(
            weights=weights,
            mu_monthly=mu_m,
            sigma_monthly=sigma_m,
            initial_capital=req.initial_capital,
            n_months=12,
            n_simulations=sim_count,
        )
    else:
        sim = _empty_monte_carlo(req.initial_capital)

    # 9. Correlation matrix (only on non-zero weights)
    corr_mat = _correlation_dict(ordered_assets, sigma_m, weights)

    # 10. Benchmark comparison vs S&P 500
    bench = _benchmark_comparison(req.initial_capital, ret_a, vol_a, as_of_date=as_of_dt)

    # 11. Build asset weight table
    asset_weights = _build_asset_weights(
        weights=weights,
        assets=ordered_assets,
        mu_monthly=mu_m,
        sigma_monthly=sigma_m,
        initial_capital=req.initial_capital,
        cagr_by_yf=cagr_assets,
    )

    # 12. Estimation window string
    if not returns.empty:
        start = returns.index.min().strftime("%Y-%m-%d")
        end = returns.index.max().strftime("%Y-%m-%d")
    else:
        start = end = ""

    # 13. Finalise the trace with portfolio-level metrics and write to disk.
    trace.final_summary = {
        "Активов в портфеле (вес > 0.5%)": int((np.abs(weights) > 0.005).sum()),
        "Ожидаемая доходность (год)": f"{ret_a:.2%}",
        "CAGR (геометрический)": f"{cagr_portfolio:.2%}",
        "Волатильность (год)": f"{vol_a:.2%}",
        "Коэф. Шарпа": f"{sharpe:.3f}",
        "Коэф. Сортино": f"{sortino:.3f}",
        "VaR 95%": f"{var_cvar.get('var_95', 0):.2%}",
        "CVaR 95%": f"{var_cvar.get('cvar_95', 0):.2%}",
        "Историческая макс. просадка": f"{max_dd:.2%}",
        "Безрисковая ставка (^TNX)": f"{rf_annual:.2%}",
        "Окно оценки": f"{start} → {end}",
    }
    trace_id = trace.save(TRACES_DIR)

    return OptimizeResponse(
        portfolio_type=req.portfolio_type,
        initial_capital=float(req.initial_capital),
        weights=asset_weights,
        universe_size=int(returns.shape[1]),
        sparsified=bool(sparsified),
        expected_return_annual=float(ret_a),
        volatility_annual=float(vol_a),
        cagr_annual=float(cagr_portfolio),
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
        trace_id=trace_id,
    )


def _trace_optimization(
    trace: BuildTrace,
    name: str,
    weights: np.ndarray,
    ordered_assets: list,
    note: str = "",
) -> None:
    """Append an optimisation step to the trace.

    `kept` = assets with weight > 0.5% (rounded down for readability).
    `dropped` = assets in the input pool that ended up at ≤ 0.5%.
    Sorted by weight descending so the trace reads top-down.
    """
    rows = list(zip(ordered_assets, weights))
    rows.sort(key=lambda r: -float(r[1]))
    kept: list[tuple[str, str]] = []
    dropped: list[tuple[str, str, str]] = []
    for a, w in rows:
        w_f = float(w)
        sym = a.symbol or "?"
        label = a.name or sym
        if w_f > 0.005:
            kept.append((sym, f"{label} — вес {w_f:.2%}"))
        else:
            dropped.append((sym, label, f"вес после оптимизации {w_f:.2%} (< 0.5%)"))
    trace.add_step(
        name=name,
        kept=kept,
        dropped=dropped,
        note=note or f"Оптимизатор вернул {len(kept)} значимых позиций из {len(rows)} активов на входе.",
    )


def _select_optimizer(
    req: OptimizeRequest,
    mu_m: np.ndarray,
    sigma_m: np.ndarray,
    rf_monthly: float,
) -> Optional[np.ndarray]:
    """Dispatch to the right cvxpy QP based on req.portfolio_type.

    Adds the per-asset max-weight constraint (defends against degenerate
    one-asset "portfolios" at the feasibility boundary). If the constrained
    problem is infeasible we fall back to the unconstrained version with a
    logged warning — better a concentrated but valid portfolio than a 422.
    """
    pt = req.portfolio_type
    n = sigma_m.shape[0]
    # Cap can't be lower than 1/n (then `sum w = 1` is infeasible). When the
    # pool is so small that 1/n > requested cap, relax to 1/n + a hair.
    cap = req.max_weight_per_asset
    if cap is not None and cap < 1.0:
        cap = max(cap, 1.0 / n + 1e-6)

    def _run(max_w):
        if pt == "min_variance":
            return opt.optimize_min_variance(sigma_m, long_only=req.long_only, max_weight=max_w)
        if pt == "max_sharpe":
            return opt.optimize_max_sharpe(
                mu_m, sigma_m, rf_monthly=rf_monthly, long_only=req.long_only, max_weight=max_w,
            )
        if pt == "target_return":
            if req.target_return is None:
                raise PortfolioBuildError("TARGET_RETURN_REQUIRED", {})
            target_m = req.target_return / 12.0
            max_asset_ret_a = float(mu_m.max()) * 12.0
            if req.target_return > max_asset_ret_a:
                raise PortfolioBuildError(
                    "TARGET_RETURN_TOO_HIGH",
                    {"target": req.target_return, "max_available": max_asset_ret_a},
                )
            return opt.optimize_target_return(
                mu_m, sigma_m, target_m, long_only=req.long_only, max_weight=max_w,
            )
        if pt == "target_risk":
            if req.target_risk is None:
                w_min = opt.optimize_min_variance(sigma_m, long_only=req.long_only)
                vol_min_a = M.portfolio_vol_annual(w_min, sigma_m) if w_min is not None else 0.05
                std_assets = np.sqrt(np.diag(sigma_m)) * np.sqrt(12.0)
                vol_max_a = float(std_assets.max())
                target_vol_a = opt.risk_tolerance_to_target_vol(req.risk_tolerance, vol_min_a, vol_max_a)
            else:
                target_vol_a = req.target_risk
                # Sanity check: target volatility must be ≥ GMVP volatility
                w_gmvp = opt.optimize_min_variance(sigma_m, long_only=req.long_only)
                if w_gmvp is not None:
                    gmvp_vol_a = M.portfolio_vol_annual(w_gmvp, sigma_m)
                    if target_vol_a < gmvp_vol_a * 0.999:  # tiny epsilon
                        raise PortfolioBuildError(
                            "TARGET_RISK_TOO_LOW",
                            {"target": target_vol_a, "min_achievable": gmvp_vol_a},
                        )
            target_vol_m = target_vol_a / np.sqrt(12.0)
            return opt.optimize_target_risk(
                mu_m, sigma_m, target_vol_m, long_only=req.long_only, max_weight=max_w,
            )
        raise PortfolioBuildError("UNKNOWN_PORTFOLIO_TYPE", {"portfolio_type": pt})

    result = _run(cap)
    if result is None and cap is not None and cap < 1.0:
        # Constrained problem infeasible — usually means target_return /
        # target_risk is at the boundary of what's achievable WITH the cap.
        # Relax the cap and report the unconstrained solution. The user
        # still sees diversification when feasible; concentrated portfolios
        # only emerge when the targets demand them.
        logger.warning(
            "Optimizer infeasible at max_weight=%.2f for %s; falling back to unconstrained.",
            cap, pt,
        )
        result = _run(None)
    if result is None and pt == "target_return":
        raise PortfolioBuildError(
            "TARGET_RETURN_UNREACHABLE",
            {"target": req.target_return or 0.0},
        )
    if result is None and pt == "target_risk":
        raise PortfolioBuildError(
            "TARGET_RISK_UNREACHABLE",
            {"target": req.target_risk or 0.0},
        )
    return result


def _build_asset_weights(
    weights: np.ndarray,
    assets: List,
    mu_monthly: np.ndarray,
    sigma_monthly: np.ndarray,
    initial_capital: float,
    cagr_by_yf: Optional[Dict[str, float]] = None,
) -> List[AssetWeight]:
    out: List[AssetWeight] = []
    diag = np.sqrt(np.diag(sigma_monthly))
    cagr_by_yf = cagr_by_yf or {}
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
            cagr_annual=cagr_by_yf.get(a.yf_symbol),
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


def _empty_monte_carlo(initial_capital: float) -> Dict[str, Any]:
    """Stub returned when Monte Carlo is disabled by deployment mode.

    Keeps the response shape stable for the frontend; UI checks the
    `n_simulations == 0` flag to hide the chart entirely.
    """
    months = list(range(13))
    flat = [float(initial_capital)] * 13
    return {
        "n_simulations": 0,
        "n_months": 12,
        "initial_capital": float(initial_capital),
        "expected_value": float(initial_capital),
        "expected_return_pct": 0.0,
        "percentiles": {"p5": initial_capital, "p25": initial_capital,
                         "p50": initial_capital, "p75": initial_capital,
                         "p95": initial_capital},
        "var_95": 0.0,
        "cvar_95": 0.0,
        "median_path": flat, "p5_path": flat, "p25_path": flat,
        "p75_path": flat, "p95_path": flat,
        "paths_sample": [], "months": months,
    }


def _benchmark_comparison(
    initial_capital: float,
    port_ret_a: float,
    port_vol_a: float,
    as_of_date: Optional[datetime] = None,
) -> Dict[str, Any]:
    bench = dl.fetch_benchmark_returns("^GSPC", years=20, as_of_date=as_of_date)
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
