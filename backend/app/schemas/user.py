from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field


class UserOut(BaseModel):
    id: int
    email: EmailStr
    name: str
    role: str
    status: str

    class Config:
        from_attributes = True


class UserAdminOut(BaseModel):
    id: int
    email: EmailStr
    name: str
    role: str
    status: str
    daily_limit: Optional[int]
    weekly_limit: Optional[int]
    bonus_today: int
    created_at: datetime
    last_login_at: Optional[datetime]
    portfolio_count: int = 0
    today_generations: int = 0

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    daily_limit: Optional[int] = None
    weekly_limit: Optional[int] = None
    role: Optional[str] = None
    status: Optional[str] = None
    bonus_today: Optional[int] = None


class UserListResponse(BaseModel):
    users: List[UserAdminOut]
    total: int


class QuotaRequestCreate(BaseModel):
    requested_amount: int = Field(ge=1, le=100)
    reason: Optional[str] = Field(default=None, max_length=500)


class QuotaRequestOut(BaseModel):
    id: int
    user_id: int
    user_email: str
    user_name: str
    requested_amount: int
    reason: Optional[str]
    status: str
    created_at: datetime
    decided_at: Optional[datetime]


class QuotaDecision(BaseModel):
    approve: bool
