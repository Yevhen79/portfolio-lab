from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    yf_symbol: Mapped[str] = mapped_column(String(60), nullable=False)
    tv_symbol: Mapped[str | None] = mapped_column(String(80), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)

    is_crypto: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # True if any Libertex `MT4-Instant` / `MT4-Market` / `MT5-Instant`
    # row in the catalogue covers this underlying (matched by yf_symbol so
    # both the friendly-name row "Apple" AND its proper-ticker counterpart
    # "AAPL" inherit the flag). Lets the user constrain the universe to
    # instruments they can actually trade on MetaTrader, separate from the
    # ~1300 Libertex-only CFDs. Populated by `backfill_mt_flag.py`.
    is_mt: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    history_months: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_monthly_return: Mapped[float | None] = mapped_column(Float, nullable=True)
    std_monthly_return: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Libertex overnight-swap rate for LONG positions. Stored as a daily
    # decimal: -0.000302 means -0.0302% charged per calendar day held.
    # The optimiser uses this only when the user toggles "apply swaps" on;
    # the math is straightforward (μ_monthly += swap_daily * 30) and Σ is
    # untouched (swap is deterministic, doesn't add variance).
    swap_buy_daily: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    last_updated: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
