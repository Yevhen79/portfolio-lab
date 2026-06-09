import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import (
    create_access_token,
    hash_password,
    verify_password,
    verify_password_constant_time,
)
from app.config import settings
from app.database import get_db
from app.middleware import client_ip
from app.models import AuditLog, RegistrationLog, User, UserRole, UserStatus
from app.schemas import LoginRequest, RegisterRequest, TokenResponse
from app.schemas.auth import ChangePasswordRequest


router = APIRouter(prefix="/auth", tags=["auth"])

# httpOnly cookie that durably identifies a browser for the per-device
# registration cap. Bypassable (incognito / clearing cookies), which is why
# the per-IP cap is the hard backstop — this just raises the effort.
_DEVICE_COOKIE = "pl_device"
_DEVICE_COOKIE_MAX_AGE = 400 * 24 * 3600  # ~400 days


def _registration_anti_spam(request: Request, db: Session) -> tuple[str, str, bool]:
    """Enforce per-IP and per-device sign-up caps within the rolling window.
    Returns (ip, device_id, is_new_device). Raises 429 when a cap is hit."""
    ip = client_ip(request)
    device_id = request.cookies.get(_DEVICE_COOKIE)
    is_new_device = not device_id
    if is_new_device:
        device_id = uuid.uuid4().hex

    window_start = datetime.utcnow() - timedelta(days=settings.REG_WINDOW_DAYS)

    ip_count = int(
        db.query(func.count(RegistrationLog.id))
        .filter(RegistrationLog.ip == ip, RegistrationLog.created_at >= window_start)
        .scalar()
        or 0
    )
    if ip_count >= settings.REG_MAX_PER_IP:
        raise HTTPException(
            status_code=429,
            detail="Registration limit reached for your network. Try again later.",
        )

    if not is_new_device:
        device_count = int(
            db.query(func.count(RegistrationLog.id))
            .filter(
                RegistrationLog.device_id == device_id,
                RegistrationLog.created_at >= window_start,
            )
            .scalar()
            or 0
        )
        if device_count >= settings.REG_MAX_PER_DEVICE:
            raise HTTPException(
                status_code=429,
                detail="Registration limit reached for this device. Try again later.",
            )

    return ip, device_id, is_new_device


def _issue_token(user: User) -> str:
    """Mint an access token carrying the user's current token_version (tv)
    so it can be revoked by bumping that version."""
    return create_access_token(
        str(user.id),
        {"email": user.email, "role": user.role, "tv": int(user.token_version or 0)},
    )


@router.post("/register", response_model=TokenResponse)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    # Anti-spam caps first (cheap, and a blocked attempt must not create a row).
    ip, device_id, is_new_device = _registration_anti_spam(request, db)

    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        # Generic message — do NOT reveal whether the email is already taken
        # (account-enumeration). The legitimate user knows their own email;
        # an attacker probing addresses gets no signal.
        raise HTTPException(
            status_code=400,
            detail="Registration could not be completed. Try a different email.",
        )

    # Self-service: auto-approve (configurable) with default day/week quotas.
    auto = settings.AUTO_APPROVE_REGISTRATIONS
    user = User(
        email=payload.email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        role=UserRole.USER.value,
        status=UserStatus.APPROVED.value if auto else UserStatus.PENDING.value,
        daily_limit=settings.NEW_USER_DAILY_LIMIT,
        weekly_limit=settings.NEW_USER_WEEKLY_LIMIT,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    # Record the sign-up for the anti-spam counters + audit trail.
    db.add(RegistrationLog(ip=ip, device_id=device_id, email=payload.email))
    db.add(AuditLog(user_id=user.id, action="register", detail=f"{payload.email} ip={ip}"))
    db.commit()

    # Persist the device id so the per-device cap recognises this browser on
    # future sign-up attempts. httpOnly + Secure + SameSite=Lax.
    if is_new_device:
        response.set_cookie(
            _DEVICE_COOKIE,
            device_id,
            max_age=_DEVICE_COOKIE_MAX_AGE,
            httponly=True,
            secure=True,
            samesite="lax",
            path="/",
        )

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
