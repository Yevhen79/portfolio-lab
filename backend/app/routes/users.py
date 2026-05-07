from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.database import get_db
from app.models import QuotaRequest, QuotaRequestStatus, User
from app.schemas import QuotaRequestCreate
from app.services import quota as Q


router = APIRouter(prefix="/me", tags=["me"])


@router.get("")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    allowed, reason, info = Q.check_can_generate(db, user)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "status": user.status,
        "quota": {**info, "can_generate": allowed, "reason": reason},
    }


@router.post("/quota-request")
def request_quota(
    payload: QuotaRequestCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="Admins have unlimited quota")
    pending = (
        db.query(QuotaRequest)
        .filter(
            QuotaRequest.user_id == user.id,
            QuotaRequest.status == QuotaRequestStatus.PENDING.value,
        )
        .first()
    )
    if pending:
        raise HTTPException(status_code=400, detail="You already have a pending quota request")

    req = QuotaRequest(
        user_id=user.id,
        requested_amount=payload.requested_amount,
        reason=payload.reason,
        status=QuotaRequestStatus.PENDING.value,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return {"id": req.id, "status": req.status}


@router.get("/quota-requests")
def my_quota_requests(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = (
        db.query(QuotaRequest)
        .filter(QuotaRequest.user_id == user.id)
        .order_by(QuotaRequest.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "requested_amount": r.requested_amount,
            "reason": r.reason,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
            "decided_at": r.decided_at.isoformat() if r.decided_at else None,
        }
        for r in items
    ]
