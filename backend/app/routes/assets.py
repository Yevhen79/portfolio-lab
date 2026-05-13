from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth.deps import get_approved_user
from app.database import get_db
from app.models import Asset, User
from app.services import data_loader as dl


router = APIRouter(prefix="/assets", tags=["assets"])


@router.get("")
def list_assets(_: User = Depends(get_approved_user), db: Session = Depends(get_db)):
    items = db.query(Asset).filter(Asset.is_active.is_(True)).order_by(Asset.category, Asset.symbol).all()
    return [
        {
            "id": a.id, "symbol": a.symbol, "name": a.name, "category": a.category,
            "currency": a.currency, "is_crypto": a.is_crypto, "yf_symbol": a.yf_symbol,
        }
        for a in items
    ]


@router.get("/categories")
def list_categories(_: User = Depends(get_approved_user), db: Session = Depends(get_db)):
    rows = db.query(Asset.category).distinct().all()
    cats = sorted({r[0] for r in rows if r[0]})
    return {"categories": cats}


@router.get("/{symbol}/prices")
def asset_prices(
    symbol: str,
    years: int = Query(default=20, ge=1, le=30),
    _: User = Depends(get_approved_user),
    db: Session = Depends(get_db),
):
    """Historical close prices for a single instrument, used by the price-history
    modal in the builder. We look up the Asset row to find the canonical
    `yf_symbol` (matters for FX where Asset.symbol='USDTRY' but yf wants
    'USDTRY=X') and serve cached parquet — the same source the optimiser uses,
    so the chart is consistent with what produced the weights.
    """
    sym = (symbol or "").strip().upper()
    asset = (
        db.query(Asset)
        .filter(Asset.is_active.is_(True))
        .filter(Asset.symbol.in_([sym, symbol]))
        .first()
    )
    if asset is None:
        raise HTTPException(status_code=404, detail=f"Asset {symbol!r} not found")

    # Crypto stores weekly bars; everything else monthly. We surface the raw
    # cached frequency to the client — the line chart is happy with either.
    interval = "1wk" if asset.is_crypto else "1mo"
    df = dl.fetch_yfinance(asset.yf_symbol, interval=interval, years=years)
    if df is None or df.empty:
        raise HTTPException(status_code=502, detail="No price data available")

    # Render dates as ISO strings so JSON / Plotly can use them as-is.
    points = [
        {"date": idx.strftime("%Y-%m-%d"), "close": float(row["close"])}
        for idx, row in df.iterrows()
    ]
    first = points[0]
    last = points[-1]
    n_years = max((df.index[-1] - df.index[0]).days / 365.25, 1e-6)
    total_return = (last["close"] / first["close"]) - 1.0 if first["close"] > 0 else 0.0
    cagr = (last["close"] / first["close"]) ** (1.0 / n_years) - 1.0 if first["close"] > 0 else 0.0

    return {
        "symbol": asset.symbol,
        "name": asset.name,
        "category": asset.category,
        "currency": asset.currency,
        "yf_symbol": asset.yf_symbol,
        "interval": interval,
        "years": years,
        "points": points,
        "start": first["date"],
        "end": last["date"],
        "first_close": first["close"],
        "last_close": last["close"],
        "total_return": total_return,
        "cagr": cagr,
    }
