"""High-level universe assembly: pulls assets from DB, fetches prices,
applies filters, returns a clean returns DataFrame ready for optimization.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.models import Asset
from app.services import data_loader as dl
from app.services.trace import BuildTrace


logger = logging.getLogger(__name__)


def _label(a: Asset) -> tuple[str, str]:
    """Standard (symbol, name) tuple for trace entries."""
    return (a.symbol or "?", a.name or a.symbol or "?")


def load_active_assets(
    db: Session,
    categories: Optional[List[str]] = None,
    exclude_symbols: Optional[List[str]] = None,
    trace: Optional[BuildTrace] = None,
    mt_only: bool = False,
) -> List[Asset]:
    q = db.query(Asset).filter(Asset.is_active.is_(True))
    if categories:
        q = q.filter(Asset.category.in_(categories))
    if mt_only:
        # Restrict to instruments the user can actually trade in a
        # MetaTrader 4 / 5 terminal. The is_mt flag is set on both the
        # friendly-name row ("Apple") and its proper-ticker counterpart
        # ("AAPL"); the dedup step below collapses the pair to whichever
        # one is canonical, keeping MT coverage for that underlying.
        q = q.filter(Asset.is_mt.is_(True))
    assets = q.all()
    initial_count = len(assets)

    # Defense-in-depth dedup. The DB sometimes ends up with two rows for the
    # same underlying yfinance ticker (e.g. one from the standard ticker seed
    # and one from a Libertex display-name seed: AAPL + Apple, both →
    # yf_symbol=AAPL). Two rows mean the optimiser sees a perfectly correlated
    # pair (corr = 1.0), which silently breaks the covariance matrix and lets
    # nonsense — like 100% in the duplicate's "winner" — bubble up as a
    # max-Sharpe portfolio. Keep one row per yf_symbol; prefer the canonical
    # ticker form (symbol == yf_symbol) over the human-named variant.
    seen: dict[str, Asset] = {}
    dedup_drops: list[tuple[str, str, str]] = []
    for a in assets:
        key = (a.yf_symbol or "").upper()
        if not key:
            continue
        existing = seen.get(key)
        if existing is None:
            seen[key] = a
            continue
        # Pick the more "ticker-like" of the two: symbol matching yf_symbol
        # exactly, or stripped of `=X` for FX.
        norm = key.replace("=X", "")
        if (a.symbol or "").upper() in (key, norm):
            # Current `a` is the canonical; the previous `existing` was a dupe
            dedup_drops.append((existing.symbol, existing.name or existing.symbol, f"дубль {a.symbol} (yf={key})"))
            seen[key] = a
        else:
            dedup_drops.append((a.symbol, a.name or a.symbol, f"дубль {existing.symbol} (yf={key})"))
    dedup_count = len(assets) - len(seen)
    if dedup_count:
        logger.info("Deduplicated %d duplicate yf_symbol rows during universe load.", dedup_count)
    assets = list(seen.values())

    excluded_drops: list[tuple[str, str, str]] = []
    if exclude_symbols:
        # Case-insensitive set — users typing AAPL and aapl both work.
        excluded = {s.strip().upper() for s in exclude_symbols if s and s.strip()}
        if excluded:
            before = len(assets)
            kept: list[Asset] = []
            for a in assets:
                if (a.symbol or "").upper() in excluded:
                    excluded_drops.append((a.symbol, a.name or a.symbol, "в пользовательском списке исключений"))
                else:
                    kept.append(a)
            assets = kept
            logger.info("Excluded %d assets from universe (%d → %d)", before - len(assets), before, len(assets))

    if trace is not None:
        cat_str = ", ".join(categories) if categories else "все"
        note = f"Из БД активных: {initial_count}, выбранные категории: {cat_str}."
        if dedup_drops:
            note += f" Удалено дублей: {len(dedup_drops)}."
        if excluded_drops:
            note += f" Применён список исключений: {len(excluded_drops)}."
        trace.add_step(
            name="Начальный набор активов из каталога",
            kept=[_label(a) for a in assets],
            dropped=dedup_drops + excluded_drops,
            note=note,
        )

    return assets


def assemble_returns(
    db: Session,
    history_years: int = 20,
    min_history_years: int = 6,
    categories: Optional[List[str]] = None,
    max_assets: int = 300,
    exclude_symbols: Optional[List[str]] = None,
    trace: Optional[BuildTrace] = None,
    as_of_date: Optional[datetime] = None,
    max_drop_from_peak_pct: float = 0.60,
    mt_only: bool = False,
) -> Tuple[pd.DataFrame, List[Asset]]:
    """Return (monthly_returns_df, list_of_assets_in_order_of_columns).

    When `trace` is provided, each filter step appends its kept/dropped
    membership to the trace for post-mortem inspection.

    `as_of_date`: if set, every price series is cropped at that date BEFORE
    filters run, so the universe-trimming decisions (min history, negative
    mean, top-by-Sharpe) only see information that would have been
    available on that historical date. This is what makes the backtest
    honest — without it, the optimiser implicitly peeks into the future
    when deciding which assets to keep.
    """
    assets = load_active_assets(
        db, categories=categories, exclude_symbols=exclude_symbols, trace=trace,
        mt_only=mt_only,
    )
    if not assets:
        return pd.DataFrame(), []

    # Pull prices: monthly for non-crypto, weekly for crypto (then aggregate)
    prices_by_symbol: Dict[str, pd.DataFrame] = {}
    is_crypto_map: Dict[str, bool] = {}
    asset_by_yf: Dict[str, Asset] = {}

    yfinance_misses: list[tuple[str, str, str]] = []
    structural_drops: list[tuple[str, str, str]] = []
    for a in assets:
        interval = "1wk" if a.is_crypto else "1mo"
        df = dl.fetch_yfinance(
            a.yf_symbol, interval=interval, years=history_years, as_of_date=as_of_date,
        )
        if df is None or df.empty:
            yfinance_misses.append((a.symbol, a.name or a.symbol, "yfinance не вернул данных (вероятно делистинг)"))
            continue

        # Structural-breakage filter. Drops assets that suffered a permanent
        # impairment (regulatory destruction, fraud, post-bubble crypto, etc.)
        # and never recovered. The optimiser is otherwise math-blind to these.
        try:
            prices = df["close"].dropna()
            if len(prices) >= 24:
                max_p = float(prices.max())
                last_p = float(prices.iloc[-1])
                if max_p > 0 and last_p / max_p < 0.25:
                    max_age_days = (prices.index[-1] - prices.idxmax()).days
                    if max_age_days > 24 * 30:
                        drop_pct = (1.0 - last_p / max_p) * 100.0
                        structural_drops.append(
                            (
                                a.symbol,
                                a.name or a.symbol,
                                # Read this as: "fell N% from peak — current is $X "
                                # vs peak $Y from M months ago". Earlier wording
                                # ("сейчас 8% от максимума") was ambiguous —
                                # users misread it as "8% drop" instead of
                                # "now worth 8% of peak". Explicit drop% +
                                # absolute prices make the math unambiguous.
                                f"структурная поломка: упал на {drop_pct:.0f}% от пика "
                                f"(сейчас ${last_p:.2f}, пик ${max_p:.2f} был "
                                f"{max_age_days // 30} мес. назад)",
                            )
                        )
                        continue
        except Exception:
            # Defensive: a malformed price frame shouldn't kill the run.
            pass

        prices_by_symbol[a.yf_symbol] = df
        is_crypto_map[a.yf_symbol] = a.is_crypto
        asset_by_yf[a.yf_symbol] = a

    if structural_drops:
        logger.info(
            "Structural-breakage filter dropped %d assets",
            len(structural_drops),
        )

    if trace is not None:
        kept_now = [_label(asset_by_yf[k]) for k in asset_by_yf if k in prices_by_symbol]
        trace.add_step(
            name="Загрузка цен с yfinance",
            kept=kept_now,
            dropped=yfinance_misses,
            note=f"Загружено успешно: {len(prices_by_symbol)}; не удалось: {len(yfinance_misses)}.",
        )
        trace.add_step(
            name="Фильтр «структурной поломки»",
            kept=kept_now,
            dropped=structural_drops,
            note="Дропаются активы, торгующиеся ниже 25% от исторического максимума, "
                 "если этот максимум был > 24 месяцев назад (regulatory casualties, "
                 "post-bubble crypto, и т.д.).",
        )

    # "Currently in a deep drawdown" filter. Catches names like ENPH in 2025
    # (last ~$100 vs peak $329 = 68% below peak) that the optimiser would
    # otherwise pick on the basis of positive average historical return.
    # User's mental model: assets should visually trend bottom-left to
    # top-right. We approximate that by requiring the latest close to be
    # within `(1 - threshold)` of the historical peak inside the window.
    # Threshold = 1.0 disables the filter.
    drop_from_peak_drops: list[tuple[str, str, str]] = []
    if max_drop_from_peak_pct < 1.0 and prices_by_symbol:
        to_drop: list[str] = []
        for yf_sym, df in prices_by_symbol.items():
            try:
                prices = df["close"].dropna()
                # Need at least a year of data for a meaningful peak.
                if len(prices) < 12:
                    continue
                peak = float(prices.max())
                last = float(prices.iloc[-1])
                if peak <= 0:
                    continue
                drop_pct = 1.0 - last / peak
                if drop_pct > max_drop_from_peak_pct:
                    a = asset_by_yf.get(yf_sym)
                    if a is None:
                        continue
                    peak_ts = prices.idxmax()
                    months_since_peak = max(
                        1, int((prices.index[-1] - peak_ts).days // 30)
                    )
                    drop_from_peak_drops.append(
                        (
                            a.symbol,
                            a.name or a.symbol,
                            f"сейчас на {drop_pct * 100:.0f}% ниже пика "
                            f"(${last:.2f} vs пик ${peak:.2f} {months_since_peak} мес. назад) — "
                            f"порог фильтра «drop from peak» = {max_drop_from_peak_pct * 100:.0f}%",
                        )
                    )
                    to_drop.append(yf_sym)
            except Exception:
                # A malformed series shouldn't kill the run.
                pass
        for yf_sym in to_drop:
            prices_by_symbol.pop(yf_sym, None)
            is_crypto_map.pop(yf_sym, None)

    if drop_from_peak_drops:
        logger.info(
            "Drop-from-peak filter dropped %d assets (threshold %.0f%%)",
            len(drop_from_peak_drops),
            max_drop_from_peak_pct * 100,
        )

    if trace is not None:
        kept_now = [_label(asset_by_yf[k]) for k in prices_by_symbol if k in asset_by_yf]
        trace.add_step(
            name=f"Фильтр «drop from peak» (≤ {max_drop_from_peak_pct * 100:.0f}%)",
            kept=kept_now,
            dropped=drop_from_peak_drops,
            note="Дропаем активы, сейчас торгующиеся слишком глубоко под своим "
                 "историческим максимумом — соответствует визуальному критерию "
                 "«трендовый актив», без затянувшихся коррекций. Порог "
                 "настраивается в разделе «Расширенно» / можно выключить (1.0).",
        )

    if not prices_by_symbol:
        return pd.DataFrame(), []

    returns = dl.compute_monthly_returns(prices_by_symbol, is_crypto=is_crypto_map)
    if returns.empty:
        return returns, []

    # Plausibility drops: data-loader stashed them on .attrs.
    if trace is not None:
        plaus_drops_raw = returns.attrs.get("plausibility_drops", [])
        plaus_drops: list[tuple[str, str, str]] = []
        for col, reason in plaus_drops_raw:
            a = asset_by_yf.get(col)
            if a:
                plaus_drops.append((a.symbol, a.name or a.symbol, reason))
        kept_yf = set(returns.columns)
        kept_now = [_label(asset_by_yf[k]) for k in kept_yf if k in asset_by_yf]
        trace.add_step(
            name="Фильтр качества данных",
            kept=kept_now,
            dropped=plaus_drops,
            note="Удаляются ряды с явно битыми данными yfinance — невозможными "
                 "месячными скачками (>300% для не-крипто, >1500% для крипто).",
        )

    before_history = set(returns.columns)
    returns = dl.filter_universe_by_history(returns, min_history_years=min_history_years)
    if trace is not None:
        after = set(returns.columns)
        history_drops = [
            (
                asset_by_yf[c].symbol,
                asset_by_yf[c].name or asset_by_yf[c].symbol,
                f"истории < {min_history_years} лет (требуется ≥ {min_history_years * 12} месячных баров)",
            )
            for c in (before_history - after)
            if c in asset_by_yf
        ]
        kept_now = [_label(asset_by_yf[c]) for c in returns.columns if c in asset_by_yf]
        trace.add_step(
            name=f"Минимальная история (≥ {min_history_years} лет)",
            kept=kept_now,
            dropped=history_drops,
            note=f"Отсекает свежие IPO, новые крипто-токены и любые активы с короткой "
                 f"историей. Текущий порог: {min_history_years} лет.",
        )
    if returns.empty:
        return returns, []

    before_neg = set(returns.columns)
    returns = dl.filter_negative_mean(returns)
    if trace is not None:
        after = set(returns.columns)
        neg_drops = [
            (
                asset_by_yf[c].symbol,
                asset_by_yf[c].name or asset_by_yf[c].symbol,
                "средняя месячная доходность за всю историю ≤ 0 (актив в среднем терял)",
            )
            for c in (before_neg - after)
            if c in asset_by_yf
        ]
        kept_now = [_label(asset_by_yf[c]) for c in returns.columns if c in asset_by_yf]
        trace.add_step(
            name="Фильтр неотрицательной средней доходности",
            kept=kept_now,
            dropped=neg_drops,
            note="Дропаются активы, у которых среднее месячных доходностей ≤ 0 — "
                 "они в среднем теряли деньги, не имеют места в Markowitz long-only.",
        )
    if returns.empty:
        return returns, []

    # NOTE: we DO NOT call `common_window` here. Cropping to the shortest
    # asset's history throws away decades of data for older instruments —
    # the optimizer's `estimate_mu_sigma` now handles per-asset μ on full
    # history and per-pair Σ on the common window internally.

    # Cap universe size by the highest historical Sharpe-like metric (μ/σ).
    # `mean()` / `std()` handle NaN via skipna=True automatically so this
    # works on the wide-history frame too.
    if returns.shape[1] > max_assets:
        means = returns.mean()
        stds = returns.std().replace(0, np.nan)
        score = (means / stds).fillna(-np.inf)
        keep_cols = score.sort_values(ascending=False).head(max_assets).index
        dropped_cols = [c for c in returns.columns if c not in keep_cols]
        returns = returns[keep_cols]
        if trace is not None:
            cut_drops = [
                (
                    asset_by_yf[c].symbol,
                    asset_by_yf[c].name or asset_by_yf[c].symbol,
                    f"низкий μ/σ (Sharpe-like) — обрезано до топ-{max_assets} активов",
                )
                for c in dropped_cols
                if c in asset_by_yf
            ]
            kept_now = [_label(asset_by_yf[c]) for c in returns.columns if c in asset_by_yf]
            trace.add_step(
                name=f"Ранжирование по μ/σ и обрезка до топ-{max_assets}",
                kept=kept_now,
                dropped=cut_drops,
                note=f"Слишком большая вселенная для оптимизатора. Оставляем лучших "
                     f"по индивидуальному Sharpe-подобному скору. Сейчас лимит: {max_assets}.",
            )

    ordered_assets = [asset_by_yf[col] for col in returns.columns if col in asset_by_yf]
    return returns, ordered_assets
