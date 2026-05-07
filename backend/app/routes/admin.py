from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.deps import get_admin_user
from app.database import get_db
from app.models import (
    AuditLog,
    GenerationLog,
    Portfolio,
    QuotaRequest,
    QuotaRequestStatus,
    User,
    UserRole,
    UserStatus,
)
from app.schemas import QuotaDecision, UserUpdate
from app.services.libertex_parser import get_universe, save_refreshed
from app.services import quota as Q
from app.models import Asset


router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
def list_users(_: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    out = []
    for u in users:
        port_count = db.query(func.count(Portfolio.id)).filter(Portfolio.user_id == u.id).scalar() or 0
        today_used = Q.get_today_count(db, u.id)
        out.append({
            "id": u.id, "email": u.email, "name": u.name, "role": u.role, "status": u.status,
            "daily_limit": u.daily_limit, "weekly_limit": u.weekly_limit, "bonus_today": u.bonus_today,
            "created_at": u.created_at.isoformat(),
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "portfolio_count": int(port_count),
            "today_generations": int(today_used),
        })
    return {"users": out, "total": len(out)}


@router.patch("/users/{uid}")
def update_user(uid: int, payload: UserUpdate, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="Not found")
    if payload.daily_limit is not None:
        user.daily_limit = payload.daily_limit
    if payload.weekly_limit is not None:
        user.weekly_limit = payload.weekly_limit if payload.weekly_limit > 0 else None
    if payload.bonus_today is not None:
        user.bonus_today = payload.bonus_today
        user.bonus_today_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    if payload.role is not None and payload.role in {r.value for r in UserRole}:
        user.role = payload.role
    if payload.status is not None and payload.status in {s.value for s in UserStatus}:
        user.status = payload.status
    db.add(AuditLog(user_id=admin.id, action="update_user", detail=f"#{uid} {payload.model_dump_json()}"))
    db.commit()
    return {"ok": True}


@router.post("/users/{uid}/approve")
def approve_user(uid: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="Not found")
    user.status = UserStatus.APPROVED.value
    db.add(AuditLog(user_id=admin.id, action="approve_user", detail=f"#{uid}"))
    db.commit()
    return {"ok": True}


@router.post("/users/{uid}/block")
def block_user(uid: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="Not found")
    if user.role == UserRole.ADMIN.value:
        raise HTTPException(status_code=400, detail="Cannot block admin")
    user.status = UserStatus.BLOCKED.value
    db.add(AuditLog(user_id=admin.id, action="block_user", detail=f"#{uid}"))
    db.commit()
    return {"ok": True}


@router.delete("/users/{uid}")
def delete_user(uid: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="Not found")
    if user.role == UserRole.ADMIN.value:
        raise HTTPException(status_code=400, detail="Cannot delete admin")
    db.delete(user)
    db.add(AuditLog(user_id=admin.id, action="delete_user", detail=f"#{uid}"))
    db.commit()
    return {"ok": True}


@router.get("/quota-requests")
def list_quota_requests(_: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    rows = db.query(QuotaRequest, User).join(User, QuotaRequest.user_id == User.id) \
        .order_by(QuotaRequest.created_at.desc()).all()
    return [
        {
            "id": r.id, "user_id": r.user_id, "user_email": u.email, "user_name": u.name,
            "requested_amount": r.requested_amount, "reason": r.reason, "status": r.status,
            "created_at": r.created_at.isoformat(),
            "decided_at": r.decided_at.isoformat() if r.decided_at else None,
        }
        for r, u in rows
    ]


@router.post("/quota-requests/{rid}/decide")
def decide_quota_request(rid: int, payload: QuotaDecision, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    req = db.get(QuotaRequest, rid)
    if not req or req.status != QuotaRequestStatus.PENDING.value:
        raise HTTPException(status_code=404, detail="Not found or already decided")
    user = db.get(User, req.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.approve:
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        if user.bonus_today_date is None or user.bonus_today_date < today:
            user.bonus_today = req.requested_amount
        else:
            user.bonus_today = (user.bonus_today or 0) + req.requested_amount
        user.bonus_today_date = today
        req.status = QuotaRequestStatus.APPROVED.value
    else:
        req.status = QuotaRequestStatus.DENIED.value

    req.decided_by = admin.id
    req.decided_at = datetime.utcnow()
    db.add(AuditLog(user_id=admin.id, action="decide_quota", detail=f"req={rid} approve={payload.approve}"))
    db.commit()
    return {"ok": True, "status": req.status, "bonus_today": user.bonus_today}


@router.get("/notifications")
def admin_notifications(_: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    pending_users = db.query(func.count(User.id)).filter(User.status == UserStatus.PENDING.value).scalar() or 0
    pending_quota = db.query(func.count(QuotaRequest.id)).filter(
        QuotaRequest.status == QuotaRequestStatus.PENDING.value
    ).scalar() or 0
    return {"pending_users": int(pending_users), "pending_quota_requests": int(pending_quota)}


@router.post("/refresh-libertex")
def refresh_libertex(_: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    rows = get_universe()
    save_refreshed(rows)

    existing = {a.symbol: a for a in db.query(Asset).all()}
    added = updated = 0
    for r in rows:
        a = existing.get(r["symbol"])
        if a is None:
            db.add(Asset(
                symbol=r["symbol"], yf_symbol=r["yf_symbol"], tv_symbol=r.get("tv_symbol"),
                name=r["name"], category=r["category"], currency=r.get("currency", "USD"),
                is_crypto=r.get("is_crypto", False), is_active=True,
            ))
            added += 1
        else:
            a.yf_symbol = r["yf_symbol"]
            a.tv_symbol = r.get("tv_symbol")
            a.name = r["name"]
            a.category = r["category"]
            a.currency = r.get("currency", "USD")
            a.is_crypto = r.get("is_crypto", False)
            a.is_active = True
            updated += 1
    db.commit()
    return {"added": added, "updated": updated, "total": len(rows)}


@router.get("/audit-log")
def audit_log(limit: int = 100, _: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    rows = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
    return [
        {"id": r.id, "user_id": r.user_id, "action": r.action,
         "detail": r.detail, "created_at": r.created_at.isoformat()}
        for r in rows
    ]
