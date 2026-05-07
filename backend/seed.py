"""Bootstrap database: create tables, seed admin user, and load Libertex assets."""
from datetime import datetime

from app import models  # noqa: F401
from app.auth.security import hash_password
from app.config import ensure_directories, settings
from app.database import Base, SessionLocal, engine
from app.models import Asset, User, UserRole, UserStatus
from app.services.libertex_parser import get_universe


def main() -> None:
    ensure_directories()
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Admin user
        admin = db.query(User).filter(User.email == settings.ADMIN_EMAIL).first()
        if admin is None:
            admin = User(
                email=settings.ADMIN_EMAIL,
                name=settings.ADMIN_NAME,
                password_hash=hash_password(settings.ADMIN_PASSWORD),
                role=UserRole.ADMIN.value,
                status=UserStatus.APPROVED.value,
                daily_limit=None,
                weekly_limit=None,
                created_at=datetime.utcnow(),
            )
            db.add(admin)
            db.commit()
            print(f"Admin user created: {settings.ADMIN_EMAIL}")
        else:
            admin.role = UserRole.ADMIN.value
            admin.status = UserStatus.APPROVED.value
            admin.daily_limit = None
            admin.weekly_limit = None
            db.commit()
            print(f"Admin user updated: {settings.ADMIN_EMAIL}")

        # Libertex assets
        universe = get_universe()
        existing = {a.symbol: a for a in db.query(Asset).all()}
        added = 0
        for r in universe:
            if r["symbol"] in existing:
                continue
            db.add(Asset(
                symbol=r["symbol"],
                yf_symbol=r["yf_symbol"],
                tv_symbol=r.get("tv_symbol"),
                name=r["name"],
                category=r["category"],
                currency=r.get("currency", "USD"),
                is_crypto=r.get("is_crypto", False),
                is_active=True,
            ))
            added += 1
        db.commit()
        print(f"Assets seeded: +{added} (total in DB: {db.query(Asset).count()})")
    finally:
        db.close()


if __name__ == "__main__":
    main()
