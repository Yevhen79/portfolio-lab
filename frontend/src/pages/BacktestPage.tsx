/**
 * Backtest page — "what if I had built this portfolio on date X, what
 * would the next year (or any window I pick) actually have returned?"
 *
 * Lives parallel to the live builder. The form mirrors the live builder
 * 1:1 so the user has every parameter they'd normally tweak; on top of
 * that we add two date pickers — `as_of` (the day the portfolio is
 * pretended to be built) and `forward_end` (where to stop measuring the
 * realised result). The optimiser sees only data up to as_of (cropped
 * inside the data loader) and the realised stats are computed from
 * the same weights applied to the (as_of, forward_end] window.
 *
 * We deliberately duplicate the form rather than extracting a shared
 * component — the live builder has subtle auto-rerun-on-change semantics
 * that we don't want in the backtest path, and the two pages will likely
 * drift apart over time as backtest-specific niceties (range presets,
 * walk-forward, etc.) accrue.
 */
import { useRef, useState } from "react";
import {
  Ban,
  CalendarClock,
  Loader2,
  Play,
  Plus,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import Plot from "react-plotly.js";

import * as backtestApi from "../api/backtest";
import type { BacktestRequest, BacktestResponse } from "../api/backtest";
import type { OptimizeRequest } from "../api/portfolios";
import AllocationTable from "../components/AllocationTable";
import BuildErrorCard from "../components/BuildErrorCard";
import HelpTip from "../components/HelpTip";
import OptimizeProgress from "../components/OptimizeProgress";
import Section from "../components/Section";
import WeightsBar from "../components/charts/WeightsBar";
import { useT, tpl } from "../i18n";
import { fmtPct, fmtUSD } from "../utils/format";

const ALL_CATEGORIES = ["stock", "index", "commodity", "crypto", "fx", "etf"] as const;

/* ============================== defaults ============================== */

function defaultAsOf(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function minAsOf(): string {
  // ~15 years back keeps the estimation window long enough on default
  // history_years (15) without going past where the cache reliably has data.
  const d = new Date();
  d.setFullYear(d.getFullYear() - 15);
  return d.toISOString().slice(0, 10);
}

function defaultRequest(asOf: string, fwdEnd: string): BacktestRequest {
  return {
    portfolio_type: "max_sharpe",
    initial_capital: 10000,
    risk_tolerance: "moderate",
    target_return: 0.15,
    target_risk: 0.20,
    history_years: 15,
    min_history_years: 6,
    cov_method: "ledoit_wolf",
    long_only: true,
    sparsify: true,
    sparsify_threshold: 0.01,
    max_weight_per_asset: 0.35,
    apply_swaps: false,
    max_assets_in_universe: 500,
    categories: [...ALL_CATEGORIES],
    exclude_symbols: [],
    as_of_date: asOf,
    forward_end_date: fwdEnd,
  };
}

/* =============================== page ================================ */

export default function BacktestPage() {
  const t = useT();
  const [req, setReq] = useState<BacktestRequest>(() =>
    defaultRequest(defaultAsOf(), todayISO()),
  );
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function update<K extends keyof BacktestRequest>(k: K, v: BacktestRequest[K]) {
    setReq((r) => ({ ...r, [k]: v }));
  }

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await backtestApi.runBacktest(req);
      setResult(data);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /* --- exclude-list helpers (simpler than builder: no auto-rerun) --- */
  const [excludeInput, setExcludeInput] = useState("");
  const excludeInputRef = useRef<HTMLInputElement | null>(null);
  function submitExcludeInput() {
    const v = excludeInput.trim();
    if (!v) return;
    const tokens = v
      .split(/[\s,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    setReq((r) => {
      const cur = new Set((r.exclude_symbols ?? []).map((s) => s.toUpperCase()));
      tokens.forEach((tok) => cur.add(tok));
      return { ...r, exclude_symbols: Array.from(cur) };
    });
    setExcludeInput("");
    excludeInputRef.current?.focus();
  }
  function removeExclude(symbol: string) {
    setReq((r) => ({
      ...r,
      exclude_symbols: (r.exclude_symbols ?? []).filter(
        (s) => s.toUpperCase() !== symbol.toUpperCase(),
      ),
    }));
  }
  function clearExcludes() {
    setReq((r) => ({ ...r, exclude_symbols: [] }));
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-2 md:gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight neon-text inline-block">
            {t.backtest.page_title}
          </h1>
          <p className="text-xs sm:text-base text-text-muted mt-1 max-w-2xl">
            {t.backtest.page_subtitle}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* LEFT: form */}
        <div className="lg:col-span-4 space-y-4">
          {/* ============ Backtest-specific dates ============ */}
          <Section
            title={t.backtest.dates_title}
            subtitle={t.backtest.dates_subtitle}
            help={
              <HelpTip title={t.backtest.help_title} width={380}>
                <p>{t.backtest.help_body_1}</p>
                <p className="mt-2">{t.backtest.help_body_2}</p>
                <p className="mt-2 text-text-dim">{t.backtest.help_body_3}</p>
              </HelpTip>
            }
          >
            <div className="space-y-3">
              <div>
                <label className="block text-xs uppercase tracking-wide text-text-muted mb-1.5">
                  <CalendarClock className="w-3.5 h-3.5 inline-block mr-1" />
                  {t.backtest.as_of_label}
                </label>
                <input
                  type="date"
                  className="input w-full"
                  value={req.as_of_date}
                  min={minAsOf()}
                  max={todayISO()}
                  onChange={(e) => update("as_of_date", e.target.value)}
                />
                <p className="text-[11px] text-text-dim mt-1">{t.backtest.as_of_hint}</p>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide text-text-muted mb-1.5">
                  {t.backtest.forward_end_label}
                </label>
                <input
                  type="date"
                  className="input w-full"
                  value={req.forward_end_date ?? todayISO()}
                  min={req.as_of_date}
                  max={todayISO()}
                  onChange={(e) => update("forward_end_date", e.target.value)}
                />
                <p className="text-[11px] text-text-dim mt-1">{t.backtest.forward_end_hint}</p>
              </div>
              {/* Quick range presets relative to as_of */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[3, 6, 12, 24, 36].map((months) => (
                  <button
                    key={months}
                    type="button"
                    onClick={() => {
                      const d = new Date(req.as_of_date);
                      d.setMonth(d.getMonth() + months);
                      const tdy = new Date();
                      if (d > tdy) {
                        update("forward_end_date", tdy.toISOString().slice(0, 10));
                      } else {
                        update("forward_end_date", d.toISOString().slice(0, 10));
                      }
                    }}
                    className="text-[11px] px-2 py-1 rounded-md border border-border text-text-muted hover:border-cyan hover:text-cyan transition-colors"
                  >
                    +{months} {t.backtest.months_unit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => update("forward_end_date", todayISO())}
                  className="text-[11px] px-2 py-1 rounded-md border border-border text-text-muted hover:border-cyan hover:text-cyan transition-colors"
                >
                  {t.backtest.forward_today}
                </button>
              </div>
            </div>
          </Section>

          {/* ============ Strategy ============ */}
          <Section
            title={t.builder.strategy_title}
            subtitle={t.builder.strategy_subtitle}
            help={
              <HelpTip title={t.builder.strategy_help_title} width={360}>
                <ul className="space-y-1.5">
                  <li><b className="text-cyan">{t.builder.strategy_max_sharpe}</b> — {t.builder.strategy_help_max_sharpe}</li>
                  <li><b className="text-cyan">{t.builder.strategy_min_variance}</b> — {t.builder.strategy_help_min_variance}</li>
                  <li><b className="text-cyan">{t.builder.strategy_target_return}</b> — {t.builder.strategy_help_target_return}</li>
                  <li><b className="text-cyan">{t.builder.strategy_target_risk}</b> — {t.builder.strategy_help_target_risk}</li>
                </ul>
              </HelpTip>
            }
          >
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: "max_sharpe", label: t.builder.strategy_max_sharpe, hint: t.builder.strategy_btn_hint_max_sharpe },
                { v: "min_variance", label: t.builder.strategy_min_variance, hint: t.builder.strategy_btn_hint_min_variance },
                { v: "target_return", label: t.builder.strategy_target_return, hint: t.builder.strategy_btn_hint_target_return },
                { v: "target_risk", label: t.builder.strategy_target_risk, hint: t.builder.strategy_btn_hint_target_risk },
              ].map((b) => (
                <button
                  key={b.v}
                  onClick={() => update("portfolio_type", b.v as OptimizeRequest["portfolio_type"])}
                  title={b.hint}
                  className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                    req.portfolio_type === b.v
                      ? "border-cyan bg-cyan/10 text-cyan shadow-glow"
                      : "border-border text-text-muted hover:border-border-accent"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </Section>

          {/* ============ Swap costs ============ */}
          <Section
            title={t.builder.swaps_title}
            subtitle={req.apply_swaps ? t.builder.swaps_subtitle_on : t.builder.swaps_subtitle_off}
            help={
              <HelpTip title={t.builder.swaps_help_title} width={380}>
                {t.builder.swaps_help_body}
              </HelpTip>
            }
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-text-muted leading-relaxed">
                {req.apply_swaps ? t.builder.swaps_status_on : t.builder.swaps_status_off}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={req.apply_swaps ?? false}
                onClick={() => update("apply_swaps", !req.apply_swaps)}
                className={`shrink-0 inline-flex items-center h-7 w-12 rounded-full border transition-colors ${
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

          {/* ============ Capital ============ */}
          <Section
            title={t.builder.capital_title}
            subtitle={t.builder.capital_subtitle}
            help={<HelpTip title={t.builder.capital_help_title}>{t.builder.capital_help_body}</HelpTip>}
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
                <button
                  key={amt}
                  onClick={() => update("initial_capital", amt)}
                  className="px-2.5 py-1 text-xs rounded-md border border-border hover:border-cyan hover:text-cyan transition-colors"
                >
                  ${amt.toLocaleString()}
                </button>
              ))}
            </div>
          </Section>

          {/* ============ Target Return ============ */}
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
                className="w-full accent-cyan h-2"
              />
              <div className="flex justify-between text-[11px] text-text-muted mt-1">
                <span>5%</span><span>25%</span><span>50%</span>
              </div>
            </Section>
          )}

          {/* ============ Target Risk ============ */}
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
                className="w-full accent-cyan h-2"
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

          {/* ============ Risk Tolerance (only for target_risk) ============ */}
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
                {([
                  { v: "conservative", label: t.builder.rt_conservative, hint: t.builder.rt_hint_conservative },
                  { v: "moderate", label: t.builder.rt_moderate, hint: t.builder.rt_hint_moderate },
                  { v: "aggressive", label: t.builder.rt_aggressive, hint: t.builder.rt_hint_aggressive },
                ] as const).map(({ v, label, hint }) => (
                  <button
                    key={v}
                    onClick={() => update("risk_tolerance", v)}
                    title={hint}
                    className={`px-2 py-2 rounded-lg text-xs font-medium transition-all border ${
                      req.risk_tolerance === v
                        ? "border-magenta bg-magenta/10 text-magenta"
                        : "border-border text-text-muted hover:border-border-accent"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* ============ Categories ============ */}
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
                    className={`px-2 py-2 rounded-lg text-xs font-medium transition-all border capitalize ${
                      selected
                        ? "border-cyan bg-cyan/10 text-cyan shadow-glow"
                        : "border-border text-text-dim hover:border-border-accent"
                    }`}
                  >
                    {t.builder[labelKey]}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* ============ Exclusions ============ */}
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
                  onClick={clearExcludes}
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
                {req.exclude_symbols!.map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => removeExclude(sym)}
                    title={sym}
                    className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-bg-elevated border border-border hover:border-red hover:bg-red/10 text-xs font-mono transition-colors"
                  >
                    <Ban className="w-3 h-3 text-red" />
                    <span className="font-semibold text-cyan">{sym}</span>
                    <X className="w-3 h-3 text-text-dim ml-0.5" />
                  </button>
                ))}
              </div>
            )}
          </Section>

          {/* ============ Advanced ============ */}
          <Section
            title={t.builder.advanced_title}
            subtitle={t.builder.advanced_subtitle}
            help={
              <HelpTip title={t.builder.advanced_help_title}>
                {t.builder.advanced_help_body}
              </HelpTip>
            }
          >
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
                <input
                  type="range"
                  min={3}
                  max={15}
                  step={1}
                  value={req.min_history_years}
                  onChange={(e) => update("min_history_years", Number(e.target.value))}
                  className="w-full accent-cyan"
                />
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
                <input
                  type="range"
                  min={50}
                  max={1500}
                  step={50}
                  value={Math.min(req.max_assets_in_universe, 1500)}
                  onChange={(e) => update("max_assets_in_universe", Number(e.target.value))}
                  className="w-full accent-cyan"
                />
                <div className="flex justify-between text-[11px] text-text-muted mt-1">
                  <span>50</span><span>500</span><span>1500</span>
                </div>
                <button
                  type="button"
                  onClick={() => update("max_assets_in_universe", 1500)}
                  className={`mt-2 text-[11px] px-2 py-1 rounded-md border transition-colors ${
                    req.max_assets_in_universe >= 1500
                      ? "border-cyan bg-cyan/10 text-cyan"
                      : "border-border text-text-muted hover:border-cyan hover:text-cyan"
                  }`}
                >
                  {t.builder.universe_size_all}
                </button>
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
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  value={req.max_weight_per_asset ?? 0.35}
                  onChange={(e) => update("max_weight_per_asset", Number(e.target.value))}
                  className="w-full accent-cyan"
                />
                <div className="flex justify-between text-[11px] text-text-muted mt-1">
                  <span>10%</span><span>35%</span><span>{t.builder.max_weight_off}</span>
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
                <input
                  type="range"
                  min={5}
                  max={25}
                  step={1}
                  value={req.history_years}
                  onChange={(e) => update("history_years", Number(e.target.value))}
                  className="w-full accent-cyan"
                />
              </div>
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
                  onChange={(e) => update("cov_method", e.target.value as OptimizeRequest["cov_method"])}
                >
                  <option value="ledoit_wolf">{t.builder.cov_method_lw}</option>
                  <option value="sample">{t.builder.cov_method_sample}</option>
                  <option value="ewma">{t.builder.cov_method_ewma}</option>
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs uppercase tracking-wide text-text-muted inline-flex items-center">
                    {t.builder.sparsification_label} {fmtPct(req.sparsify_threshold)}
                    <HelpTip title={t.builder.sparsification_help_title} width={360}>
                      {t.builder.sparsification_help_body}
                    </HelpTip>
                  </label>
                  <button
                    onClick={() => update("sparsify", !req.sparsify)}
                    className={`text-[10px] px-2 py-0.5 rounded-md ${
                      req.sparsify ? "bg-cyan/20 text-cyan" : "bg-bg-elevated text-text-dim"
                    }`}
                  >
                    {req.sparsify ? "ON" : "OFF"}
                  </button>
                </div>
                <input
                  type="range"
                  min={0}
                  max={0.05}
                  step={0.001}
                  value={req.sparsify_threshold}
                  onChange={(e) => update("sparsify_threshold", Number(e.target.value))}
                  className="w-full accent-cyan"
                />
              </div>
            </div>
          </Section>

          {/* ============ Submit ============ */}
          <button
            onClick={() => void run()}
            disabled={busy || !req.as_of_date}
            className="w-full px-4 sm:px-6 py-3 sm:py-4 rounded-2xl font-semibold text-bg
              bg-gradient-to-r from-cyan to-magenta hover:opacity-90 transition-opacity
              shadow-glow disabled:opacity-50 disabled:cursor-not-allowed
              inline-flex items-center justify-center gap-2 sm:gap-3 text-base sm:text-lg sticky bottom-2 sm:bottom-4 z-10"
          >
            {busy ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t.backtest.running}
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                {t.backtest.run_button}
              </>
            )}
          </button>
        </div>

        {/* RIGHT: results */}
        <div className="lg:col-span-8 space-y-6 min-h-[400px]">
          {error !== null && !busy && <BuildErrorCard error={error} onRetry={() => void run()} />}

          {busy && !result && <OptimizeProgress busy={busy} />}

          {!busy && !result && !error && (
            <div className="card-glow p-12 flex flex-col items-center justify-center gap-4 text-center min-h-[460px] relative overflow-hidden">
              <div className="absolute -top-32 -right-32 w-64 h-64 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-20 -left-20 w-48 h-48 rounded-full bg-magenta/10 blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-neon-gradient flex items-center justify-center shadow-glow mb-4">
                  <CalendarClock className="w-8 h-8 text-bg" />
                </div>
                <h2 className="text-2xl font-bold neon-text mb-2">{t.backtest.placeholder_title}</h2>
                <p className="text-text-muted max-w-md">{t.backtest.placeholder_body}</p>
              </div>
            </div>
          )}

          {result && <BacktestResults result={result} />}
        </div>
      </div>
    </div>
  );
}

