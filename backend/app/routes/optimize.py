import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.deps import get_approved_user
from app.database import get_db
from app.models import User
from app.schemas import OptimizeRequest, OptimizeResponse
from app.services import portfolio_engine, quota


logger = logging.getLogger(__name__)


router = APIRouter(prefix="/optimize", tags=["optimize"])


@router.post("", response_model=OptimizeResponse)
def optimize(
    req: OptimizeRequest,
    user: User = Depends(get_approved_user),
    db: Session = Depends(get_db),
) -> OptimizeResponse:
    """Run optimization. Does NOT consume quota — only saving consumes it.

    Error handling layered so the user never sees an unexplained 500:
      * `ValueError` from `build_portfolio` (empty universe, infeasible solve)
        → 422 with the raw message.
      * Anything else → 500 with class name + message, full traceback logged.
        Without this, an exception in (say) numpy / yfinance bubbles up as a
        bare 500 with no detail, which is what surfaced to the frontend as
        "Request failed with status code 500".
    """
    try:
        return portfolio_engine.build_portfolio(db, req)
    except ValueError as exc:
        logger.warning("Optimization rejected: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Optimization crashed (%s): %s", type(exc).__name__, exc)
        raise HTTPException(
            status_code=500,
            detail=f"{type(exc).__name__}: {exc}",
        )


@router.get("/quota-status")
def quota_status(
    user: User = Depends(get_approved_user),
    db: Session = Depends(get_db),
):
    allowed, reason, info = quota.check_can_generate(db, user)
    return {"can_generate": allowed, "reason": reason, **info}
