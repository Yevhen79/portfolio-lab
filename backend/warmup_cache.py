"""Pre-fetch yfinance history for all assets in the DB and save to parquet cache.

Run this once after seed.py so the first /optimize call doesn't have to make
~190 sequential yfinance requests (which can OOM or segfault curl_cffi on Windows).
"""
import logging
import time

from app.config import ensure_directories
from app.database import SessionLocal
from app.models import Asset
from app.services import data_loader as dl


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("warmup")


def main(years: int = 20) -> None:
    ensure_directories()
    db = SessionLocal()
    try:
        assets = db.query(Asset).filter(Asset.is_active.is_(True)).all()
        log.info("Warming cache for %d assets (history=%dy)", len(assets), years)
        ok = fail = 0
        for i, a in enumerate(assets, start=1):
            interval = "1wk" if a.is_crypto else "1mo"
            try:
                df = dl.fetch_yfinance(a.yf_symbol, interval=interval, years=years, use_cache=True)
                if df is None or df.empty:
                    fail += 1
                    log.warning("[%d/%d] %s — no data", i, len(assets), a.symbol)
                else:
                    ok += 1
                    log.info("[%d/%d] %s — %d bars", i, len(assets), a.symbol, len(df))
                # tiny delay to avoid hammering yfinance
                time.sleep(0.1)
            except Exception as exc:
                fail += 1
                log.warning("[%d/%d] %s — %s", i, len(assets), a.symbol, exc)
        log.info("Done. ok=%d fail=%d", ok, fail)
    finally:
        db.close()


if __name__ == "__main__":
    main()