/* ============================ results ============================ */

function BacktestResults({ result }: { result: BacktestResponse }) {
  const t = useT();
  const { plan, realized, comparison } = result;

  return (
    <div className="space-y-6">
      <div className="card p-4 sm:p-6 bg-gradient-to-r from-cyan/5 via-bg to-magenta/5 border-cyan/20">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label={t.backtest.summary_as_of} value={result.as_of_date} mono />
          <Stat label={t.backtest.summary_forward_end} value={result.forward_window_end} mono />
          <Stat label={t.backtest.summary_months} value={`${result.months_observed} ${t.backtest.months_unit}`} />
          <Stat
            label={t.backtest.summary_final}
            value={realized ? fmtUSD(realized.final_value, 0) : "—"}
            highlight={realized ? (realized.total_return >= 0 ? "positive" : "negative") : undefined}
          />
        </div>
      </div>

      {realized && comparison.rows.length > 0 && (
        <Section title={t.backtest.compare_title} subtitle={t.backtest.compare_subtitle}>
          <CompareTable rows={comparison.rows} />
          {realized.benchmark_total_return !== null && (
            <div className="mt-4 text-xs text-text-muted border-t border-border pt-3 flex flex-wrap items-center gap-3">
              <span className="font-semibold text-text">{t.backtest.benchmark_label}:</span>
              <span>
                {t.backtest.benchmark_total}{" "}
                <span className={`font-mono font-semibold ${realized.benchmark_total_return >= 0 ? "text-positive" : "text-negative"}`}>
                  {fmtPct(realized.benchmark_total_return)}
                </span>
              </span>
              <span>
                {t.backtest.benchmark_vs_portfolio}{" "}
                <span
                  className={`font-mono font-semibold ${
                    realized.total_return - realized.benchmark_total_return >= 0
                      ? "text-positive"
                      : "text-negative"
                  }`}
                >
                  {fmtPct(realized.total_return - realized.benchmark_total_return)}
                </span>
              </span>
            </div>
          )}
        </Section>
      )}

      {realized && realized.equity_path.length > 0 && (
        <Section
          title={t.backtest.equity_title}
          subtitle={tpl(t.backtest.equity_subtitle, { n: realized.months_observed })}
        >
          <RealizedEquityChart realized={realized} initialCapital={plan.initial_capital} />
        </Section>
      )}

      {realized && realized.per_asset.length > 0 && (
        <Section title={t.backtest.per_asset_title} subtitle={t.backtest.per_asset_subtitle}>
          <PerAssetCompare rows={realized.per_asset} />
        </Section>
      )}

      <Section title={t.backtest.plan_structure_title} subtitle={t.backtest.plan_structure_subtitle}>
        <div className="space-y-4">
          <WeightsBar weights={plan.weights} />
          <AllocationTable weights={plan.weights} />
        </div>
      </Section>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: "positive" | "negative";
}) {
  const color =
    highlight === "positive" ? "text-positive" : highlight === "negative" ? "text-negative" : "text-text";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`text-lg sm:text-xl font-bold ${mono ? "font-mono" : ""} ${color}`}>{value}</div>
    </div>
  );
}

