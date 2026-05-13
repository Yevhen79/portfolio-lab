"""Wipe assets table and re-seed from the freshly built libertex_seed.py."""
from app import models  # noqa: F401
from app.database import SessionLocal
from app.models import Asset
from app.services.libertex_parser import get_universe


def main() -> None:
    db = SessionLocal()
    try:
        deleted = db.query(Asset).delete()
        db.commit()
        print(f"Deleted {deleted} old assets")

        added = 0
        for r in get_universe():
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
        print(f"Added {added} fresh assets")
        from collections import Counter
        cat_count = Counter(a.category for a in db.query(Asset).all())
        for c, n in cat_count.most_common():
            print(f"  {c}: {n}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
