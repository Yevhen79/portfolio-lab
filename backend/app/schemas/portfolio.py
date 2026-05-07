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
    max_assets_in_universe: int = Field(default=300, ge=10, le=1000)
    categories: Optional[List[str]] = None


class AssetWeight(BaseModel):
    symbol: str
    name: str
    category: str
    weight: float
    amount_usd: float
    expected_return_annual: float
    volatility_annual: float


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
    p95_path: List[float]


class OptimizeResponse(BaseModel):
    portfolio_type: str
    initial_capital: float
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