function CompareTable({ rows }: { rows: backtestApi.ComparisonRow[] }) {
  const t = useT();
  function fmtVal(v: number | null, format: "pct" | "ratio" | "usd") {
    if (v === null || v === undefined) return "—";
    if (format === "pct") return fmtPct(v);
    if (format === "usd") return fmtUSD(v, 0);
    return v.toFixed(2);
  }
  function metricLabel(key: string): string {
    const map: Record<string, string> = {
      expected_return_annual: t.backtest.metric_return_annual,
      cagr_annual: t.backtest.metric_cagr,
      volatility_annual: t.backtest.metric_volatility,
      sharpe_ratio: t.backtest.metric_sharpe,
      max_drawdown: t.backtest.metric_drawdown,
      final_value: t.backtest.metric_final_value,
    };
    return map[key] ?? key;
  }
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-none sm:rounded-xl border-y sm:border border-border">
      <table className="w-full text-sm">
        <thead className="bg-bg-elevated">
          <tr className="text-text-muted text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 sm:px-4 py-3">{t.backtest.col_metric}</th>
            <th className="text-right px-3 sm:px-4 py-3">{t.backtest.col_planned}</th>
            <th className="text-right px-3 sm:px-4 py-3">{t.backtest.col_actual}</th>
            <th className="text-right px-3 sm:px-4 py-3">{t.backtest.col_delta}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta =
              row.planned !== null && row.actual !== null ? row.actual - row.planned : null;
            const isDrawdown = row.metric === "max_drawdown";
            const positive = delta !== null && (isDrawdown ? delta > 0 : delta > 0);
            const Arrow = delta === null ? null : positive ? TrendingUp : TrendingDown;
            return (
              <tr key={row.metric} className="border-t border-border">
                <td className="px-3 sm:px-4 py-3 text-text-muted">{metricLabel(row.metric)}</td>
                <td className="px-3 sm:px-4 py-3 text-right font-mono">{fmtVal(row.planned, row.format)}</td>
                <td className="px-3 sm:px-4 py-3 text-right font-mono font-semibold">{fmtVal(row.actual, row.format)}</td>
                <td className="px-3 sm:px-4 py-3 text-right font-mono">
                  {delta === null ? (
                    <span className="text-text-dim">—</span>
                  ) : (
                    <span className={`inline-flex items-center gap-1 ${positive ? "text-positive" : "text-negative"}`}>
                      {Arrow && <Arrow className="w-3.5 h-3.5" />}
                      {delta > 0 ? "+" : ""}
                      {fmtVal(delta, row.format)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PerAssetCompare({ rows }: { rows: backtestApi.RealizedAssetReturn[] }) {
  const t = useT();
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-none sm:rounded-xl border-y sm:border border-border max-h-[480px]">
      <table className="w-full text-sm">
        <thead className="bg-bg-elevated sticky top-0 z-10">
          <tr className="text-text-muted text-[11px] uppercase tracking-wider">
            <th className="text-left px-2 sm:px-4 py-3">{t.table.col_symbol}</th>
            <th className="text-left px-2 sm:px-4 py-3 hidden sm:table-cell">{t.table.col_name}</th>
            <th className="text-right px-2 sm:px-4 py-3">{t.table.col_weight}</th>
            <th className="text-right px-2 sm:px-4 py-3">{t.backtest.per_asset_plan}</th>
            <th className="text-right px-2 sm:px-4 py-3">{t.backtest.per_asset_actual}</th>
            <th className="text-right px-2 sm:px-4 py-3">{t.backtest.per_asset_delta}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const delta = r.realized_return - r.expected_return_annual;
            const pos = delta >= 0;
            return (
              <tr key={r.symbol} className="border-t border-border hover:bg-bg-elevated/50">
                <td className="px-2 sm:px-4 py-3 font-mono font-semibold text-cyan whitespace-nowrap">{r.symbol}</td>
                <td className="px-2 sm:px-4 py-3 text-text-muted hidden sm:table-cell">{r.name}</td>
                <td className="px-2 sm:px-4 py-3 text-right font-mono">{fmtPct(r.weight)}</td>
                <td className="px-2 sm:px-4 py-3 text-right font-mono text-text-muted">
                  {fmtPct(r.expected_return_annual)}
                </td>
                <td
                  className={`px-2 sm:px-4 py-3 text-right font-mono font-semibold ${
                    r.realized_return >= 0 ? "text-positive" : "text-negative"
                  }`}
                >
                  {fmtPct(r.realized_return)}
                </td>
                <td className={`px-2 sm:px-4 py-3 text-right font-mono ${pos ? "text-positive" : "text-negative"}`}>
                  {delta >= 0 ? "+" : ""}
                  {fmtPct(delta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RealizedEquityChart({
  realized,
  initialCapital,
}: {
  realized: backtestApi.RealizedMetrics;
  initialCapital: number;
}) {
  const t = useT();
  const xs = realized.equity_timestamps;
  const ys = realized.equity_path;
  const anchorX = xs.length > 0 ? xs[0] : realized.forward_start;
  const xsFull = [anchorX, ...xs];
  const ysFull = [initialCapital, ...ys];

  return (
    <Plot
      data={[
        {
          x: xsFull,
          y: ysFull,
          type: "scatter",
          mode: "lines",
          line: { color: "#22d3ee", width: 2.5 },
          fill: "tozeroy",
          fillcolor: "rgba(34, 211, 238, 0.08)",
          name: t.backtest.equity_line_label,
          hovertemplate: "%{x|%Y-%m}<br>$%{y:,.0f}<extra></extra>",
        },
        {
          x: [xsFull[0], xsFull[xsFull.length - 1]],
          y: [initialCapital, initialCapital],
          type: "scatter",
          mode: "lines",
          line: { color: "#64748b", width: 1, dash: "dash" },
          name: t.backtest.equity_baseline_label,
          hoverinfo: "skip",
        },
      ]}
      layout={{
        autosize: true,
        height: 320,
        margin: { l: 60, r: 20, t: 12, b: 40 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { color: "#94a3b8", size: 11 },
        xaxis: { gridcolor: "#1e293b", color: "#94a3b8" },
        yaxis: { gridcolor: "#1e293b", color: "#94a3b8", tickprefix: "$", tickformat: ",.0f" },
        legend: { orientation: "h", y: 1.12, x: 0, font: { size: 10 } },
        showlegend: true,
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: "100%" }}
      useResizeHandler
    />
  );
}

