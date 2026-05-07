from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.deps import get_approved_user
from app.database import get_db
from app.models import AuditLog, Portfolio, User, UserRole
from app.schemas import (
    PortfolioCreate,
    PortfolioListItem,
    PortfolioListResponse,
    PortfolioOut,
    PortfolioUpdate,
)
from app.services import quota


router = APIRouter(prefix="/portfolios", tags=["portfolios"])


def _to_out(p: Portfolio, owner_name: str) -> PortfolioOut:
    return PortfolioOut(
        id=p.id,
        user_id=p.user_id,
        owner_name=owner_name,
        name=p.name,
        portfolio_type=p.portfolio_type,
        risk_tolerance=p.risk_tolerance,
        initial_capital=p.initial_capital,
        target_return=p.target_return,
        target_risk=p.target_risk,
        risk_free_rate=p.risk_free_rate,
        history_years=p.history_years,
        min_history_years=p.min_history_years,
        cov_method=p.cov_method,
        weights=p.weights or [],
        universe_size=p.universe_size,
        sparsified=p.sparsified,
        expected_return_annual=p.expected_return_annual,
        volatility_annual=p.volatility_annual,
        sharpe_ratio=p.sharpe_ratio,
        sortino_ratio=p.sortino_ratio,
        var_95_annual=p.var_95_annual,
        cvar_95_annual=p.cvar_95_annual,
        max_drawdown_estimate=p.max_drawdown_estimate,
        monte_carlo=p.monte_carlo,
        efficient_frontier=p.efficient_frontier,
        correlation_matrix=p.correlation_matrix,
        benchmark_comparison=p.benchmark_comparison,
        is_public=p.is_public,
        notes=p.notes,
        created_at=p.created_at,
    )


@router.post("", response_model=PortfolioOut)
def create_portfolio(
    payload: PortfolioCreate,
    user: User = Depends(get_approved_user),
    db: Session = Depends(get_db),
):
    allowed, reason, _ = quota.check_can_generate(db, user)
    if not allowed:
        raise HTTPException(status_code=429, detail=reason)

    res = payload.optimize_result
    req = payload.optimize_request

    p = Portfolio(
        user_id=user.id,
        name=payload.name,
        portfolio_type=res.portfolio_type,
        risk_tolerance=req.risk_tolerance,
        initial_capital=res.initial_capital,
        target_return=req.target_return,
        target_risk=req.target_risk,
        risk_free_rate=res.risk_free_rate,
        history_years=res.history_years,
        min_history_years=res.min_history_years,
        cov_method=res.cov_method,
        weights=[w.model_dump() for w in res.weights],
        universe_size=res.universe_size,
        sparsified=res.sparsified,
        expected_return_annual=res.expected_return_annual,
        volatility_annual=res.volatility_annual,
        sharpe_ratio=res.sharpe_ratio,
        sortino_ratio=res.sortino_ratio,
        var_95_annual=res.var_95_annual,
        cvar_95_annual=res.cvar_95_annual,
        max_drawdown_estimate=res.max_drawdown_estimate,
        monte_carlo=res.monte_carlo.model_dump() if hasattr(res.monte_carlo, "model_dump") else res.monte_carlo,
        efficient_frontier=res.efficient_frontier,
        correlation_matrix=res.correlation_matrix,
        benchmark_comparison=res.benchmark_comparison,
        is_public=payload.is_public,
        notes=payload.notes,
    )
    db.add(p)
    db.commit()
    db.refresh(p)

    quota.record_generation(db, user.id, p.id)
    db.add(AuditLog(user_id=user.id, action="save_portfolio", detail=f"#{p.id} {p.name}"))
    db.commit()

    return _to_out(p, user.name)


@router.get("", response_model=PortfolioListResponse)
def list_portfolios(
    user: User = Depends(get_approved_user),
    db: Session = Depends(get_db),
    show_public: bool = True,
):
    q = db.query(Portfolio, User).join(User, Portfolio.user_id == User.id)
    if user.role == UserRole.ADMIN.value:
        rows = q.order_by(Portfolio.created_at.desc()).all()
    else:
        if show_public:
            rows = q.filter(or_(Portfolio.user_id == user.id, Portfolio.is_public.is_(True))) \
                    .order_by(Portfolio.created_at.desc()).all()
        else:
            rows = q.filter(Portfolio.user_id == user.id) \
                    .order_by(Portfolio.created_at.desc()).all()

    items = []
    for p, u in rows:
        items.append(PortfolioListItem(
            id=p.id, user_id=p.user_id, owner_name=u.name, name=p.name,
            portfolio_type=p.portfolio_type, initial_capital=p.initial_capital,
            expected_return_annual=p.expected_return_annual,
            volatility_annual=p.volatility_annual, sharpe_ratio=p.sharpe_ratio,
            is_public=p.is_public, is_mine=(p.user_id == user.id),
            created_at=p.created_at,
        ))
    return PortfolioListResponse(portfolios=items, total=len(items))


@router.get("/{pid}", response_model=PortfolioOut)
def get_portfolio(pid: int, user: User = Depends(get_approved_user), db: Session = Depends(get_db)):
    p = db.get(Portfolio, pid)
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    if p.user_id != user.id and not p.is_public and user.role != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Forbidden")
    owner = db.get(User, p.user_id)
    return _to_out(p, owner.name if owner else "")


@router.patch("/{pid}", response_model=PortfolioOut)
def update_portfolio(
    pid: int,
    payload: PortfolioUpdate,
    user: User = Depends(get_approved_user),
    db: Session = Depends(get_db),
):
    p = db.get(Portfolio, pid)
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    if p.user_id != user.id and user.role != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Forbidden")
    if payload.name is not None:
        p.name = payload.name
    if payload.notes is not None:
        p.notes = payload.notes
    if payload.is_public is not None:
        p.is_public = payload.is_public
    db.commit()
    db.refresh(p)
    owner = db.get(User, p.user_id)
    return _to_out(p, owner.name if owner else "")


@router.delete("/{pid}")
def delete_portfolio(pid: int, user: User = Depends(get_approved_user), db: Session = Depends(get_db)):
    p = db.get(Portfolio, pid)
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    if p.user_id != user.id and user.role != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Forbidden")
    db.delete(p)
    db.commit()
    return {"ok": True}
