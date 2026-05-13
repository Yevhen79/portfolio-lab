"""Backfill enriched asset names into the saved Portfolio.weights JSON.

`Asset.name` was updated in-place by `enrich_asset_names.py`, but historical
`Portfolio.weights` (a JSON column saved at the time of optimisation) still
holds the old `name == symbol` values. This script walks every saved
portfolio and refreshes the `name` field on each weight using the current
Asset table — keeping all other fields (weight, amount_usd, CAGR, etc.)
untouched.

Idempotent: re-running after a fresh enrichment is safe.
"""
from __future__ import annotations

import logging
from sqlalchemy.orm.attributes import flag_modified

from app import models  # noqa: F401
from app.database import SessionLocal
from app.models import Asset, Portfolio


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("backfill")


def main() -> None:
    db = SessionLocal()
    try:
        # Build symbol -> name map from the live Asset table.
        sym_to_name = {a.symbol: a.name for a in db.query(Asset).all()}
        log.info("Loaded %d names from Asset table", len(sym_to_name))

        portfolios = db.query(Portfolio).all()
        log.info("Scanning %d saved portfolios", len(portfolios))
        total_weights_updated = 0
        portfolios_changed = 0

        for p in portfolios:
            weights = p.weights or []
            changed = 0
            for w in weights:
                sym = w.get("symbol")
                old_name = w.get("name", "")
                new_name = sym_to_name.get(sym)
                if new_name and new_name != old_name and new_name != sym:
                    w["name"] = new_name
                    changed += 1
            if changed:
                # SQLAlchemy doesn't detect in-place mutation of JSON columns;
                # tell it explicitly so the UPDATE fires.
                flag_modified(p, "weights")
                portfolios_changed += 1
                total_weights_updated += changed
                log.info("Portfolio #%d (%s): %d weights renamed", p.id, p.name, changed)
        db.commit()
        log.info(
            "Done. %d portfolios touched, %d weight entries renamed.",
            portfolios_changed, total_weights_updated,
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
