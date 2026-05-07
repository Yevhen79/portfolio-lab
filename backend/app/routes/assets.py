from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import get_approved_user
from app.database import get_db
from app.models import Asset, User


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
