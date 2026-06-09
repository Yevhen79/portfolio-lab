"""Backtest endpoint — plan vs fact at a chosen historical date."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.deps import get_approved_user
from app.database import get_db
from app.models import User
from app.schemas.backtest import BacktestRequest, BacktestResponse
from app.services import backtest as bt
from app.services import portfolio_engine
from app.services.errors import PortfolioBuildError
from app.services.trace import set_trace_owner


logger = logging.getLogger(__name__)


router = APIRouter(prefix="/backtest", tags=["backtest"])


@router.post("", response_model=BacktestResponse)
def run(
    req: BacktestRequest,
    user: User = Depends(get_approved_user),
    db: Session = Depends(get_db),
) -> BacktestResponse:
    """Optimise as of `req.as_of_date`, then replay the result one year forward.

    The optimiser pipeline runs on the same code path as `/api/optimize`,
    but every price series is cropped at the as-of date BEFORE filters,
    so the universe trimming (min history, negative mean, top-by-Sharpe)
    is honest — no future data leaks into the "plan" side.

    The "fact" side then re-fetches the unrestricted series for each
    asset that ended up in the plan, slices `(as_of, as_of + 12 months]`,
    and reports realised return / vol / Sharpe / max-drawdown plus a
    per-asset breakdown. If `as_of + 12 months` is in the future, we cap
    the realised window at today and `months_observed` reflects that.
    """
    try:
        result = bt.run_backtest(db, req)
        plan = getattr(result, "plan", None)
        trace_id = getattr(plan, "trace_id", "") if plan else ""
        if trace_id:
            set_trace_owner(portfolio_engine.TRACES_DIR, trace_id, user.id)
        return result
    except PortfolioBuildError as exc:
        # Same shape as /api/optimize so the frontend can reuse the
        # BuildErrorCard component (EMPTY_UNIVERSE, NO_FEASIBLE_POINT, ...).
        logger.info("Backtest rejected: %s (%s)", exc.code, exc.context)
        raise HTTPException(status_code=422, detail=exc.to_dict())
    except ValueError as exc:
        # as_of validation errors land here.
        raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST", "message": str(exc)})
