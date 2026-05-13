# Changelog

All notable changes to Portfolio Lab.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).
Version numbers are not yet stable — the project is pre-release.

## [Unreleased] — 2026-05-12

### Added — dual-version architecture

- **Feature flags** in `backend/app/config.py`: `FEATURE_FLAGS` dict for two
  deployment modes — `personal` (full version, owner-only) and
  `libertex_lite` (B2B / partner trial). Switched via `DEPLOYMENT_MODE` env var.
- Helper `settings.feature(name, default)` for runtime gating.
- Flags currently controlled: `max_assets`, `advanced_metrics`,
  `black_litterman`, `monte_carlo`, `custom_constraints`, `broker_api`,
  `export_formats`, `cov_methods`, `geometric_mean`, `history_max_years`,
  `monte_carlo_sims`.
- Public `GET /api/config` endpoint exposes the active mode + features to the
  frontend so locked controls can be hidden.
- Frontend `useConfig` Zustand store with `feature()` helper, loaded at boot
  from `Layout`.

### Added — geometric mean (CAGR)

- New helpers in `metrics.py`: `cagr_from_returns()`, `portfolio_cagr()`,
  `asset_cagr_series()`.
- `OptimizeResponse.cagr_annual` — geometric annual return of the portfolio.
- `AssetWeight.cagr_annual` — per-asset CAGR over each asset's own history.
- UI: new metric card "CAGR (geometric)" alongside arithmetic Expected Return,
  showing `variance drag +X.X pp · $Y` underneath.
- UI: new column "CAGR" in the allocation table; arithmetic-μ cells turn
  amber when `arith − CAGR > 10 pp` (a tell-tale variance-drag asset such
  as VIX).

### Added — golden-vector test suite

- `backend/tests/test_optimizer_golden.py` — 12 tests, 3-asset textbook
  universe, closed-form analytical answers used as ground truth. Covers
  GMVP, Tangency / Max Sharpe, Target Return, Target Risk, infeasibility,
  Sharpe / vol / return formulae. Runs in ~25 s.

### Added — Libertex catalogue expansion (229 → 1480 instruments)

- `scrape_libertex.py` now iterates **all six platforms** (Libertex,
  Libertex Portfolio, MT4-Instant, MT4-Market, MT5-Instant, MT5-Market)
  instead of MT5-Market alone. Unique-by-`(group, symbol)` produces
  1531 raw instruments.
- New asset groups: **Bonds** (IEF, SHY, TLT), **Swap-Free** (Islamic-finance
  variants — iBTCUSD, iETHUSD, iXAU, iXRPUSD).
- `build_seed_from_scrape.py` upgraded:
  - Pass-through mapper for ALLCAPS exchange tickers (`STD_TICKER_RE`),
    catches ~95 % of US/EU equities without manual entries.
  - Heuristic crypto mapper (`XYZUSD` → `XYZ-USD`).
  - Pass-through ETF mapper.
  - Explicit `BOND_MAP` and `SWAP_FREE_MAP`.
- Final seed: 1480 mapped instruments (1245 stocks, 109 crypto, 50 FX,
  34 ETFs, 20 commodities, 19 indexes, 3 bonds).
- 51 skipped — mostly crypto-vs-crypto pairs (`BCHBTC`, `ETHBTC`),
  EUR-quoted crypto (`BTCEUR`), Libertex-only memecoin CFDs
  (`FARTCOINUSD`) without yfinance equivalents.

### Fixed — Bug 1: `dropna(how="any")` truncated history

- `optimizer.py:estimate_mu_sigma`: the universe was being cropped to the
  *shortest* surviving asset's history (e.g. 6 years), throwing away 14
  years of S&P-500 data for older constituents. New behaviour:
  - μ — per-asset arithmetic mean over **each column's own full history**
    (`skipna=True`).
  - Σ — joint estimator (sample / EWMA / Ledoit-Wolf) on the longest
    common window. Σ requires paired observations; μ does not.
- `universe.py`: removed redundant `common_window()` call so the wide-history
  frame reaches `estimate_mu_sigma` unmolested.
