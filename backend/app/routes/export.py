from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth.deps import get_approved_user
from app.database import get_db
from app.models import Portfolio, User, UserRole
from app.services.exporter import export_excel, export_pdf


router = APIRouter(prefix="/export", tags=["export"])


def _check_access(p: Portfolio, user: User) -> None:
    if p.user_id != user.id and not p.is_public and user.role != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.get("/portfolio/{pid}/excel")
def excel(pid: int, user: User = Depends(get_approved_user), db: Session = Depends(get_db)):
    p = db.get(Portfolio, pid)
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    _check_access(p, user)
    blob = export_excel(p)
    return Response(
        content=blob,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=portfolio_{pid}.xlsx"},
    )


@router.get("/portfolio/{pid}/pdf")
def pdf(pid: int, user: User = Depends(get_approved_user), db: Session = Depends(get_db)):
    p = db.get(Portfolio, pid)
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    _check_access(p, user)
    blob = export_pdf(p)
    return Response(
        content=blob,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=portfolio_{pid}.pdf"},
    )
