from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Pre-computed bcrypt hash of a throwaway value. The login path verifies the
# submitted password against THIS when the email doesn't exist, so the
# response time is the same whether or not the account exists — closing the
# timing side-channel that otherwise lets an attacker enumerate valid emails.
# Computed once at import (never per-request, which would itself leak timing).
_DUMMY_HASH = pwd_context.hash("timing-attack-decoy-not-a-real-password")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


def verify_password_constant_time(plain: str, hashed: Optional[str]) -> bool:
    """Verify a password, always doing a bcrypt comparison even when the
    account is absent (`hashed is None`), so timing is account-independent.
    Returns False for the decoy path."""
    if hashed is None:
        verify_password(plain, _DUMMY_HASH)
        return False
    return verify_password(plain, hashed)


def create_access_token(subject: str, extra: Optional[Dict[str, Any]] = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: Dict[str, Any] = {"sub": subject, "exp": expire}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except JWTError:
        return None
