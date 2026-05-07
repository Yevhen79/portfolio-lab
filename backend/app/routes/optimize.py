from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.deps import get_approved_user
from app.database import get_db
from app.models import User
from app.schemas import OptimizeRequest, OptimizeResponse
from app.services import portfolio_engine, quota


router = APIRouter(prefix="/optimize", tags=["optimize"])


@router.post("", response_model=OptimizeResponse)
def optimize(
    req: OptimizeRequest,
    user: User = Depends(get_approved_user),
    db: Session = Depends(get_db),
) -> OptimizeResponse:
    """Run optimization. Does NOT consume quota — only saving consumes it."""
    try:
        return portfolio_engine.build_portfolio(db, req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/quota-status")
def quota_status(
    user: User = Depends(get_approved_user),
    db: Session = Depends(get_db),
):
    allowed, reason, info = quota.check_can_generate(db, user)
    return {"can_generate": allowed, "reason": reason, **info}
