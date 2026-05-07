"""Libertex CFD specification parser.

Two strategies are supported:

1. **Seed mode (default):** load a hand-curated list of MT5 Market CFDs
   shipped with the project. This works offline and gives ~180 high-quality
   instruments out of the box.

2. **Refresh mode (manual):** an external operator runs Chrome MCP against
   https://libertex.org/cfd-specification, extracts the rendered table,
   and saves it to data/libertex_assets.json. This module then loads from
   that JSON file at next refresh.

Either way the result is a list of dicts that maps to Asset rows.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, List

from app.config import settings
from app.services.libertex_seed import LIBERTEX_SEED


logger = logging.getLogger(__name__)


def load_seed() -> List[Dict]:
    out: List[Dict] = []
    for symbol, yf_symbol, tv_symbol, name, category, currency, is_crypto in LIBERTEX_SEED:
        out.append({
            "symbol": symbol,
            "yf_symbol": yf_symbol,
            "tv_symbol": tv_symbol,
            "name": name,
            "category": category,
            "currency": currency,
            "is_crypto": is_crypto,
        })
    return out


def load_refreshed() -> List[Dict] | None:
    path = Path(settings.LIBERTEX_CACHE_FILE)
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
    except Exception as exc:
        logger.warning("Failed to read libertex cache: %s", exc)
    return None


def get_universe() -> List[Dict]:
    refreshed = load_refreshed()
    if refreshed:
        return refreshed
    return load_seed()


def save_refreshed(rows: List[Dict]) -> None:
    path = Path(settings.LIBERTEX_CACHE_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
