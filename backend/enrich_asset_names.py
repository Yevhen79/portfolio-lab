"""Backfill full company names into the Asset table.

After the multi-platform Libertex scrape, ~1200 stocks went through the
pass-through ticker mapper (`map_stock`) which left `name == symbol`
(e.g. AVGO/AVGO, COIN/COIN). The pie-chart and allocation table look
unfriendly without a human name.

This script:
  1. Loads every Asset row whose `name` matches its `symbol`.
  2. Calls `yfinance.Ticker(yf_symbol).info` and pulls `longName` or
     `shortName` as a fallback.
  3. Updates the row in-place.
  4. Caches the result to `data/asset_names.json` so a subsequent run
     can update `app/services/libertex_seed.py` without hitting the
     yfinance API again.

Throttling: sleeps 0.1 s between symbols; yfinance occasionally
rate-limits so failures are silently logged and the next symbol is
attempted. Re-run is idempotent.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import yfinance as yf

from app import models  # noqa: F401
from app.database import SessionLocal
from app.models import Asset


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("enrich")

CACHE_FILE = Path(__file__).parent / "data" / "asset_names.json"


def load_cache() -> dict:
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_cache(d: dict) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")


def fetch_name(yf_symbol: str) -> str | None:
    """Return longName / shortName from yfinance, or None on failure."""
    try:
        t = yf.Ticker(yf_symbol)
        info = t.info or {}
        name = info.get("longName") or info.get("shortName")
        if name and isinstance(name, str):
            return name.strip()
    except Exception as exc:
        log.debug("yfinance failed for %s: %s", yf_symbol, exc)
    return None


def main() -> None:
    cache = load_cache()
    db = SessionLocal()
    try:
        # Only target rows where the human label is missing (== ticker).
        candidates = (
            db.query(Asset)
            .filter(Asset.is_active.is_(True))
            .all()
        )
        candidates = [a for a in candidates if (a.name or "").strip() == (a.symbol or "").strip()]
        log.info("Enrich candidates: %d (assets where name == symbol)", len(candidates))

        updated = 0
        skipped = 0
        from_cache = 0
        for i, a in enumerate(candidates, start=1):
            key = a.yf_symbol
            name = cache.get(key)
            if name is None:
                name = fetch_name(key)
                if name:
                    cache[key] = name
                    time.sleep(0.1)  # throttle
                else:
                    skipped += 1
                    continue
            else:
                from_cache += 1

            if name and name != a.symbol:
                a.name = name
                updated += 1

            if i % 50 == 0:
                db.commit()
                save_cache(cache)
                log.info(
                    "[%d/%d] committed; updated=%d, skipped=%d, from_cache=%d, last=%s -> %s",
                    i, len(candidates), updated, skipped, from_cache, a.symbol, name,
                )

        db.commit()
        save_cache(cache)
        log.info(
            "Done. Updated=%d, skipped=%d (no yfinance name), cached=%d",
            updated, skipped, from_cache,
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
