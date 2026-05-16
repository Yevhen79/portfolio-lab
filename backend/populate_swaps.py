"""Add `swap_buy_daily` column to assets (idempotent) and backfill from the
cached Libertex spec scrape.

The Libertex CFD specification lists `Swap buy (%)` per instrument — a
negative daily percentage the broker charges to hold a long position
overnight. AAPL is -0.0302%/day (= -11% annual drag), most US stocks
the same; crypto -0.014%/day on BTC/ETH, -0.07%/day on BNB/altcoins.

The portfolio engine reads this column only when the user toggles
`apply_swaps` on. Without the toggle the optimiser ignores swap entirely
(historical optimum on the underlying), so this script is safe to run
even before the UI exposes the feature.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from sqlalchemy import text

from app.database import SessionLocal, engine
from app.models import Asset


RAW_PATH = Path(__file__).parent / "data" / "libertex_raw.json"


def parse_pct(s: str | None) -> float:
    """Stringy '-0.0302 %' → -0.000302 (decimal daily rate). '-' / empty → 0."""
    if not s or str(s).strip() in {"-", ""}:
        return 0.0
    m = re.search(r"(-?\d+\.?\d*)", str(s))
    if not m:
        return 0.0
    return float(m.group(1)) / 100.0


def _is_numeric_like(s: str) -> bool:
    """`'20'` and `'1 500 000'` are numeric; `'Apple'` is not. We use this to
    detect whether the row has a Description cell at index 1 — stock rows
    do, crypto/FX rows don't. When present, swap_buy is at index 5 instead
    of index 4."""
    return bool(re.match(r"^[\d\s\.,]+$", str(s).strip()))


def build_swap_map() -> dict[str, float]:
    raw = json.loads(RAW_PATH.read_text(encoding="utf-8"))
    swaps: dict[str, float] = {}
    for row in raw.get("rows", []):
        cells = row.get("cells", [])
        if len(cells) < 6:
            continue
        sym = cells[0]
        # Adaptive offset based on whether cells[1] is the optional Description.
        sb_idx = 5 if not _is_numeric_like(cells[1]) else 4
        try:
            sb = parse_pct(cells[sb_idx])
        except Exception:
            sb = 0.0
        # Sanity clamp — Libertex never charges > 1% per day for retail
        # CFDs; anything bigger is a parser artifact (saw a few rows with
        # 10000000% caused by malformed source data).
        if sb < -0.01:  # less than -1% per day is implausible
            sb = max(sb, -0.01)
        if sb > 0:  # buy-swap should be ≤ 0 (broker charges, never pays)
            sb = 0.0
        # If a symbol appears on multiple platforms, keep the WORST (most
        # negative) — better to be conservative about cost.
        if sym in swaps:
            swaps[sym] = min(swaps[sym], sb)
        else:
            swaps[sym] = sb
    return swaps


def ensure_column() -> None:
    """SQLite doesn't auto-add columns; do it explicitly. No-op if present."""
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(assets)")).fetchall()
        names = [c[1] for c in cols]
        if "swap_buy_daily" not in names:
            conn.execute(text(
                "ALTER TABLE assets ADD COLUMN swap_buy_daily FLOAT NOT NULL DEFAULT 0.0"
            ))
            conn.commit()
            print("  Added column swap_buy_daily")
        else:
            print("  Column swap_buy_daily already exists")


def main() -> None:
    print("Ensuring swap_buy_daily column on assets table…")
    ensure_column()
    print("Building swap map from raw scrape…")
    swap_map = build_swap_map()
    print(f"  Loaded {len(swap_map)} symbol → swap mappings")

    db = SessionLocal()
    updated = 0
    missing = 0
    try:
        for a in db.query(Asset).filter(Asset.is_active.is_(True)).all():
            new = swap_map.get(a.symbol, None)
            if new is None:
                missing += 1
                continue
            if abs((a.swap_buy_daily or 0.0) - new) > 1e-12:
                a.swap_buy_daily = new
                updated += 1
        db.commit()
    finally:
        db.close()

    print(f"Done. Updated {updated} assets. {missing} active symbols had no swap data (kept 0).")


if __name__ == "__main__":
    main()
