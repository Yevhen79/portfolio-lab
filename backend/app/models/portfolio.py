from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PortfolioType(str, Enum):
    MIN_VARIANCE = "min_variance"
    MAX_SHARPE = "max_sharpe"
    TARGET_RETURN = "target_return"
    TARGET_RISK = "target_risk"


class Portfolio(Base):
    __tablename__ = "portfolios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    portfolio_type: Mapped[str] = mapped_column(String(40), nullable=False)
    risk_tolerance: Mapped[str] = mapped_column(String(20), nullable=False, default="moderate")

    initial_capital: Mapped[float] = mapped_column(Float, nullable=False, default=10000.0)
    target_return: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_risk: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_free_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.04)

    history_years: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    min_history_years: Mapped[int] = mapped_column(Integer, default=6, nullable=False)
    cov_method: Mapped[str] = mapped_column(String(40), default="ledoit_wolf", nullable=False)

    weights: Mapped[dict] = mapped_column(JSON, nullable=False)
    universe_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sparsified: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    expected_return_annual: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    volatility_annual: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    sharpe_ratio: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    sortino_ratio: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    var_95_annual: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    cvar_95_annual: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    max_drawdown_estimate: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    monte_carlo: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    efficient_frontier: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    correlation_matrix: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    benchmark_comparison: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", backref="portfolios")