- Downstream `sortino_ratio_annual`, `historical_max_drawdown` now drop NaN
  rows internally so they receive the same wide frame safely.

### Fixed — Bug 2: Sortino divisor

- `metrics.py:sortino_ratio_annual`: previously divided by `N_downside`
  (`np.mean(downside**2)`), the textbook definition divides by `N_total`
  (`np.sum(downside²) / N_total`). The bug understated Sortino by
  `√(N_total / N_downside)` for normal-return-distribution portfolios.
- Switched `rf_monthly` conversion inside Sortino to geometric
  `(1+rf_annual)^(1/12) - 1`.

### Fixed — Bug 4: linear monthly risk-free-rate conversion

- `portfolio_engine.py`: `rf_monthly = rf_annual / 12.0` (linear, small
  positive bias) replaced with `(1 + rf_annual)**(1/12) - 1` (geometric).
  Tiny effect on Sharpe (sub-percentage point), big effect on principle.

### Fixed — UI default for `target_risk`

- `DEFAULT_REQ.target_risk` was `null`; the slider had a visual fallback
  to 20 % via `value={target_risk ?? 0.20}` but the React state stayed
  `null`. Backend then took the "auto-derive-from-risk-tolerance" branch
  and produced a 140 %-vol portfolio at "Moderate" — the user saw "20 %"
  on the slider and got bewildering numbers in the result. Default is now
  `0.20` so slider position matches state.

### Fixed — `risk_tolerance_to_target_vol` blew up with crypto universe

- Previously interpolated between GMVP-vol and max-single-asset-vol with
  factor 0.20 / 0.55 / 0.90. With PEPE-class crypto in the universe
  `vol_max ≈ 200 %` → "Moderate" implied ~110 % target — clearly wrong.
- Now uses **absolute targets**: Conservative 10 %, Moderate 18 %,
  Aggressive 30 %, clamped to `[GMVP_vol, vol_max]`.

### Fixed — Plausibility guards in `compute_monthly_returns`

- yfinance occasionally returns bad bars (e.g. NOKJPY=X with a single
  `0.13` print embedded in a 13-18 range producing a +10227 % pct change).
  We now drop any non-crypto asset whose absolute monthly return exceeds
  300 % (1500 % for crypto). Catches NOKJPY=X, AMC, GME meme-squeeze
  spikes, and APE/COMP/SHIB/TRX launch outliers.

### Fixed — sparsification was silently breaking explicit constraints

- `portfolio_engine.py`: previously the flow was `optimise → zero weights
  < threshold → renormalise`. With a 3 % threshold on a 100-asset universe
  this dropped ~91 assets and renormalised, producing a portfolio whose
  variance / return no longer matched the user's `target_risk` /
  `target_return`. Example: requesting `target_risk=20%`, sparsify@3% →
  actual vol = 21.36 % (1.36 pp over budget); Sharpe also dropped because
  the renormalised solution is no longer optimal on the smaller support.
- Fix: re-solve the same optimisation problem restricted to the support
  `S = {i : w*_i ≥ threshold}`. cvxpy then guarantees the constraint
  inside the smaller universe, exactly. Same scenario after fix:
  vol = 20.0000 % (-0.0000 pp), Sharpe 1.59 vs 1.55 before.
- Fall-back: if re-optimisation on `S` is infeasible (e.g. `target_risk`
  below GMVP-vol of the subset), revert to old zero-and-renormalise and
  log a warning. User-facing constraint slip is small in that edge case.

### Notes on math correctness

After all fixes, the same Max-Sharpe optimisation across the same universe
yields portfolios with:

- Arithmetic μ × 12 closer to realistic (no more 4000 %-return assets)
- CAGR displayed alongside μ — variance drag is now visible
- Sortino values 30-50 % higher than the buggy version (correct divisor)
- Sharpe slightly higher due to geometric rf (sub-percent)
- Universe properly uses long-history data for μ (each asset on its own
  window) and a clean joint Σ
