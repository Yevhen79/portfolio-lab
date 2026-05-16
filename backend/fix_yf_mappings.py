"""Repair the `Asset.yf_symbol` mappings exposed by the per-run trace.

The Libertex seed used the broker's display symbol for several rows. For
European / Asian listings Yahoo Finance needs an exchange suffix (`.DE`,
`.MC`, `.HK`, `.KS`), and a handful of US tickers were silently renamed by
corporate actions (`ABC`→`COR`, `NRZ`→`RITM`, `PKI`→`RVTY`, …). Without
this fix the build pipeline drops them at the yfinance step with the
generic "no data" reason, and the user blames us instead of the data.

We also deactivate the genuinely-delisted set (`YNDX`, `SAVE`, `JWN`,
`WISH`, `MNTV`, `BODY`).

Idempotent: re-running after applying is a no-op.
"""
from __future__ import annotations

from pathlib import Path

from app.database import SessionLocal
from app.models import Asset


# (current_yf_symbol_in_db, correct_yf_symbol, optional_new_display_symbol)
RENAMES: list[tuple[str, str, str | None]] = [
    # European listings — add exchange suffix
    ("ADS", "ADS.DE", None),       # Adidas (XETRA)
    ("BAYN", "BAYN.DE", None),     # Bayer (XETRA)
    ("P911", "P911.DE", None),     # Porsche AG (XETRA)
    ("ITX", "ITX.MC", None),       # Inditex (Madrid)
    # Asian listings
    ("IDCB", "1398.HK", None),     # ICBC (Hong Kong)
    ("TCTZ", "0700.HK", None),     # Tencent (Hong Kong)
    ("LNVG", "0992.HK", None),     # Lenovo (Hong Kong)
    ("SK", "000660.KS", None),     # SK Hynix (Korea)
    # Corporate-action renames — ticker AND display symbol change
    ("ABC", "COR", "COR"),         # AmerisourceBergen → Cencora
    ("NRZ", "RITM", "RITM"),       # New Residential → Rithm Capital
    ("PKI", "RVTY", "RVTY"),       # PerkinElmer → Revvity
    ("SMFR", "WGS", "WGS"),        # Sema4 → GeneDx
    ("SQ", "XYZ", "XYZ"),          # Square → Block (yes, ticker changed in 2025)
    ("CDEV", "PR", "PR"),          # Centennial → Permian Resources
]

# Genuinely delisted — deactivate, don't try to remap
DEACTIVATE: list[str] = [
    "YNDX",  # Yandex — delisted from Nasdaq after Russia sanctions
    "SAVE",  # Spirit Airlines — Chapter 11, delisted 2024
    "JWN",   # Nordstrom — taken private 2025
    "WISH",  # ContextLogic — delisted
    "MNTV",  # Momentive Global — acquired by Symphony Tech, delisted
    "BODY",  # Beachbody Company — delisted
]


def main() -> None:
    db = SessionLocal()
    renamed = 0
    deactivated_conflicts = 0
    deactivated = 0
    cache_to_invalidate: list[str] = []
    try:
        for old_yf, new_yf, new_sym in RENAMES:
            row = db.query(Asset).filter(Asset.yf_symbol == old_yf).first()
            if row is None:
                print(f"  ~ {old_yf}: not in DB, skipping")
                continue
            if row.yf_symbol == new_yf and (new_sym is None or row.symbol == new_sym):
                print(f"  · {old_yf}: already migrated, skipping")
                continue

            # When the new display symbol already exists (a separate row was
            # already seeded under the renamed ticker — e.g. our seed has a
            # `COR` row from the latest Libertex sync alongside the legacy
            # `ABC` row), we can't update the old row to the same symbol due
            # to the UNIQUE constraint. Instead deactivate the stale row and
            # let the live `COR` row carry on.
            if new_sym is not None:
                conflict = (
                    db.query(Asset)
                    .filter(Asset.symbol == new_sym)
                    .filter(Asset.id != row.id)
                    .first()
                )
                if conflict is not None:
                    print(
                        f"  ⓘ {old_yf}: conflict — {new_sym} already exists (id={conflict.id}). "
                        f"Deactivating stale {row.symbol} (id={row.id})."
                    )
                    row.is_active = False
                    cache_to_invalidate.append(old_yf)
                    deactivated_conflicts += 1
                    continue

            print(f"  → {old_yf} (id={row.id}) → yf={new_yf}" + (f", sym={new_sym}" if new_sym else ""))
            cache_to_invalidate.append(old_yf)  # old cache file must die
            row.yf_symbol = new_yf
            if new_sym:
                row.symbol = new_sym
            renamed += 1

        for sym in DEACTIVATE:
            row = db.query(Asset).filter(Asset.symbol == sym).first()
            if row is None:
                print(f"  ~ {sym}: not in DB, skipping")
                continue
            if not row.is_active:
                print(f"  · {sym}: already inactive")
                continue
            print(f"  ✗ Deactivating {sym} (id={row.id}) — confirmed delisted")
            row.is_active = False
            deactivated += 1

        db.commit()
    finally:
        db.close()

    # Stale parquet cache cleanup for the renamed yf_symbols. The new yf
    # symbol writes to a different path, so leaving the old file is fine,
    # but it's tidier to delete.
    cache_dir = Path("data/prices")
    cleared = 0
    for old_yf in cache_to_invalidate:
        for f in cache_dir.glob(f"{old_yf}__*.parquet"):
            f.unlink()
            cleared += 1

    print(
        f"\nDone. Renamed {renamed}, deactivated {deactivated} (truly delisted), "
        f"deactivated {deactivated_conflicts} (stale duplicates), "
        f"cache files cleared {cleared}."
    )


if __name__ == "__main__":
    main()
