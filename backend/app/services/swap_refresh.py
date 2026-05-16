"""Weekly auto-refresh of Libertex overnight-swap rates.

Libertex updates the spec page occasionally — new instruments appear, swap
rates drift, some symbols get deactivated. Without refresh the optimiser
keeps using stale numbers and the `apply_swaps` toggle stops reflecting
reality after a few weeks.

Lifecycle:
  • On FastAPI startup we check `data/swap_refresh.json` for the last
    refresh timestamp. If > 7 days old (or never), we spawn a background
    thread that runs the scrape + DB populate. App startup is NOT blocked.
  • Admin can also trigger via `POST /api/admin/refresh-swaps` whenever.
  • Each refresh writes its result back to `swap_refresh.json` so the next
    startup knows when we last ran.

Scrape runs via subprocess (Playwright + headless Edge) — heavy but
isolated from the web server process. Typical wall time 30–90 s.
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)


BACKEND_ROOT = Path(__file__).parent.parent.parent  # backend/
META_PATH = BACKEND_ROOT / "data" / "swap_refresh.json"
SCRAPE_SCRIPT = BACKEND_ROOT / "scrape_libertex.py"
POPULATE_SCRIPT = BACKEND_ROOT / "populate_swaps.py"

# How fresh we consider swap data. Libertex updates rates roughly monthly;
# 7 days gives us a comfortable buffer without spamming their site.
DEFAULT_TTL_DAYS = 7

# Subprocess timeouts. Scrape uses Playwright which can stall on Cloudflare.
SCRAPE_TIMEOUT_SEC = 600   # 10 min — generous for Cloudflare retries
POPULATE_TIMEOUT_SEC = 120  # 2 min — pure SQL, should be fast

# Single-flight: while one refresh runs another cannot start. Caller gets
# a clear "already in progress" answer instead of two scrapes hammering
# Libertex in parallel.
_refresh_lock = threading.Lock()
_refresh_running = False


@dataclass
class RefreshStatus:
    last_refresh: datetime | None
    in_progress: bool
    ttl_days: int = DEFAULT_TTL_DAYS

    @property
    def is_stale(self) -> bool:
        if self.last_refresh is None:
            return True
        return datetime.now() - self.last_refresh > timedelta(days=self.ttl_days)

    @property
    def next_due_at(self) -> datetime | None:
        if self.last_refresh is None:
            return datetime.now()
        return self.last_refresh + timedelta(days=self.ttl_days)


def _read_meta() -> dict[str, Any]:
    try:
        return json.loads(META_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_meta(payload: dict[str, Any]) -> None:
    META_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        META_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:
        logger.warning("Failed to write swap refresh meta: %s", exc)


def status() -> RefreshStatus:
    meta = _read_meta()
    ts_str = meta.get("last_refresh")
    last = None
    if ts_str:
        try:
            last = datetime.fromisoformat(ts_str)
        except Exception:
            last = None
    return RefreshStatus(last_refresh=last, in_progress=_refresh_running)


def _run_subprocess(script: Path, timeout: int) -> tuple[bool, str]:
    """Run a Python script under our venv interpreter, capture stdout/stderr."""
    if not script.exists():
        return False, f"script not found: {script}"
    try:
        proc = subprocess.run(
            [sys.executable, str(script)],
            cwd=str(BACKEND_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        ok = proc.returncode == 0
        # Keep both streams; populate prints summary stats, scrape logs progress.
        combined = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        return ok, combined[-4000:]  # tail to keep meta file small
    except subprocess.TimeoutExpired as exc:
        return False, f"timeout after {exc.timeout}s"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def _refresh_impl() -> dict[str, Any]:
    """Synchronous body. Holds `_refresh_lock` so this is single-flight."""
    started = datetime.now()
    logger.info("Swap refresh started at %s", started.isoformat())

    scrape_ok, scrape_log = _run_subprocess(SCRAPE_SCRIPT, SCRAPE_TIMEOUT_SEC)
    if not scrape_ok:
        logger.warning("Swap refresh: scrape FAILED (will still try populate from old raw).")

    populate_ok, populate_log = _run_subprocess(POPULATE_SCRIPT, POPULATE_TIMEOUT_SEC)
    finished = datetime.now()
    duration_sec = (finished - started).total_seconds()

    result: dict[str, Any] = {
        "last_refresh": finished.isoformat(),
        "duration_sec": round(duration_sec, 1),
        "scrape_ok": scrape_ok,
        "populate_ok": populate_ok,
        # The populate script prints a summary like "Updated N assets" —
        # keep its tail for the admin UI to display.
        "populate_summary": (populate_log or "").strip().splitlines()[-3:],
    }
    if not scrape_ok:
        result["scrape_log_tail"] = scrape_log[-1000:]
    _write_meta(result)
    logger.info(
        "Swap refresh complete in %.1fs (scrape_ok=%s, populate_ok=%s)",
        duration_sec, scrape_ok, populate_ok,
    )
    return result


def refresh_async() -> bool:
    """Kick off a refresh in a daemon thread. No-op if already running.

    Returns True if a fresh refresh was scheduled, False if one is already
    in progress (the caller can show "already running" to the user).
    """
    global _refresh_running
    if not _refresh_lock.acquire(blocking=False):
        return False
    if _refresh_running:
        _refresh_lock.release()
        return False
    _refresh_running = True
    _refresh_lock.release()

    def _worker():
        global _refresh_running
        try:
            _refresh_impl()
        except Exception as exc:
            logger.exception("Swap refresh worker crashed: %s", exc)
        finally:
            _refresh_running = False

    threading.Thread(target=_worker, daemon=True, name="swap-refresh").start()
    return True


def maybe_refresh_on_startup() -> None:
    """Called from FastAPI startup hook. Triggers a refresh iff stale."""
    s = status()
    if s.is_stale and not s.in_progress:
        logger.info(
            "Swap data is stale (last refresh: %s, ttl: %d days) — scheduling background refresh.",
            s.last_refresh.isoformat() if s.last_refresh else "never",
            s.ttl_days,
        )
        refresh_async()
    else:
        logger.info(
            "Swap data fresh (last refresh %s, next due %s).",
            s.last_refresh.isoformat() if s.last_refresh else "never",
            s.next_due_at.isoformat() if s.next_due_at else "—",
        )
