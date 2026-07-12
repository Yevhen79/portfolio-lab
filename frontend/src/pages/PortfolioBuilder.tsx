import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Ban, Check, Loader2, Minus, Play, Plus, Save, Target, X } from "lucide-react";

import { errorMessage } from "../api/client";
import * as portfoliosApi from "../api/portfolios";
import type { OptimizeRequest, OptimizeResponse } from "../api/portfolios";
import EfficientFrontier from "../components/charts/EfficientFrontier";
import MonteCarloFan from "../components/charts/MonteCarloFan";
import WeightsBar from "../components/charts/WeightsBar";
import CorrelationHeatmap from "../components/charts/CorrelationHeatmap";
import DistributionChart from "../components/charts/DistributionChart";
import PortfolioMetrics from "../components/PortfolioMetrics";
import AllocationTable from "../components/AllocationTable";
import AssetHistoryModal from "../components/AssetHistoryModal";
import BuildErrorCard from "../components/BuildErrorCard";
import ConcentrationWarning from "../components/ConcentrationWarning";
import HelpTip from "../components/HelpTip";
import OptimizeProgress from "../components/OptimizeProgress";
import Section from "../components/Section";
import { useT, tpl } from "../i18n";
import { useAuth } from "../store/auth";
import { useConfig } from "../store/config";
import { fmtPct, fmtUSD, sparsifyForDisplay } from "../utils/format";

const DEFAULT_REQ: OptimizeRequest = {
  portfolio_type: "max_sharpe",
  initial_capital: 5000,
  risk_tolerance: "moderate",
  target_return: null,
  target_risk: null,
  history_years: 20,
  min_history_years: 6,
  cov_method: "ledoit_wolf",
  long_only: true,
  sparsify: true,
  sparsify_threshold: 0.01,
  // Per-asset cap. 0.35 = no single asset can exceed 35% of the portfolio,
  // which forces ≥ 3 non-zero positions and prevents the degenerate
  // "100% in one stock" outcomes the optimiser otherwise picks at the
  // corners of the feasibility region.
  max_weight_per_asset: 0.35,
  // Overnight swap costs OFF by default — the historical-only result is
  // the academic baseline. Users explicitly opt in via the form toggle
  // when they want the "net of holding cost" Libertex CFD reality.
  apply_swaps: false,
  // "Drop from peak" filter — drop assets currently >60% below their
  // historical peak. Default 0.60 catches "still in a deep drawdown"
  // names like ENPH-2024 without penalising assets that fully recovered
  // from a past crash (NVDA-2002, AMZN-2001). Slide to 1.0 to disable.
  max_drop_from_peak_pct: 0.60,
  // Personal-mode cap is 1000 (see FEATURE_FLAGS in backend/config.py). The
  // previous default (100) was a leftover from early dev and silently cut the
  // optimiser off from ~1300 mapped instruments. 500 strikes a balance: wide
  // enough to surface genuinely diverse mixes, narrow enough that the first
  // cold-cache run still fits inside the 60 s yfinance window.
  max_assets_in_universe: 500,
  categories: ["stock", "index", "commodity", "crypto", "fx", "etf"],
  // The slider falls back to 0.20 when target_risk is null, so we set
  // the same default here — that way the slider position always matches
  // the actual state instead of "looking like 20% but actually null".
  target_risk: 0.20,
  target_return: 0.15,
  exclude_symbols: [],
};

const ALL_CATEGORIES = ["stock", "index", "commodity", "crypto", "fx", "etf"] as const;

/** localStorage key for the user's "permanent" exclusion list. Survives full
 *  reloads and re-logins on the same device. Stored as a JSON array of
 *  uppercase ticker strings; the builder hydrates `req.exclude_symbols` from
 *  it on mount and writes back on every change. The new-asset input adds to
 *  this; the chip × removes from it; ditto the row × in the result table. */
const EXCLUDE_LS_KEY = "pl_exclude_symbols_v1";
const loadStoredExclusions = (): string[] => {
  try {
    const raw = localStorage.getItem(EXCLUDE_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
};

/** Persistence for the last unsaved portfolio + its request params.
 *
 *  iOS Safari / Chrome aggressively discard background tabs when the phone
 *  screen locks — the page silently reloads when the user returns and any
 *  in-memory state is gone. Re-running a 60-second optimisation just to see
 *  the same result is awful UX. We mirror the most recent request + result
 *  to localStorage with a 1-hour TTL so the page comes back the way the
 *  user left it as long as the data is still fresh. */
const SESSION_LS_KEY = "pl_last_session_v1";
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

interface PersistedSession {
  ts: number;
  req: OptimizeRequest;
  result: OptimizeResponse;
}

function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as PersistedSession;
    if (!obj.ts || !obj.req || !obj.result) return null;
    if (Date.now() - obj.ts > SESSION_TTL_MS) return null;
    return obj;
  } catch {
    return null;
  }
}

