from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class OptimizeRequest(BaseModel):
    portfolio_type: str = Field(description="min_variance|max_sharpe|target_return|target_risk")
    initial_capital: float = Field(default=10000.0, ge=1.0)
    risk_tolerance: str = Field(default="moderate", description="conservative|moderate|aggressive")
    target_return: Optional[float] = Field(default=None, description="annualized, e.g. 0.15 for 15%")
    target_risk: Optional[float] = Field(default=None, description="annualized vol, e.g. 0.20 for 20%")
    history_years: int = Field(default=20, ge=3, le=30)
    min_history_years: int = Field(default=6, ge=2, le=20)
    cov_method: str = Field(default="ledoit_wolf", description="ledoit_wolf|sample|ewma")
    long_only: bool = True
    sparsify: bool = True
    sparsify_threshold: float = Field(default=0.01, ge=0.0, le=0.5)
    # Per-asset hard cap on weight. Prevents the optimiser from producing
    # degenerate single-asset "portfolios" — which it otherwise will do at
    # the corners of the feasibility region (e.g. high target_risk on a
    # narrow pool). Set to 1.0 to disable; default 0.35 gives at minimum
    # ⌈1 / 0.35⌉ = 3 non-zero positions before the constraint binds.
    max_weight_per_asset: float = Field(default=0.35, ge=0.05, le=1.0)
    # When true, the optimiser subtracts the daily Libertex overnight swap
    # from each asset's expected return before optimising. This makes the
    # math reflect what the user actually keeps after holding-cost on a CFD
    # account. Σ is untouched (swap is deterministic). Default OFF — the
    # historical-only result is still useful as a reference.
    apply_swaps: bool = False
    # Hard ceiling = 2000 to leave room for catalog growth; the live Libertex
    # catalogue is ~1500. The frontend slider exposes up to 1500 + an "All"
    # quick-button. Personal-mode `FEATURE_FLAGS.max_assets` clamps the
    # effective cap further inside `build_portfolio`.
    max_assets_in_universe: int = Field(default=500, ge=10, le=2000)
    categories: Optional[List[str]] = None
    # Tickers the user wants pulled OUT of the optimisation universe (e.g.
    # close-only instruments on the broker, or assets they personally don't
    # want to hold). Matched case-insensitively against `Asset.symbol`. Empty
    # list = no exclusions. Applied AFTER category filtering but BEFORE
    # history / negative-mean filters, so it doesn't affect the rest of the
    # universe's composition.
    exclude_symbols: List[str] = Field(default_factory=list)
    # "Currently in a deep drawdown" filter — drops any asset whose latest
    # close is more than this fraction below its historical peak inside the
    # analysis window. The threshold matches the user's mental model of
    # "asset moving from bottom-left to top-right": we don't want names like
    # ENPH-2025 (last ~$100 vs peak $329 = 68% below ATH) in the universe
    # even if their average historical return is still positive. Set to 1.0
    # to disable the filter entirely. 0.60 means "drop if last/peak < 0.40".
    max_drop_from_peak_pct: float = Field(
        default=0.60,
        ge=0.0,
        le=1.0,
        description="Drop assets currently >X% below their peak. 0.60 = drop if last/peak < 0.40. Set to 1.0 to disable.",
    )
    # Optional "as-of" date (ISO YYYY-MM-DD). When provided, the optimiser
    # only sees price history up to and including this date — used by the
    # backtest path to reproduce the portfolio that would have been built
    # on a historical date without future leakage. Live optimise leaves
    # this None and the engine uses everything up to today.
    as_of_date: Optional[str] = Field(
        default=None,
        description="ISO date 'YYYY-MM-DD'; backtest mode optimises using only data up to this date",
    )


class AssetWeight(BaseModel):
    symbol: str
    name: str
    category: str
    weight: float
    amount_usd: float
    expected_return_annual: float
    volatility_annual: float
    # Geometric annual return (CAGR) — sanity-check alongside the arithmetic
    # μ that the optimiser uses internally. For variance-heavy assets (VIX,
    # crypto, levered ETFs) `cagr_annual` is much lower than `expected_return_annual`.
    cagr_annual: Optional[float] = None


class EfficientFrontierPoint(BaseModel):
    risk: float
    return_: float = Field(alias="return")
    is_selected: bool = False

    class Config:
        populate_by_name = True


class MonteCarloResult(BaseModel):
    n_simulations: int
    n_months: int
    initial_capital: float
    expected_value: float
    expected_return_pct: float
    percentiles: Dict[str, float]
    var_95: float
    cvar_95: float
    paths_sample: List[List[float]]
    months: List[int]
    median_path: List[float]
    p5_path: List[float]
    p25_path: List[float] = []
    p75_path: List[float] = []
    p95_path: List[float]


class OptimizeResponse(BaseModel):
    portfolio_type: str
    initial_capital: float
    weights: List[AssetWeight]
    universe_size: int
    sparsified: bool

    expected_return_annual: float
    volatility_annual: float
    # Geometric mean (CAGR) of the portfolio over the joint historical
    # window. The headline `expected_return_annual` is the arithmetic μ × 12
    # used by the Markowitz model. `cagr_annual` is the realised buy-and-hold
    # return; gap between the two equals the variance drag.
    cagr_annual: float = 0.0
    sharpe_ratio: float
    sortino_ratio: float
    var_95_annual: float
    cvar_95_annual: float
    max_drawdown_estimate: float
    risk_free_rate: float

    efficient_frontier: List[Dict[str, Any]]
    monte_carlo: MonteCarloResult
    correlation_matrix: Dict[str, Any]
    benchmark_comparison: Dict[str, Any]

    history_years: int
    min_history_years: int
    cov_method: str
    estimation_window_start: str
    estimation_window_end: str
    # Id of the per-run pipeline trace (Markdown file in backend/data/traces/).
    # The frontend exposes a download link so the user can post-mortem how
    # the optimiser arrived at this portfolio. Empty string if persistence
    # failed (e.g. disk-full); the optimisation itself still works.
    trace_id: str = ""


class PortfolioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=2000)
    is_public: bool = False
    optimize_request: OptimizeRequest
    optimize_result: OptimizeResponse


class PortfolioUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    is_public: Optional[bool] = None


class PortfolioOut(BaseModel):
    id: int
    user_id: int
    owner_name: str
    name: str
    portfolio_type: str
    risk_tolerance: str
    initial_capital: float
    target_return: Optional[float]
    target_risk: Optional[float]
    risk_free_rate: float

    history_years: int
    min_history_years: int
    cov_method: str

    weights: List[AssetWeight]
    universe_size: int
    sparsified: bool

    expected_return_annual: float
    volatility_annual: float
    sharpe_ratio: float
    sortino_ratio: float
    var_95_annual: float
    cvar_95_annual: float
    max_drawdown_estimate: float

    monte_carlo: Optional[Dict[str, Any]]
    efficient_frontier: Optional[List[Dict[str, Any]]]
    correlation_matrix: Optional[Dict[str, Any]]
    benchmark_comparison: Optional[Dict[str, Any]]

    is_public: bool
    notes: Optional[str]
    created_at: datetime


class PortfolioListItem(BaseModel):
    id: int
    user_id: int
    owner_name: str
    name: str
    portfolio_type: str
    initial_capital: float
    expected_return_annual: float
    volatility_annual: float
    sharpe_ratio: float
    is_public: bool
    is_mine: bool
    created_at: datetime


class PortfolioListResponse(BaseModel):
    portfolios: List[PortfolioListItem]
    total: int
