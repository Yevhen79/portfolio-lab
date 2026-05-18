"""One-off: backfill Asset.is_mt from libertex_raw.json.

The Libertex catalogue page lists each instrument under one or more
platforms — `Libertex`, `Libertex Portfolio`, `MT4-Instant`,
`MT4-Market`, `MT5-Instant`. The first two are CFD-only on the Libertex
web/mobile app; the MT-tagged ones are tradeable in a MetaTrader 4 / 5
terminal. The user wants to constrain the optimiser's universe to that
subset, so we surface a per-asset boolean.

Mapping subtlety: MT platforms use Libertex's *friendly* symbol keys
(`Apple`, `Adidas`, `Citigroup`, ...), but the deduplicated DB row that
the optimiser sees is usually under the proper-ticker form (`AAPL`,
`ADS.DE`, ...). Both rows ultimately map to the same `yf_symbol`, so we
propagate is_mt by yf_symbol: any Asset whose yf_symbol matches a
yf_symbol that has at least one MT-tagged raw row gets is_mt=True. That
way both `Apple` and `AAPL` end up flagged, and after `load_active_assets`
deduplicates (preferring the canonical ticker), the user still gets MT
coverage for that underlying.

Idempotent. Safe to re-run.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).parent
RAW_PATH = ROOT / "data" / "libertex_raw.json"
DB_PATH = ROOT / "data" / "portfolio_lab.db"


MT_PLATFORMS = {"MT4-Instant", "MT4-Market", "MT5-Instant"}


def column_exists(cur: sqlite3.Cursor, table: str, col: str) -> bool:
    cur.execute(f"PRAGMA table_info({table})")
    return any(r[1] == col for r in cur.fetchall())


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"DB not found: {DB_PATH}")
    if not RAW_PATH.exists():
        raise SystemExit(f"libertex_raw.json not found: {RAW_PATH}")

    raw = json.loads(RAW_PATH.read_text(encoding="utf-8"))
    rows = raw.get("rows", [])

    # Set of raw symbol-keys that are listed on some MT platform.
    mt_raw_symbols: set[str] = set()
    for r in rows:
        if r.get("platform") not in MT_PLATFORMS:
            continue
        cells = r.get("cells") or []
        if not cells:
            continue
        mt_raw_symbols.add(str(cells[0]).strip())
    print(f"Raw MT-tagged symbols in catalogue: {len(mt_raw_symbols)}")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Migration: add the column if missing. SQLite supports ALTER TABLE
    # ADD COLUMN with a default; existing rows pick up the default (False).
    if not column_exists(cur, "assets", "is_mt"):
        cur.execute(
            "ALTER TABLE assets ADD COLUMN is_mt BOOLEAN NOT NULL DEFAULT 0"
        )
        conn.commit()
        print("Added column assets.is_mt")
    else:
        print("Column assets.is_mt already exists")

    # Step 1: every Asset whose symbol matches one of those raw MT symbols
    # gets is_mt=True. Catches the friendly-name rows (Apple, Adidas, ...).
    placeholders = ",".join("?" for _ in mt_raw_symbols)
    if mt_raw_symbols:
        cur.execute(
            f"UPDATE assets SET is_mt = 1 WHERE symbol IN ({placeholders})",
            tuple(mt_raw_symbols),
        )
        direct_hits = cur.rowcount
        print(f"Direct symbol matches: {direct_hits}")
    else:
        direct_hits = 0

    # Step 2: propagate by yf_symbol. Pick every yf_symbol that already has
    # at least one is_mt=True row, then flip is_mt=True on every other row
    # sharing that yf_symbol (the proper-ticker counterparts).
    cur.execute(
        """
        UPDATE assets
        SET is_mt = 1
        WHERE is_mt = 0
          AND yf_symbol IN (
              SELECT yf_symbol FROM assets WHERE is_mt = 1
          )
        """
    )
    propagated = cur.rowcount
    print(f"Propagated by yf_symbol: {propagated}")

    conn.commit()

    # Summary.
    n_mt = cur.execute(
        "SELECT COUNT(*) FROM assets WHERE is_mt = 1"
    ).fetchone()[0]
    n_mt_active = cur.execute(
        "SELECT COUNT(*) FROM assets WHERE is_mt = 1 AND is_active = 1"
    ).fetchone()[0]
    print()
    print(f"Total MT-flagged: {n_mt} ({n_mt_active} of those are active)")

    # Sample rows for sanity.
    cur.execute(
        """
        SELECT symbol, yf_symbol, name, category, is_active, is_mt
        FROM assets WHERE is_mt = 1
        ORDER BY symbol LIMIT 10
        """
    )
    print()
    print("Sample MT-flagged rows:")
    for row in cur.fetchall():
        print(f"  {row}")

    conn.close()


if __name__ == "__main__":
    main()