export default function PortfolioBuilder() {
  // Pull persisted session ONCE on first mount. If valid + fresh, prefill
  // both `req` and `result` so the user lands on their last portfolio
  // instead of an empty form.
  const persisted = typeof window !== "undefined" ? loadPersistedSession() : null;

  const [req, setReq] = useState<OptimizeRequest>(() =>
    persisted
      ? { ...persisted.req, exclude_symbols: loadStoredExclusions() }
      : {
          ...DEFAULT_REQ,
          // Hydrate from localStorage on first mount so the user's permanent
          // exclusion preferences (e.g. "always skip USDTRY/EURTRY") survive
          // browser refresh.
          exclude_symbols: loadStoredExclusions(),
        }
  );
  const [result, setResult] = useState<OptimizeResponse | null>(
    persisted ? persisted.result : null,
  );
  const [busy, setBusy] = useState(false);
  // Full error object (axios error or thrown). BuildErrorCard parses the
  // structured `{code, context}` shape from the backend; the `errorMessage`
  // helper still works as a fallback for the save flow.
  const [error, setError] = useState<unknown>(null);
  const [saveName, setSaveName] = useState("");
  const [saveNotes, setSaveNotes] = useState("");
  const [savePublic, setSavePublic] = useState(false);
  const [saving, setSaving] = useState(false);
  // Symbol → human label cache for exclusion chips. We keep a separate map
  // (not just `req.exclude_symbols`) so a chip can show "Texas Pacific Land"
  // even though the asset has already left `result.weights` after the rerun.
  const [excludedLabels, setExcludedLabels] = useState<Record<string, string>>({});
  // Currently-opened price-history modal symbol (null = closed). Clicking a
  // bar in the WeightsBar sets this; the modal closes via Esc / backdrop / X.
  const [historySymbol, setHistorySymbol] = useState<string | null>(null);
  const { user, refresh } = useAuth();
  const t = useT();
  const nav = useNavigate();
  const cfgFeatures = useConfig((s) => s.config?.features);
  // Edition-driven UI simplifications (all false / off in the full build).
  const hideSwapsUi = cfgFeatures?.hide_swaps_ui ?? false;
  const forceSwaps = cfgFeatures?.force_swaps ?? false;
  const hideMinVariance = cfgFeatures?.hide_min_variance ?? false;
  const aiNaming = cfgFeatures?.ai_strategy_naming ?? false;
  // Libertex gift build: the advanced panel is collapsed by default (curated
  // defaults, hidden covariance picker) so casual users don't fiddle.
  const advancedCollapsed = cfgFeatures?.advanced_collapsed ?? false;
  const hideCovMethod = cfgFeatures?.hide_cov_method ?? false;
  const hideSparsify = cfgFeatures?.hide_sparsify ?? false;
  // Advanced-panel expand/collapse. Only shown as collapsible in editions that
  // set `advanced_collapsed`; the full build always renders it open.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function update<K extends keyof OptimizeRequest>(k: K, v: OptimizeRequest[K]) {
    setReq((r) => ({ ...r, [k]: v }));
  }

  // When the edition forces swaps on, keep the request in sync so the saved
  // portfolio + UI reflect it (the backend enforces it regardless).
  useEffect(() => {
    if (forceSwaps && !req.apply_swaps) update("apply_swaps", true);
  }, [forceSwaps, req.apply_swaps]);

  // If Min Variance is hidden (libertex) but a persisted session had it
  // selected, fall back to the AI (max-Sharpe) strategy.
  useEffect(() => {
    if (hideMinVariance && req.portfolio_type === "min_variance") {
      update("portfolio_type", "max_sharpe");
    }
  }, [hideMinVariance, req.portfolio_type]);

  // Libertex gift build ships a curated set of advanced defaults (full 1500
  // universe, 25y history, aggressive 5% sparsification) so the collapsed
  // panel is already tuned. Applied once, on a fresh form only — a restored
  // session keeps whatever the user last chose. Config loads async, so this
  // fires when `advanced_collapsed` flips true.
  const appliedGiftDefaults = useRef(false);
  useEffect(() => {
    if (appliedGiftDefaults.current || !advancedCollapsed) return;
    appliedGiftDefaults.current = true;
    if (persisted) return; // respect the restored session
    setReq((r) => ({
      ...r,
      max_assets_in_universe: 1500,
      history_years: 25,
      sparsify: true,
      sparsify_threshold: 0.05,
    }));
  }, [advancedCollapsed]);

  // The `override` argument lets us re-run with a freshly-computed exclusion
  // list without waiting for React's state batch to flush. `setReq` + reading
  // `req` in the same tick would still hit the stale value.
  async function runOptimize(override?: Partial<OptimizeRequest>) {
    const payload = override ? { ...req, ...override } : req;
    setBusy(true); setError(null);
    // Scroll the page to the top so the user immediately sees the progress
    // visualisation kick off (on desktop the progress card sits at the top
    // of the right column; on a phone the results are below the form).
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    try {
      const r = await portfoliosApi.optimize(payload);
      setResult(r);
      if (!saveName) {
        const map: Record<string, string> = {
          min_variance: t.builder.strategy_min_variance,
          max_sharpe: t.builder.strategy_max_sharpe,
          target_return: t.builder.strategy_target_return,
          target_risk: t.builder.strategy_target_risk,
        };
        setSaveName(`${map[payload.portfolio_type]} — ${new Date().toLocaleDateString()}`);
      }
    } catch (e) {
      // Keep the FULL error object so BuildErrorCard can parse structured
      // {code, context} from the backend's 422 response.
      setError(e);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  /** Add a symbol to `exclude_symbols` (if not already there) and trigger an
   *  immediate re-optimization. The chip label is captured from the current
   *  result so the panel keeps showing the human name after rerun. */
  function excludeAndRerun(symbol: string) {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    const cur = req.exclude_symbols ?? [];
    if (cur.includes(sym)) return;
    // Cache the asset's display name from the current result (if any) so the
    // chip can render "AAPL — Apple Inc." instead of just the ticker.
    const w = result?.weights?.find((x) => (x.symbol || "").toUpperCase() === sym);
    if (w && w.name && w.name !== w.symbol) {
      setExcludedLabels((m) => ({ ...m, [sym]: w.name }));
    }
    const next = [...cur, sym];
    setReq((r) => ({ ...r, exclude_symbols: next }));
    void runOptimize({ exclude_symbols: next });
  }

  /** Restore a previously-excluded symbol and rerun. */
  function restoreAndRerun(symbol: string) {
    const sym = symbol.trim().toUpperCase();
    const cur = req.exclude_symbols ?? [];
    if (!cur.includes(sym)) return;
    const next = cur.filter((s) => s !== sym);
    setReq((r) => ({ ...r, exclude_symbols: next }));
    setExcludedLabels((m) => {
      const { [sym]: _drop, ...rest } = m;
      return rest;
    });
    void runOptimize({ exclude_symbols: next });
  }

  /** Wipe all exclusions and rerun (if there's a current result). */
  function clearExclusionsAndRerun() {
    const cur = req.exclude_symbols ?? [];
    if (cur.length === 0) return;
    setReq((r) => ({ ...r, exclude_symbols: [] }));
    setExcludedLabels({});
    if (result) void runOptimize({ exclude_symbols: [] });
  }

  /** Staging-only add: pushes a ticker into `exclude_symbols` without
   *  triggering a re-optimisation. Used by the sidebar input so the user can
   *  set up "always skip these" exclusions before the first build. If a
   *  portfolio is already on screen we ALSO rerun — same UX as `excludeAndRerun`.
   *
   *  IMPORTANT: when called repeatedly in the same tick (e.g. for each token
   *  in a comma-separated input), the React state from the closure is stale.
   *  We therefore use the functional setter — each call sees the latest list. */
  function stageExclude(symbolRaw: string) {
    const sym = (symbolRaw || "").trim().toUpperCase();
    if (!sym) return;
    const w = result?.weights?.find((x) => (x.symbol || "").toUpperCase() === sym);
    if (w && w.name && w.name !== w.symbol) {
      setExcludedLabels((m) => (m[sym] ? m : { ...m, [sym]: w.name }));
    }
    let nextList: string[] | null = null;
    setReq((r) => {
      const cur = r.exclude_symbols ?? [];
      if (cur.includes(sym)) {
        nextList = cur;
        return r;
      }
      nextList = [...cur, sym];
      return { ...r, exclude_symbols: nextList };
    });
    // Only auto-rerun if a portfolio is already showing. Pre-first-run the
    // user explicitly hits "Create" themselves.
    if (result && nextList) void runOptimize({ exclude_symbols: nextList });
  }

  /** Remove a staged exclusion without rerunning (sidebar chip ×). */
  function unstageExclude(symbolRaw: string) {
    const sym = (symbolRaw || "").trim().toUpperCase();
    const cur = req.exclude_symbols ?? [];
    if (!cur.includes(sym)) return;
    const next = cur.filter((s) => s !== sym);
    setReq((r) => ({ ...r, exclude_symbols: next }));
    setExcludedLabels((m) => {
      const { [sym]: _drop, ...rest } = m;
      return rest;
    });
    if (result) void runOptimize({ exclude_symbols: next });
  }

  // Persist exclusion list to localStorage on every change so user
  // preferences survive page reloads / re-logins.
  useEffect(() => {
    try {
      localStorage.setItem(EXCLUDE_LS_KEY, JSON.stringify(req.exclude_symbols ?? []));
    } catch {
      /* quota or private-mode failure — fine to ignore, in-memory state still works */
    }
  }, [req.exclude_symbols]);

  // Mirror the most recent (req, result) to localStorage so that a tab
  // discard (iOS lock-screen!) or accidental refresh restores the user's
  // last portfolio instead of dropping them on an empty form. We deliberately
  // skip persisting while a request is in flight — partially-applied state
  // would just confuse the next mount. 1-hour TTL keeps the data fresh.
  useEffect(() => {
    if (busy || !result) return;
    try {
      const payload: PersistedSession = { ts: Date.now(), req, result };
      localStorage.setItem(SESSION_LS_KEY, JSON.stringify(payload));
    } catch {
      /* quota / private mode — ignore */
    }
  }, [result, req, busy]);

  // Controlled value of the "add exclusion" input.
  const [excludeInput, setExcludeInput] = useState("");
  const excludeInputRef = useRef<HTMLInputElement | null>(null);
  function submitExcludeInput() {
    const v = excludeInput.trim();
    if (!v) return;
    // Allow comma-separated input: "USDTRY, EURTRY, GBPTRY"
    v.split(/[,\s]+/).filter(Boolean).forEach(stageExclude);
    setExcludeInput("");
    excludeInputRef.current?.focus();
  }

  // Initial capital change shouldn't trigger re-optimization (only re-display)
  const displayResult = useMemo(() => {
    if (!result) return null;
    const ratio = result.initial_capital > 0 ? req.initial_capital / result.initial_capital : 1;
    const mc = result.monte_carlo ?? ({} as any);
    const pct = mc.percentiles ?? {};
    const safeArr = (a: number[] | undefined): number[] => (Array.isArray(a) ? a : []);
    const safeNum = (n: number | undefined, d = 0): number => (typeof n === "number" && Number.isFinite(n) ? n : d);
    return {
      ...result,
      initial_capital: req.initial_capital,
      weights: (result.weights ?? []).map((w) => ({ ...w, amount_usd: w.amount_usd * ratio })),
      monte_carlo: {
        ...mc,
        n_simulations: safeNum(mc.n_simulations, 0),
        n_months: safeNum(mc.n_months, 12),
        initial_capital: req.initial_capital,
        expected_value: safeNum(mc.expected_value) * ratio,
        expected_return_pct: safeNum(mc.expected_return_pct),
        months: safeArr(mc.months),
        median_path: safeArr(mc.median_path).map((v) => v * ratio),
        p5_path: safeArr(mc.p5_path).map((v) => v * ratio),
        p25_path: safeArr(mc.p25_path).map((v) => v * ratio),
        p75_path: safeArr(mc.p75_path).map((v) => v * ratio),
        p95_path: safeArr(mc.p95_path).map((v) => v * ratio),
        paths_sample: (Array.isArray(mc.paths_sample) ? mc.paths_sample : []).map(
          (p: number[] | undefined) => safeArr(p).map((v) => v * ratio),
        ),
        percentiles: {
          p5: safeNum(pct.p5) * ratio,
          p25: safeNum(pct.p25) * ratio,
          p50: safeNum(pct.p50) * ratio,
          p75: safeNum(pct.p75) * ratio,
          p95: safeNum(pct.p95) * ratio,
        },
        var_95: safeNum(mc.var_95) * ratio,
        cvar_95: safeNum(mc.cvar_95) * ratio,
      },
    };
  }, [result, req.initial_capital]);

  async function save() {
    if (!result || !saveName.trim()) return;
    setSaving(true); setError(null);
    try {
      const saved = await portfoliosApi.savePortfolio({
        name: saveName.trim(),
        notes: saveNotes || null,
        is_public: savePublic,
        optimize_request: req,
        optimize_result: result,
      });
      await refresh();
      nav(`/portfolio/${saved.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!user && user.quota?.can_generate !== false && !!result;
  const quotaInfo = user?.quota;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-2 md:gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight neon-text inline-block">{t.builder.page_title}</h1>
          <p className="text-xs sm:text-base text-text-muted mt-1">{t.builder.page_subtitle}</p>
        </div>
        {quotaInfo && user?.role !== "admin" && (
          <div className="text-xs sm:text-sm text-text-muted">
            {t.builder.today_used}: <span className="text-cyan font-mono font-semibold">
              {quotaInfo.today_used}{quotaInfo.today_limit !== null ? ` / ${(quotaInfo.today_limit + (quotaInfo.bonus_today || 0))}` : ""}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* LEFT: form */}
        <div className="lg:col-span-4 space-y-4">
          <Section
            title={t.builder.strategy_title}
            subtitle={t.builder.strategy_subtitle}
            help={
              <HelpTip title={t.builder.strategy_help_title} width={360}>
                <ul className="space-y-1.5">
                  <li><b className="text-cyan">{aiNaming ? t.builder.strategy_ai_choice : t.builder.strategy_max_sharpe}</b> — {t.builder.strategy_help_max_sharpe}</li>
                  {!hideMinVariance && (
                    <li><b className="text-cyan">{t.builder.strategy_min_variance}</b> — {t.builder.strategy_help_min_variance}</li>
                  )}
                  <li><b className="text-cyan">{t.builder.strategy_target_return}</b> — {t.builder.strategy_help_target_return}</li>
                  <li><b className="text-cyan">{t.builder.strategy_target_risk}</b> — {t.builder.strategy_help_target_risk}</li>
                </ul>
              </HelpTip>
            }
          >
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: "max_sharpe", label: aiNaming ? t.builder.strategy_ai_choice : t.builder.strategy_max_sharpe, hint: t.builder.strategy_btn_hint_max_sharpe },
                { v: "min_variance", label: t.builder.strategy_min_variance, hint: t.builder.strategy_btn_hint_min_variance },
                { v: "target_return", label: t.builder.strategy_target_return, hint: t.builder.strategy_btn_hint_target_return },
                { v: "target_risk", label: t.builder.strategy_target_risk, hint: t.builder.strategy_btn_hint_target_risk },
              ].filter((b) => !(hideMinVariance && b.v === "min_variance")).map((b) => (
                <button
                  key={b.v}
                  onClick={() => update("portfolio_type", b.v as any)}
                  title={b.hint}
                  className={`toggle-btn px-3 py-2.5 ${
                    req.portfolio_type === b.v ? "toggle-btn-on" : "toggle-btn-idle"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </Section>

          {hideSwapsUi ? (
            /* Libertex build: swaps are always applied and the toggle is
               hidden. Keep a small notice so the user knows the portfolio
               already nets out overnight financing. */
            <div className="card p-3 sm:p-4 border-cyan/25 bg-cyan/5 flex items-start gap-2.5">
              <Check className="w-4 h-4 text-cyan mt-0.5 shrink-0" />
              <div className="text-xs sm:text-sm text-text-muted leading-relaxed">
                {t.builder.swaps_included_note}
                <HelpTip title={t.builder.swaps_help_title} width={360}>
                  {t.builder.swaps_help_body}
                </HelpTip>
              </div>
            </div>
          ) : (
            <Section
              title={t.builder.swaps_title}
              subtitle={
                req.apply_swaps
                  ? t.builder.swaps_subtitle_on
                  : t.builder.swaps_subtitle_off
              }
              help={
                <HelpTip title={t.builder.swaps_help_title} width={380}>
                  {t.builder.swaps_help_body}
                </HelpTip>
              }
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-text-muted leading-relaxed">
                  {req.apply_swaps
                    ? t.builder.swaps_status_on
                    : t.builder.swaps_status_off}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={req.apply_swaps ?? false}
                  onClick={() => update("apply_swaps", !req.apply_swaps)}
                  className={`shrink-0 inline-flex items-center h-7 w-12 rounded-full border transition-colors hover:border-cyan/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40 ${
                    req.apply_swaps
                      ? "bg-cyan/20 border-cyan justify-end"
                      : "bg-bg-elevated border-border justify-start"
                  }`}
                >
                  <span
                    className={`mx-1 w-5 h-5 rounded-full transition-colors ${
                      req.apply_swaps ? "bg-cyan shadow-glow" : "bg-text-dim"
                    }`}
                  />
                </button>
              </div>
            </Section>
          )}

          <Section
            title={t.builder.capital_title}
            subtitle={t.builder.capital_subtitle}
            help={
              <HelpTip title={t.builder.capital_help_title}>
                {t.builder.capital_help_body}
              </HelpTip>
            }
          >
            <div className="flex items-center gap-3">
              <div className="text-2xl font-mono font-bold text-cyan">$</div>
              <input
                type="number"
                min={1}
                step={100}
                className="input"
                value={req.initial_capital}
                onChange={(e) => update("initial_capital", Number(e.target.value))}
              />
            </div>
            <div className="flex gap-2 mt-3 flex-wrap">
              {[1000, 5000, 10000, 25000, 100000].map((amt) => (
                <button key={amt} onClick={() => update("initial_capital", amt)}
                  className="px-2.5 py-1 text-xs rounded-md border border-border hover:border-cyan hover:text-cyan transition-colors">
                  ${amt.toLocaleString()}
                </button>
              ))}
            </div>
          </Section>

          {req.portfolio_type === "target_return" && (
            <Section
              title={t.builder.target_return_title}
              subtitle={t.builder.target_return_subtitle}
              help={
                <HelpTip title={t.builder.target_return_help_title}>
                  {t.builder.target_return_help_body}
                </HelpTip>
              }
            >
              {/* Big-readout pattern, matches Target Risk for consistency. */}
              <div className="flex items-baseline gap-2 mb-3">
                <div className="font-mono text-lg font-bold text-cyan">
                  {fmtPct(req.target_return ?? 0.15)}
                </div>
                <div className="text-xs text-text-dim uppercase tracking-wider">
                  {t.builder.target_return_unit}
                </div>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.50}
                step={0.01}
                value={req.target_return ?? 0.15}
                onChange={(e) => update("target_return", Number(e.target.value))}
                className="w-full h-2"
              />
              <div className="flex justify-between text-[11px] text-text-muted mt-1">
                <span>5%</span><span>25%</span><span>50%</span>
              </div>
            </Section>
          )}

          {req.portfolio_type === "target_risk" && (
            <Section
              title={t.builder.target_risk_title}
              subtitle={t.builder.target_risk_subtitle}
              help={
                <HelpTip title={t.builder.target_risk_help_title}>
                  {t.builder.target_risk_help_body}
                </HelpTip>
              }
            >
              {/* Prominent value readout. The slider track on its own is
                  only ~16 px tall; users miss it. Show the current % in
                  big cyan numerics so the value is the focus, not the
                  control. Falls back to "auto" when target_risk = null. */}
              <div className="flex items-baseline gap-2 mb-3">
                <div className="font-mono text-lg font-bold text-cyan">
                  {req.target_risk !== null && req.target_risk !== undefined
                    ? fmtPct(req.target_risk)
                    : t.builder.target_risk_subtitle_auto}
                </div>
                <div className="text-xs text-text-dim uppercase tracking-wider">
                  {t.builder.target_risk_unit}
                </div>
              </div>
              <input
                type="range"
                min={0.03}
                max={0.60}
                step={0.01}
                value={req.target_risk ?? 0.20}
                onChange={(e) => update("target_risk", Number(e.target.value))}
                className="w-full h-2"
              />
              <div className="flex justify-between text-[11px] text-text-muted mt-1">
                <span>3%</span><span>30%</span><span>60%</span>
              </div>
              <button
                onClick={() => update("target_risk", null)}
                className="mt-3 text-xs text-cyan hover:underline"
              >
                {t.builder.target_risk_auto_link}
              </button>
            </Section>
          )}

          {/* Risk Tolerance only matters when the user picked Target Risk AND
              didn't set a numeric target — the optimiser uses it as a
              Conservative / Moderate / Aggressive fallback for the volatility
              target. For Min Variance, Max Sharpe and Target Return strategies
              this control is a no-op, so hiding it removes visual clutter. */}
          {req.portfolio_type === "target_risk" && (
            <Section
              title={t.builder.risk_tolerance_title}
              subtitle={t.builder.risk_tolerance_subtitle}
              help={
                <HelpTip title={t.builder.risk_tolerance_help_title} width={340}>
                  {t.builder.risk_tolerance_help_lead}
                  <ul className="mt-1.5 space-y-0.5">
                    <li><b className="text-magenta">{t.builder.rt_conservative}</b> — {t.builder.risk_tolerance_help_conservative}</li>
                    <li><b className="text-magenta">{t.builder.rt_moderate}</b> — {t.builder.risk_tolerance_help_moderate}</li>
                    <li><b className="text-magenta">{t.builder.rt_aggressive}</b> — {t.builder.risk_tolerance_help_aggressive}</li>
                  </ul>
                  {t.builder.risk_tolerance_help_note}
                </HelpTip>
              }
            >
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { v: "conservative", label: t.builder.rt_conservative, hint: t.builder.rt_hint_conservative },
                    { v: "moderate", label: t.builder.rt_moderate, hint: t.builder.rt_hint_moderate },
                    { v: "aggressive", label: t.builder.rt_aggressive, hint: t.builder.rt_hint_aggressive },
                  ] as const
                ).map(({ v, label, hint }) => (
                  <button key={v}
                    onClick={() => update("risk_tolerance", v)}
                    title={hint}
                    className={`toggle-btn px-2 py-2 rounded-lg text-xs ${
                      req.risk_tolerance === v ? "toggle-btn-on-alt" : "toggle-btn-idle-alt"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section
            title={t.builder.categories_title}
            subtitle={t.builder.categories_subtitle}
            help={
              <HelpTip title={t.builder.categories_help_title} width={340}>
                {t.builder.categories_help_body}
              </HelpTip>
            }
            action={
              <div className="flex gap-1">
                <button
                  onClick={() => update("categories", [...ALL_CATEGORIES])}
                  className="text-[10px] px-2 py-0.5 rounded-md border border-border text-text-muted hover:text-cyan hover:border-cyan transition-colors"
                >
                  {t.builder.categories_select_all}
                </button>
                <button
                  onClick={() => update("categories", [])}
                  className="text-[10px] px-2 py-0.5 rounded-md border border-border text-text-muted hover:text-red hover:border-red transition-colors"
                >
                  {t.builder.categories_clear_all}
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-3 gap-2">
              {ALL_CATEGORIES.map((cat) => {
                const selected = (req.categories ?? []).includes(cat);
                const labelKey = `cat_${cat}` as
                  | "cat_stock" | "cat_index" | "cat_commodity"
                  | "cat_crypto" | "cat_fx" | "cat_etf";
                return (
                  <button
                    key={cat}
                    onClick={() => {
                      setReq((r) => {
                        const cur = r.categories ?? [...ALL_CATEGORIES];
                        const next = cur.includes(cat)
                          ? cur.filter((c) => c !== cat)
                          : [...cur, cat];
                        return { ...r, categories: next };
                      });
                    }}
                    className={`toggle-btn px-2 py-2 rounded-lg text-xs capitalize ${
                      selected ? "toggle-btn-on" : "toggle-btn-idle"
                    }`}
                  >
                    {t.builder[labelKey]}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section
            title={t.builder.exclude_section_title}
            subtitle={
              (req.exclude_symbols?.length ?? 0) === 0
                ? t.builder.exclude_section_subtitle_empty
                : tpl(t.builder.exclude_section_subtitle, { n: req.exclude_symbols!.length })
            }
            help={
              <HelpTip title={t.builder.exclude_section_help_title} width={360}>
                {t.builder.exclude_section_help_body}
              </HelpTip>
            }
            action={
              (req.exclude_symbols?.length ?? 0) > 0 ? (
                <button
                  onClick={clearExclusionsAndRerun}
                  className="text-[10px] px-2 py-0.5 rounded-md border border-border text-text-muted hover:text-red hover:border-red transition-colors"
                >
                  {t.builder.excluded_clear_all}
                </button>
              ) : null
            }
          >
            <div className="flex gap-2">
              <input
                ref={excludeInputRef}
                type="text"
                value={excludeInput}
                onChange={(e) => setExcludeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitExcludeInput();
                  }
                }}
                placeholder={t.builder.exclude_input_placeholder}
                spellCheck={false}
                autoCapitalize="characters"
                className="input font-mono flex-1"
              />
              <button
                type="button"
                onClick={submitExcludeInput}
                disabled={!excludeInput.trim()}
                aria-label={t.builder.exclude_add_button}
                className="px-3 rounded-xl bg-cyan/10 border border-cyan/40 text-cyan hover:bg-cyan/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {(req.exclude_symbols?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {req.exclude_symbols!.map((sym) => {
                  const label = excludedLabels[sym];
                  return (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => unstageExclude(sym)}
                      title={label ? `${sym} · ${label}` : sym}
                      className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-bg-elevated border border-border hover:border-red hover:bg-red/10 text-xs font-mono transition-colors"
                    >
                      <Ban className="w-3 h-3 text-red" />
                      <span className="font-semibold text-cyan">{sym}</span>
                      <X className="w-3 h-3 text-text-dim ml-0.5" />
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          <Section
            title={advancedCollapsed ? t.builder.advanced_settings_title : t.builder.advanced_title}
            subtitle={t.builder.advanced_subtitle}
            help={
              <HelpTip title={t.builder.advanced_help_title}>
                {t.builder.advanced_help_body}
              </HelpTip>
            }
            action={
              advancedCollapsed ? (
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((o) => !o)}
                  aria-expanded={advancedOpen}
                  aria-label={t.builder.advanced_settings_title}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-border text-text-muted hover:text-cyan hover:border-cyan transition-colors"
                >
                  {advancedOpen ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                </button>
              ) : undefined
            }
          >
            {(!advancedCollapsed || advancedOpen) && (
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs uppercase tracking-wide text-text-muted inline-flex items-center">
                    {t.builder.min_history_label}
                    <HelpTip title={t.builder.min_history_help_title} width={340}>
                      {t.builder.min_history_help_body}
                    </HelpTip>
                  </label>
                  <span className="font-mono text-cyan">{req.min_history_years}</span>
                </div>
                <input type="range" min={3} max={15} step={1}
                  value={req.min_history_years}
                  onChange={(e) => update("min_history_years", Number(e.target.value))}
                  className="w-full" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs uppercase tracking-wide text-text-muted inline-flex items-center">
                    {t.builder.universe_size_label}
                    <HelpTip title={t.builder.universe_size_help_title} width={400}>
                      {t.builder.universe_size_help_body}
                    </HelpTip>
                  </label>
                  <span className="font-mono text-cyan">{req.max_assets_in_universe}</span>
                </div>
                <input type="range" min={50} max={1500} step={50}
                  value={Math.min(req.max_assets_in_universe, 1500)}
                  onChange={(e) => update("max_assets_in_universe", Number(e.target.value))}
                  className="w-full" />
                <div className="flex justify-between text-[11px] text-text-muted mt-1">
                  <span>50</span><span>500</span><span>1500</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs uppercase tracking-wide text-text-muted inline-flex items-center">
                    {t.builder.max_weight_label}
                    <HelpTip title={t.builder.max_weight_help_title} width={380}>
                      {t.builder.max_weight_help_body}
                    </HelpTip>
                  </label>
                  <span className="font-mono text-cyan">
                    {req.max_weight_per_asset !== undefined && req.max_weight_per_asset < 1
                      ? fmtPct(req.max_weight_per_asset)
                      : t.builder.max_weight_off}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.10}
                  max={1.00}
                  step={0.05}
                  value={req.max_weight_per_asset ?? 0.35}
                  onChange={(e) => update("max_weight_per_asset", Number(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-[11px] text-text-muted mt-1">
                  <span>10%</span>
                  <span>35%</span>
                  <span>{t.builder.max_weight_off}</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs uppercase tracking-wide text-text-muted inline-flex items-center">
                    {t.builder.drop_from_peak_label}
                    <HelpTip title={t.builder.drop_from_peak_help_title} width={380}>
                      {t.builder.drop_from_peak_help_body}
                    </HelpTip>
                  </label>
                  <span className="font-mono text-cyan">
                    {(req.max_drop_from_peak_pct ?? 0.60) >= 1.0
                      ? t.builder.drop_from_peak_off
                      : fmtPct(req.max_drop_from_peak_pct ?? 0.60)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.30}
                  max={1.00}
                  step={0.05}
                  value={req.max_drop_from_peak_pct ?? 0.60}
                  onChange={(e) => update("max_drop_from_peak_pct", Number(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-[11px] text-text-muted mt-1">
                  <span>30%</span>
                  <span>60%</span>
                  <span>{t.builder.drop_from_peak_off}</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs uppercase tracking-wide text-text-muted inline-flex items-center">
                    {t.builder.history_window_label}
                    <HelpTip title={t.builder.history_window_help_title} width={340}>
                      {t.builder.history_window_help_body}
                    </HelpTip>
                  </label>
                  <span className="font-mono text-cyan">{req.history_years}</span>
                </div>
                <input type="range" min={5} max={25} step={1}
                  value={req.history_years}
                  onChange={(e) => update("history_years", Number(e.target.value))}
                  className="w-full" />
              </div>
              {!hideCovMethod && (
              <div>
                <label className="block text-xs uppercase tracking-wide text-text-muted mb-1.5 inline-flex items-center">
                  {t.builder.cov_method_label}
                  <HelpTip title={t.builder.cov_method_help_title} width={400}>
                    {t.builder.cov_method_help_lead}
                    <ul className="mt-1.5 space-y-1">
                      <li><b className="text-cyan">Ledoit-Wolf</b> — {t.builder.cov_method_help_lw}</li>
                      <li><b className="text-cyan">Sample</b> — {t.builder.cov_method_help_sample}</li>
                      <li><b className="text-cyan">EWMA</b> — {t.builder.cov_method_help_ewma}</li>
                    </ul>
                  </HelpTip>
                </label>
                <select
                  className="input"
                  value={req.cov_method}
                  onChange={(e) => update("cov_method", e.target.value as any)}
                >
                  <option value="ledoit_wolf">{t.builder.cov_method_lw}</option>
                  <option value="sample">{t.builder.cov_method_sample}</option>
                  <option value="ewma">{t.builder.cov_method_ewma}</option>
                </select>
              </div>
              )}
              {!hideSparsify && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs uppercase tracking-wide text-text-muted inline-flex items-center">
                    {t.builder.sparsification_label} {fmtPct(req.sparsify_threshold)}
                    <HelpTip title={t.builder.sparsification_help_title} width={360}>
                      {t.builder.sparsification_help_body}
                    </HelpTip>
                  </label>
                  <button onClick={() => update("sparsify", !req.sparsify)}
                    className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${req.sparsify ? "bg-cyan/20 text-cyan hover:bg-cyan/30" : "bg-bg-elevated text-text-dim hover:text-text"}`}>
                    {req.sparsify ? "ON" : "OFF"}
                  </button>
                </div>
                <input type="range" min={0} max={0.05} step={0.001}
                  value={req.sparsify_threshold}
                  onChange={(e) => update("sparsify_threshold", Number(e.target.value))}
                  className="w-full" />
              </div>
              )}
            </div>
            )}
          </Section>

          {/* Big primary action button */}
          <button
            onClick={() => void runOptimize()}
            disabled={busy}
            className="w-full px-4 sm:px-6 py-3 sm:py-4 rounded-2xl font-semibold text-bg
              bg-gradient-to-r from-cyan to-magenta shadow-glow
              transition-[transform,box-shadow,filter] duration-200 ease-out
              hover:-translate-y-px hover:shadow-glow-strong hover:brightness-110
              active:translate-y-0 active:scale-[0.98] active:brightness-100
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg
              disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:brightness-100
              inline-flex items-center justify-center gap-2 sm:gap-3 text-base sm:text-lg sticky bottom-2 sm:bottom-4 z-10"
          >
            {busy ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t.builder.optimizing}
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                {result ? t.builder.rerun_optimization : t.builder.create_portfolio}
              </>
            )}
          </button>
        </div>

        {/* RIGHT: results */}
        <div className="lg:col-span-8 space-y-6 min-h-[400px]">
          {error && <BuildErrorCard error={error} onRetry={() => void runOptimize()} />}

          {busy && !displayResult && <OptimizeProgress busy={busy} />}

          {!busy && !displayResult && !error && (
            <div className="card-glow p-12 flex flex-col items-center justify-center gap-4 text-center min-h-[460px] relative overflow-hidden">
              <div className="absolute -top-32 -right-32 w-64 h-64 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-20 -left-20 w-48 h-48 rounded-full bg-magenta/10 blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-neon-gradient flex items-center justify-center shadow-glow mb-4">
                  <Target className="w-8 h-8 text-bg" />
                </div>
                <h2 className="text-2xl font-bold neon-text mb-2">{t.builder.placeholder_title}</h2>
                <p className="text-text-muted max-w-md">
                  {t.builder.placeholder_body_pre}{" "}
                  <span className="text-cyan font-semibold">{t.builder.placeholder_body_em}</span>{" "}
                  {t.builder.placeholder_body_post}
                </p>
                <div className="mt-6 grid grid-cols-2 gap-3 text-left text-sm">
                  <div className="card p-3">
                    <div className="text-[10px] uppercase tracking-widest text-text-dim">{t.builder.placeholder_default_strategy}</div>
                    <div className="text-cyan font-semibold mt-1 capitalize">{req.portfolio_type.replace("_", " ")}</div>
                  </div>
                  <div className="card p-3">
                    <div className="text-[10px] uppercase tracking-widest text-text-dim">{t.builder.placeholder_capital}</div>
                    <div className="text-cyan font-semibold mt-1">{fmtUSD(req.initial_capital, 0)}</div>
                  </div>
                  <div className="card p-3">
                    <div className="text-[10px] uppercase tracking-widest text-text-dim">{t.builder.placeholder_history}</div>
                    <div className="text-cyan font-semibold mt-1">{tpl(t.builder.placeholder_history_value, { years: req.history_years })}</div>
                  </div>
                  <div className="card p-3">
                    <div className="text-[10px] uppercase tracking-widest text-text-dim">{t.builder.placeholder_universe}</div>
                    <div className="text-cyan font-semibold mt-1">{tpl(t.builder.placeholder_universe_value, { n: req.max_assets_in_universe })}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {displayResult && (
            <>
              {/* Compact progress ribbon during a re-optimisation. The
                  previous result stays on screen below so the user can
                  compare before/after. */}
              {busy && <OptimizeProgress busy={busy} compact />}
              <ConcentrationWarning
                result={displayResult}
                maxWeightPerAsset={req.max_weight_per_asset}
                sparsifyThreshold={req.sparsify_threshold}
                minHistoryYears={req.min_history_years}
              />
              <div className="card-glow p-4 sm:p-6">
                {displayResult.trace_id && (
                  <div className="flex items-center justify-end mb-3 pb-3 border-b border-border">
                    <button
                      type="button"
                      onClick={() => void portfoliosApi.downloadTrace(displayResult.trace_id!)}
                      title={t.builder.trace_download_title}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-cyan hover:border-cyan transition-colors"
                    >
                      <Save className="w-3.5 h-3.5" /> {t.builder.trace_download_label}
                    </button>
                  </div>
                )}
                <PortfolioMetrics data={displayResult} />
              </div>

              {(() => {
                const visible = sparsifyForDisplay(displayResult.weights, 0.01);
                const hidden = displayResult.weights.length - visible.length;
                const subtitle = hidden > 0
                  ? tpl(t.builder.aa_subtitle_filtered, { visible: visible.length, hidden })
                  : tpl(t.builder.aa_subtitle_full, { visible: visible.length, universe: displayResult.universe_size });
                return (
                  <Section
                    title={t.builder.asset_allocation}
                    subtitle={subtitle}
                    help={
                      <HelpTip title={t.builder.aa_help_title} width={380}>
                        {t.builder.aa_help_body}
                      </HelpTip>
                    }
                    action={
                      <span className="text-[11px] text-text-dim italic">{t.asset_modal.click_hint}</span>
                    }
                  >
                    {/* Pie chart used to live next to this bar — it conveyed
                        the same information (weight per asset) and just
                        halved the available width. The bar gets the full
                        section now so company names breathe. */}
                    <WeightsBar weights={visible} onBarClick={setHistorySymbol} />
                    <div className="mt-6">
                      <AllocationTable weights={visible} onExclude={excludeAndRerun} />
                    </div>
                  </Section>
                );
              })()}

              {(req.exclude_symbols?.length ?? 0) > 0 && (
                <Section
                  title={t.builder.excluded_title}
                  subtitle={
                    (req.exclude_symbols!.length === 1
                      ? tpl(t.builder.excluded_subtitle_one, { n: 1 })
                      : tpl(t.builder.excluded_subtitle_many, { n: req.exclude_symbols!.length }))
                  }
                  action={
                    <button
                      onClick={clearExclusionsAndRerun}
                      disabled={busy}
                      className="text-[10px] px-2 py-0.5 rounded-md border border-border text-text-muted hover:text-cyan hover:border-cyan transition-colors disabled:opacity-50"
                    >
                      {t.builder.excluded_clear_all}
                    </button>
                  }
                >
                  <div className="flex flex-wrap gap-2">
                    {req.exclude_symbols!.map((sym) => {
                      const label = excludedLabels[sym];
                      return (
                        <button
                          key={sym}
                          type="button"
                          onClick={() => restoreAndRerun(sym)}
                          disabled={busy}
                          title={t.builder.exclude_button_title}
                          className="group inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-bg-elevated border border-border hover:border-red hover:bg-red/10 text-sm transition-colors disabled:opacity-50"
                        >
                          <Ban className="w-3.5 h-3.5 text-red" />
                          <span className="font-mono font-semibold text-cyan">{sym}</span>
                          {label && <span className="text-text-muted text-xs">· {label}</span>}
                          <X className="w-3.5 h-3.5 text-text-dim group-hover:text-red ml-1" />
                        </button>
                      );
                    })}
                  </div>
                </Section>
              )}

              <Section
                title={t.builder.efficient_frontier_title}
                subtitle={t.builder.efficient_frontier_subtitle}
                help={
                  <HelpTip title={t.builder.efficient_frontier_help_title} width={400}>
                    {t.builder.efficient_frontier_help_body}
                  </HelpTip>
                }
                action={
                  <div className="text-xs text-text-muted flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-magenta" /> {t.builder.long_only_label} · {displayResult.cov_method}
                  </div>
                }
              >
                <EfficientFrontier
                  frontier={displayResult.efficient_frontier as any}
                  selected={{
                    return: displayResult.expected_return_annual,
                    risk: displayResult.volatility_annual,
                    label: t.builder.placeholder_title,
                  }}
                  riskFreeRate={displayResult.risk_free_rate}
                />
              </Section>

              <Section
                title={t.builder.forecast_title}
                subtitle={tpl(t.builder.forecast_subtitle, { n: displayResult.monte_carlo.n_simulations.toLocaleString(), capital: fmtUSD(displayResult.initial_capital, 0), value: fmtUSD(displayResult.monte_carlo.expected_value, 0) })}
                help={
                  <HelpTip title={t.builder.forecast_help_title} width={400}>
                    {tpl(t.builder.forecast_help_body, { n: displayResult.monte_carlo.n_simulations.toLocaleString() })}
                  </HelpTip>
                }
              >
                <MonteCarloFan
                  months={displayResult.monte_carlo.months}
                  median={displayResult.monte_carlo.median_path}
                  p5={displayResult.monte_carlo.p5_path}
                  p25={displayResult.monte_carlo.p25_path}
                  p75={displayResult.monte_carlo.p75_path}
                  p95={displayResult.monte_carlo.p95_path}
                  paths_sample={displayResult.monte_carlo.paths_sample}
                  initial={displayResult.initial_capital}
                  benchmarkValue={
                    displayResult.benchmark_comparison?.expected_value_12m
                      ? displayResult.benchmark_comparison.expected_value_12m *
                        (displayResult.initial_capital / (result?.initial_capital ?? 1))
                      : null
                  }
                />
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
                  {[
                    { k: t.builder.pct_worst, v: displayResult.monte_carlo.percentiles.p5, c: "negative" },
                    { k: t.builder.pct_25th, v: displayResult.monte_carlo.percentiles.p25, c: "default" },
                    { k: t.builder.pct_median, v: displayResult.monte_carlo.percentiles.p50, c: "cyan" },
                    { k: t.builder.pct_75th, v: displayResult.monte_carlo.percentiles.p75, c: "default" },
                    { k: t.builder.pct_best, v: displayResult.monte_carlo.percentiles.p95, c: "positive" },
                  ].map((p) => (
                    <div key={p.k} className="card p-3 text-center">
                      <div className="text-[10px] uppercase tracking-widest text-text-dim">{p.k}</div>
                      <div className={`font-mono text-lg font-bold ${p.c === "positive" ? "text-positive" : p.c === "negative" ? "text-negative" : p.c === "cyan" ? "text-cyan" : "text-text"}`}>
                        {fmtUSD(p.v, 0)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 pt-5 border-t border-border">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-base sm:text-lg font-semibold inline-flex items-center">
                      {t.builder.distribution_title}
                      <HelpTip title={t.builder.distribution_help_title} width={400}>
                        {t.builder.distribution_help_body}
                      </HelpTip>
                    </h3>
                  </div>
                  <DistributionChart paths_sample={displayResult.monte_carlo.paths_sample} initial={displayResult.initial_capital} />
                </div>
              </Section>

              {displayResult.benchmark_comparison?.available && (
                <Section
                  title={t.builder.benchmark_title}
                  subtitle={t.builder.benchmark_subtitle}
                  help={
                    <HelpTip title={t.builder.benchmark_help_title} width={380}>
                      {t.builder.benchmark_help_body}
                    </HelpTip>
                  }
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="card p-4">
                      <div className="text-xs text-text-muted uppercase tracking-wider">{t.builder.benchmark_return}</div>
                      <div className="text-2xl font-mono font-bold mt-1">{fmtPct(displayResult.benchmark_comparison.expected_return_annual)}</div>
                    </div>
                    <div className="card p-4">
                      <div className="text-xs text-text-muted uppercase tracking-wider">{t.builder.benchmark_vol}</div>
                      <div className="text-2xl font-mono font-bold mt-1">{fmtPct(displayResult.benchmark_comparison.volatility_annual)}</div>
                    </div>
                    <div className="card p-4">
                      <div className="text-xs text-text-muted uppercase tracking-wider">{t.builder.alpha_label}</div>
                      <div className={`text-2xl font-mono font-bold mt-1 ${displayResult.benchmark_comparison.alpha_vs_benchmark >= 0 ? "text-positive" : "text-negative"}`}>
                        {displayResult.benchmark_comparison.alpha_vs_benchmark >= 0 ? "+" : ""}
                        {fmtPct(displayResult.benchmark_comparison.alpha_vs_benchmark)}
                      </div>
                    </div>
                  </div>
                </Section>
              )}

              {displayResult.correlation_matrix?.symbols?.length > 1 && (
                <Section
                  title={t.builder.correlation_title}
                  subtitle={t.builder.correlation_subtitle}
                  help={
                    <HelpTip title={t.builder.correlation_help_title} width={400}>
                      {t.builder.correlation_help_body}
                    </HelpTip>
                  }
                >
                  <CorrelationHeatmap
                    symbols={displayResult.correlation_matrix.symbols}
                    matrix={displayResult.correlation_matrix.matrix}
                  />
                </Section>
              )}

              <Section
                title={t.builder.save_title}
                subtitle={canSave ? t.builder.save_subtitle_can : t.builder.save_subtitle_cant}
                help={
                  <HelpTip title={t.builder.save_help_title} width={360}>
                    {t.builder.save_help_body}
                  </HelpTip>
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input className="input md:col-span-2" placeholder={t.builder.save_name_placeholder} value={saveName} onChange={(e) => setSaveName(e.target.value)} />
                  <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-bg-elevated border border-border cursor-pointer transition-colors hover:border-border-accent">
                    <input type="checkbox" checked={savePublic} onChange={(e) => setSavePublic(e.target.checked)} className="accent-cyan" />
                    <span className="text-sm">{t.builder.save_share_label}</span>
                  </label>
                </div>
                <textarea className="input mt-3" placeholder={t.builder.save_notes_placeholder} rows={2} value={saveNotes} onChange={(e) => setSaveNotes(e.target.value)} />
                <button onClick={save} disabled={!canSave || saving || !saveName.trim()} className="btn-primary mt-3 inline-flex items-center gap-2">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t.builder.saving}</> : <><Save className="w-4 h-4" /> {t.builder.save_button}</>}
                </button>
              </Section>
            </>
          )}
        </div>
      </div>

      {/* Price-history modal — mounted at root so it overlays everything.
          `historySymbol === null` returns null inside the component, so the
          listener / fetch are gated by mount. */}
      <AssetHistoryModal
        symbol={historySymbol}
        years={req.history_years}
        onClose={() => setHistorySymbol(null)}
      />
    </div>
  );
}
