/**
 * Backtest page — "what if I had built this portfolio on date X, what
 * would the next year actually have returned?"
 *
 * Lives parallel to the live builder and shares zero state with it. The
 * form is a deliberately minimal subset of the builder controls so the
 * page focuses on the comparison and not on parameter sprawl. Everything
 * else uses sensible defaults; advanced users still have the full live
 * builder for parameter tuning.
 *
 * The result has two halves:
 *   1. Plan — what the optimiser would have chosen on as_of_date using
 *      only data available then. Reuses the live builder's components
 *      (allocation table, weights bar, portfolio metrics) so the look is
 *      identical to "build now".
 *   2. Fact — what that portfolio actually delivered over the next 12
 *      months (or up to today if as_of is more recent than a year ago).
 *      Side-by-side compare table, per-asset breakdown, S&P benchmark.
 */
import { useState } from "react";
import { CalendarClock, Loader2, Play, TrendingDown, TrendingUp } from "lucide-react";
import Plot from "react-plotly.js";

import * as backtestApi from "../api/backtest";
import type { BacktestRequest, BacktestResponse } from "../api/backtest";
import type { OptimizeRequest } from "../api/portfolios";
import AllocationTable from "../components/AllocationTable";
import BuildErrorCard from "../components/BuildErrorCard";
import HelpTip from "../components/HelpTip";
import Section from "../components/Section";
import WeightsBar from "../components/charts/WeightsBar";
import { useT, tpl } from "../i18n";
import { fmtPct, fmtUSD } from "../utils/format";

const ALL_CATEGORIES = ["stock", "index", "commodity", "crypto", "fx", "etf"] as const;

/** Sensible defaults — same shape as builder's DEFAULT_REQ minus the
 *  "advanced" levers. The backtest doesn't expose every parameter on
 *  purpose; the page is meant for the "plan vs fact" comparison, not
 *  for full optimisation tuning. */
function defaultRequest(asOf: string): BacktestRequest {
  return {
    portfolio_type: "max_sharpe",
    initial_capital: 10000,
    risk_tolerance: "moderate",
    target_return: 0.15,
    target_risk: 0.20,
    history_years: 15,
    min_history_years: 5,
    cov_method: "ledoit_wolf",
    long_only: true,
    sparsify: true,
    sparsify_threshold: 0.01,
    max_weight_per_asset: 0.35,
    apply_swaps: false,
    max_assets_in_universe: 300,
    categories: [...ALL_CATEGORIES],
    exclude_symbols: [],
    as_of_date: asOf,
  };
}

/** Default as-of date for the picker = 1 year ago, rounded to month-end
 *  (the optimiser works on monthly bars so picking mid-month doesn't
 *  change the cutoff in practice). */
