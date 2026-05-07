"""Quota enforcement: per-user generation limits with daily/weekly windows."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import GenerationLog, User, UserRole


def _utc_today_start() -> datetime:
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, now.day, tzinfo=timezone.utc)


def _utc_week_start() -> datetime:
    today_start = _utc_today_start()
    # Monday as week start
    return today_start - timedelta(days=today_start.weekday())


def get_today_count(db: Session, user_id: int) -> int:
    start = _utc_today_start().replace(tzinfo=None)
    return int(
        db.query(func.count(GenerationLog.id))
        .filter(GenerationLog.user_id == user_id, GenerationLog.created_at >= start)
        .scalar()
        or 0
    )


def get_week_count(db: Session, user_id: int) -> int:
    start = _utc_week_start().replace(tzinfo=None)
    return int(
        db.query(func.count(GenerationLog.id))
        .filter(GenerationLog.user_id == user_id, GenerationLog.created_at >= start)
        .scalar()
        or 0
    )


def _refresh_bonus_if_new_day(db: Session, user: User) -> None:
    today = _utc_today_start().replace(tzinfo=None)
    if user.bonus_today_date is None or user.bonus_today_date < today:
        user.bonus_today = 0
        user.bonus_today_date = today
        db.commit()


def check_can_generate(db: Session, user: User) -> Tuple[bool, str, dict]:
    """Returns (allowed, reason, info_dict)."""
    if user.role == UserRole.ADMIN.value:
        return True, "admin-unlimited", {
            "today_used": get_today_count(db, user.id),
            "today_limit": None,
            "week_used": get_week_count(db, user.id),
            "week_limit": None,
            "bonus_today": 0,
        }

    _refresh_bonus_if_new_day(db, user)

    today_used = get_today_count(db, user.id)
    week_used = get_week_count(db, user.id)
    daily_limit = user.daily_limit if user.daily_limit is not None else None
    weekly_limit = user.weekly_limit if user.weekly_limit is not None else None
    bonus = user.bonus_today or 0

    info = {
        "today_used": today_used,
        "today_limit": daily_limit,
        "week_used": week_used,
        "week_limit": weekly_limit,
        "bonus_today": bonus,
    }

    if daily_limit is not None:
        effective_daily = daily_limit + bonus
        if today_used >= effective_daily:
            return False, f"Daily limit reached ({today_used}/{effective_daily})", info
    if weekly_limit is not None and week_used >= weekly_limit:
        return False, f"Weekly limit reached ({week_used}/{weekly_limit})", info
    return True, "ok", info


def record_generation(db: Session, user_id: int, portfolio_id: int | None = None) -> None:
    db.add(GenerationLog(user_id=user_id, portfolio_id=portfolio_id))
    db.commit()
