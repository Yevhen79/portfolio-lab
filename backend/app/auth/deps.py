from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.security import decode_token
from app.database import get_db
from app.models import User, UserRole, UserStatus


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # Blocked accounts lose access immediately, regardless of a still-valid
    # token. (Admin block sets status=BLOCKED; without this check a blocked
    # user kept full access until their token expired.)
    if user.status == UserStatus.BLOCKED.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account blocked")

    # Token revocation: the `tv` claim must match the user's current
    # token_version. Logout / password-change bump token_version, which
    # invalidates every token issued before the bump. Tokens minted before
    # this feature shipped carry no `tv` and are treated as version 0.
    token_tv = payload.get("tv", 0)
    if int(token_tv) != int(user.token_version or 0):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")
    return user


def get_approved_user(user: User = Depends(get_current_user)) -> User:
    if user.status != UserStatus.APPROVED.value and user.role != UserRole.ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account pending approval by administrator",
        )
    return user


def get_admin_user(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user
