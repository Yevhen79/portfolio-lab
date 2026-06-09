from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import (
    create_access_token,
    hash_password,
    verify_password,
    verify_password_constant_time,
)
from app.database import get_db
from app.models import AuditLog, User, UserRole, UserStatus
from app.schemas import LoginRequest, RegisterRequest, TokenResponse
from app.schemas.auth import ChangePasswordRequest


router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_token(user: User) -> str:
    """Mint an access token carrying the user's current token_version (tv)
    so it can be revoked by bumping that version."""
    return create_access_token(
        str(user.id),
        {"email": user.email, "role": user.role, "tv": int(user.token_version or 0)},
    )


@router.post("/register", response_model=TokenResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        # Generic message — do NOT reveal whether the email is already taken
        # (account-enumeration). The legitimate user knows their own email;
        # an attacker probing addresses gets no signal.
        raise HTTPException(
            status_code=400,
            detail="Registration could not be completed. Try a different email.",
        )

    user = User(
        email=payload.email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        role=UserRole.USER.value,
        status=UserStatus.PENDING.value,
        daily_limit=5,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.add(AuditLog(user_id=user.id, action="register", detail=payload.email))
    db.commit()

    # Pending users get a token so the UI can show the "awaiting approval"
    # state and let them hit /me; every sensitive endpoint is gated by
    # get_approved_user, so the token grants nothing actionable until an
    # admin approves them.
    token = _issue_token(user)
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        status=user.status,
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.email == payload.email).first()
    # Constant-time verify: runs a bcrypt comparison even when the account
    # is absent, so response timing doesn't leak whether the email exists.
    ok = verify_password_constant_time(payload.password, user.password_hash if user else None)
    if not user or not ok:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active or user.status == UserStatus.BLOCKED.value:
        # Generic 403 — same wording whether disabled or blocked.
        raise HTTPException(status_code=403, detail="Account is not active")
    user.last_login_at = datetime.utcnow()
    db.add(AuditLog(user_id=user.id, action="login"))
    db.commit()
    token = _issue_token(user)
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        status=user.status,
    )


@router.post("/logout")
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Revoke every outstanding token for the caller by bumping token_version.
    The current token (and any other device's) stops validating immediately."""
    user.token_version = int(user.token_version or 0) + 1
    db.add(AuditLog(user_id=user.id, action="logout"))
    db.commit()
    return {"ok": True}


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change the caller's password. Requires the current password, enforces
    the same strength policy as registration, and bumps token_version so all
    existing sessions (including any stolen token) are invalidated."""
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    user.token_version = int(user.token_version or 0) + 1
    db.add(AuditLog(user_id=user.id, action="change_password"))
    db.commit()
    db.refresh(user)
    # Issue a fresh token so the caller stays logged in on this device.
    return {"ok": True, "access_token": _issue_token(user)}