function defaultAsOf(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/** Maximum allowed as-of date in the picker = today minus 30 days. Any
 *  later than that and the realised window has < 1 month of data, which
 *  makes the comparison meaningless — we'd be telling the user "you
 *  predicted 30% annual and actually got 2% over 3 weeks". Clamp instead. */
function maxAsOf(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

/** Earliest date the cache realistically covers. The price cache holds
 *  ~20 years on disk, so as_of older than this gives short estimation
 *  windows; we clamp at 15 years to leave room for `history_years=15`. */
function minAsOf(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 15);
  return d.toISOString().slice(0, 10);
}

export default function BacktestPage() {
  const t = useT();
  const [req, setReq] = useState<BacktestRequest>(() => defaultRequest(defaultAsOf()));
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function update<K extends keyof BacktestRequest>(key: K, val: BacktestRequest[K]) {
    setReq((r) => ({ ...r, [key]: val }));
  }

  function toggleCategory(cat: string) {
    setReq((r) => {
      const list = r.categories ?? [];
      const next = list.includes(cat) ? list.filter((c) => c !== cat) : [...list, cat];
      return { ...r, categories: next };
    });
  }

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await backtestApi.runBacktest(req);
      setResult(data);
    } catch (e: unknown) {
      // BuildErrorCard accepts the raw error and figures out whether it's
      // a structured PortfolioBuildError (EMPTY_UNIVERSE etc.) or a plain
      // string / network failure, so we hand the whole thing over.
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight neon-text inline-block">
            {t.backtest.page_title}
          </h1>
          <p className="text-text-muted mt-1 max-w-2xl">{t.backtest.page_subtitle}</p>
        </div>
      </div>

      {/* --- Form --- */}
      <Section
        title={t.backtest.form_title}
        subtitle={t.backtest.form_subtitle}
        help={
          <HelpTip title={t.backtest.help_title}>
            <p>{t.backtest.help_body_1}</p>
            <p className="mt-2">{t.backtest.help_body_2}</p>
            <p className="mt-2 text-text-dim">{t.backtest.help_body_3}</p>
          </HelpTip>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* As-of date — the headline parameter */}
          <div className="lg:col-span-2">
            <label className="block text-xs uppercase tracking-wider text-text-muted mb-1.5">
              <CalendarClock className="w-3.5 h-3.5 inline-block mr-1" />
              {t.backtest.as_of_label}
            </label>
            <input
              type="date"
              className="input w-full"
              value={req.as_of_date}
              min={minAsOf()}
              max={maxAsOf()}
              onChange={(e) => update("as_of_date", e.target.value)}
            />
            <p className="text-xs text-text-dim mt-1">{t.backtest.as_of_hint}</p>
          </div>

          {/* Strategy */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-muted mb-1.5">
              {t.backtest.strategy_label}
            </label>
            <select
              className="input w-full"
              value={req.portfolio_type}
              onChange={(e) => update("portfolio_type", e.target.value as OptimizeRequest["portfolio_type"])}
            >
              <option value="max_sharpe">{t.builder.strategy_max_sharpe}</option>
              <option value="min_variance">{t.builder.strategy_min_variance}</option>
              <option value="target_return">{t.builder.strategy_target_return}</option>
              <option value="target_risk">{t.builder.strategy_target_risk}</option>
            </select>
          </div>

          {/* Capital */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-muted mb-1.5">
              {t.backtest.capital_label}
            </label>
            <input
              type="number"
              className="input w-full"
              value={req.initial_capital}
              min={100}
              step={1000}
              onChange={(e) => update("initial_capital", Number(e.target.value) || 100)}
            />
          </div>
        </div>

        {/* Optional target rows that only matter for two of the strategies */}
        {req.portfolio_type === "target_return" && (
          <div className="mt-4">
            <label className="block text-xs uppercase tracking-wider text-text-muted mb-1.5">
              {t.builder.strategy_target_return} (%)
            </label>
            <input
              type="number"
              className="input w-40"
              value={((req.target_return ?? 0.15) * 100).toFixed(0)}
              step={1}
              min={1}
              max={100}
              onChange={(e) => update("target_return", Number(e.target.value) / 100)}
            />
          </div>
        )}
        {req.portfolio_type === "target_risk" && (
          <div className="mt-4">
            <label className="block text-xs uppercase tracking-wider text-text-muted mb-1.5">
              {t.builder.strategy_target_risk} (%)
            </label>
            <input
              type="number"
              className="input w-40"
              value={((req.target_risk ?? 0.20) * 100).toFixed(0)}
              step={1}
              min={1}
              max={100}
              onChange={(e) => update("target_risk", Number(e.target.value) / 100)}
            />
          </div>
        )}

        {/* Categories */}
        <div className="mt-4">
          <label className="block text-xs uppercase tracking-wider text-text-muted mb-2">
            {t.backtest.categories_label}
          </label>
          <div className="flex flex-wrap gap-2">
            {ALL_CATEGORIES.map((c) => {
              const on = (req.categories ?? []).includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={`badge cursor-pointer transition-colors ${
                    on
                      ? "bg-cyan/20 text-cyan border border-cyan/40"
                      : "bg-bg-elevated text-text-dim border border-border hover:border-text-muted"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={run}
            disabled={loading || !req.as_of_date}
            className="btn-primary inline-flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {loading ? t.backtest.running : t.backtest.run_button}
          </button>
        </div>
      </Section>

      {/* --- Error --- */}
      {error !== null && <BuildErrorCard error={error} onRetry={run} />}

      {/* --- Results --- */}
      {result && <BacktestResults result={result} />}
    </div>
  );
}

/* --------------------------- Results subtree --------------------------- */

function BacktestResults({ result }: { result: BacktestResponse }) {
  const t = useT();
  const { plan, realized, comparison } = result;

  return (
    <div className="space-y-6">
      {/* Top summary banner */}
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

      {/* Side-by-side compare table */}
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
                    realized.total_return - realized.benchmark_total_return >= 0 ? "text-positive" : "text-negative"
                  }`}
                >
                  {fmtPct(realized.total_return - realized.benchmark_total_return)}
                </span>
              </span>
            </div>
          )}
        </Section>
      )}

      {/* Realised equity curve over the forward window */}
      {realized && realized.equity_path.length > 0 && (
        <Section title={t.backtest.equity_title} subtitle={tpl(t.backtest.equity_subtitle, { n: realized.months_observed })}>
          <RealizedEquityChart realized={realized} initialCapital={plan.initial_capital} />
        </Section>
      )}

      {/* Per-asset compare table */}
      {realized && realized.per_asset.length > 0 && (
        <Section title={t.backtest.per_asset_title} subtitle={t.backtest.per_asset_subtitle}>
          <PerAssetCompare rows={realized.per_asset} />
        </Section>
      )}

      {/* Plan structure — reuse builder's components so the visual is
          identical between live and backtest pages. */}
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
            // For drawdown, a SMALLER (less negative) realised value is better.
            // For everything else, larger actual vs planned is better.
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
                    <span
                      className={`inline-flex items-center gap-1 ${positive ? "text-positive" : "text-negative"}`}
                    >
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
                <td className={`px-2 sm:px-4 py-3 text-right font-mono font-semibold ${r.realized_return >= 0 ? "text-positive" : "text-negative"}`}>
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
  // Prepend the initial-capital anchor so the line starts at the as-of
  // date with $initial_capital — otherwise the chart visually begins at
  // the first monthly return and the line looks disconnected from the
  // "you invested $X here" mental model.
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
        yaxis: {
          gridcolor: "#1e293b",
          color: "#94a3b8",
          tickprefix: "$",
          tickformat: ",.0f",
        },
        legend: { orientation: "h", y: 1.12, x: 0, font: { size: 10 } },
        showlegend: true,
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: "100%" }}
      useResizeHandler
    />
  );
}
