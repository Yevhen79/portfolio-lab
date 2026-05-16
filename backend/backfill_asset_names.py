"""One-off: backfill Asset.name for rows where name == symbol.

The original `build_seed_from_scrape.py:map_stock` pass-through case used the
ticker as the friendly name, so every stock NOT covered by the manual
STOCK_MAP got `name=symbol` (e.g. TCTZ instead of "Tencent Holdings"). The
DB inherited that. This script reads the descriptions Libertex actually
prints in `data/libertex_raw.json` (column "Instrument description" /
cells[1] for stock rows) and patches the affected rows.

It also unflags a known broken row:
  SK — Libertex's catalogue lists "Slack Technologies" under this ticker,
  but Slack was acquired by Salesforce in July 2021 and delisted. Our
  yf_symbol mapping ('000660.KS' = SK Hynix on KRX) is unrelated to either
  Slack or anything Libertex actually trades. We mark it inactive so the
  ticker can no longer be picked.

Idempotent. Safe to re-run.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).parent
RAW_PATH = ROOT / "data" / "libertex_raw.json"
DB_PATH = ROOT / "data" / "portfolio_lab.db"


# A few names cannot be lifted from the raw scrape because the row was
# either dropped before scraping or the description column was blank.
# Curated overrides for those:
EXTRA_NAMES: dict[str, str] = {
    "RH": "RH (Restoration Hardware)",
}


# Tickers whose Libertex listing is a zombie (broker page still shows the
# row, but the underlying company is delisted / merged / renamed). We mark
# them inactive so the optimiser never includes them. Each entry carries
# the reason for the audit log.
ZOMBIE_TICKERS: dict[str, str] = {
    "SK": (
        "Libertex ticker SK = Slack Technologies, delisted 2021 after Salesforce "
        "acquisition. Local yf_symbol mapping ('000660.KS' = SK Hynix) is "
        "unrelated to the Libertex instrument — pricing would be misleading."
    ),
}


def load_descriptions() -> dict[str, str]:
    """Return {symbol: description} extracted from Stocks rows."""
    data = json.loads(RAW_PATH.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for r in data.get("rows", []):
        if r.get("group", "").lower() != "stocks":
            continue
        cells = r.get("cells", [])
        if len(cells) < 2:
            continue
        sym = str(cells[0]).strip()
        desc = str(cells[1]).strip()
        if desc and desc != sym:
            out[sym] = desc
    return out


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"DB not found: {DB_PATH}")
    if not RAW_PATH.exists():
        raise SystemExit(f"libertex_raw.json not found: {RAW_PATH}")

    desc_map = load_descriptions()
    print(f"Loaded {len(desc_map)} stock descriptions from libertex_raw.json")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("SELECT symbol FROM assets WHERE name = symbol")
    affected = [r[0] for r in cur.fetchall()]
    print(f"Found {len(affected)} rows with name == symbol")

    updated = 0
    still_missing: list[str] = []
    for sym in affected:
        name = desc_map.get(sym) or EXTRA_NAMES.get(sym)
        if not name:
            still_missing.append(sym)
            continue
        cur.execute("UPDATE assets SET name = ? WHERE symbol = ?", (name, sym))
        updated += 1
        print(f"  {sym:8s} -> {name}")

    # Deactivate zombie tickers
    deactivated = 0
    for sym, reason in ZOMBIE_TICKERS.items():
        cur.execute(
            "UPDATE assets SET is_active = 0 WHERE symbol = ? AND is_active = 1",
            (sym,),
        )
        if cur.rowcount > 0:
            deactivated += 1
            print(f"  DEACTIVATED {sym}: {reason}")

    conn.commit()
    conn.close()

    print()
    print(f"Done. Updated names: {updated}. Deactivated zombies: {deactivated}.")
    if still_missing:
        print(f"Still missing ({len(still_missing)}): {', '.join(still_missing)}")
        print("(Add to EXTRA_NAMES in this script if you want to label them.)")


if __name__ == "__main__":
    main()
