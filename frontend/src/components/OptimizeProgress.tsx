import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { useT, type Strings } from "../i18n";

/** A "narrating" progress card shown while the optimizer is running.
 *
 *  The backend itself is a single synchronous POST — no streaming progress —
 *  so this is intentionally a *faux* simulator: we encode the real pipeline
 *  stages and their relative durations, then walk through them client-side
 *  while we wait for the response. When the response (success or error)
 *  arrives the parent flips `busy=false` and we snap to 100% / unmount.
 *
 *  The phases below mirror what `portfolio_engine.build_portfolio` actually
 *  does, so the user gets an honest, educational view of where the wait
 *  comes from. Weights are calibrated against the typical 500-asset run on
 *  a moderately-warm yfinance cache: ~30 s total, with the yfinance fetch
 *  step dominating. If the backend is faster (warm parquet cache) we'll
 *  spend less time per step proportionally; if slower (cold cache) we
 *  asymptote at 95 % rather than fake completion. */

interface Step {
  /** Relative time weight. Larger = longer expected duration. The yfinance
   *  download step is the dominant bottleneck on cold cache. */
  weight: number;
  /** i18n key inside `t.optimize_progress.steps`. */
  key: keyof Strings["optimize_progress"]["steps"];
}

const STEPS: Step[] = [
  { weight: 1, key: "loading_catalog" },
  { weight: 9, key: "fetching_prices" },
  { weight: 1, key: "monthly_returns" },
  { weight: 1, key: "history_filter" },
  { weight: 1, key: "ranking" },
  { weight: 2, key: "covariance" },
  { weight: 1, key: "risk_free" },
  { weight: 1, key: "solving_qp" },
  { weight: 1, key: "sparsifying" },
  { weight: 1, key: "metrics" },
  { weight: 1, key: "frontier" },
  { weight: 2, key: "monte_carlo" },
  { weight: 1, key: "correlations" },
];

const TOTAL_WEIGHT = STEPS.reduce((s, x) => s + x.weight, 0);

/** Cumulative weight (% of total) reached at the END of step i. Used to map
 *  elapsed time → current step + visual progress percentage. */
const CUMULATIVE: number[] = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const s of STEPS) {
    acc += s.weight;
    out.push(acc / TOTAL_WEIGHT);
  }
  return out;
})();

/** Typical end-to-end wall time in seconds. Calibrated for 500-asset warm
 *  cache. Cold cache stretches; we asymptote rather than overshoot. */
const TYPICAL_SECONDS = 35;

interface Props {
  /** True while the optimizer request is in flight. Flipping false snaps
   *  the bar to 100% briefly, then the parent should unmount us. */
  busy: boolean;
  /** Compact variant: a slim two-line ribbon (current step + thin progress
   *  bar). Used during RE-runs when the previous portfolio is still on
   *  screen — we don't want to hide the result behind a full card. */
  compact?: boolean;
}

export default function OptimizeProgress({ busy, compact = false }: Props) {
  const t = useT();
  const [elapsed, setElapsed] = useState(0);
  // Holds a final 100 % flash for ~300 ms after the response lands so the
  // user sees "done" instead of an abrupt unmount.
  const [finished, setFinished] = useState(false);

  // Restart the timer every time `busy` flips true (e.g. user hits
  // Re-optimise after exclusion). Stops counting once busy ends.
  useEffect(() => {
    if (!busy) {
      if (elapsed > 0) {
        setFinished(true);
        const t = setTimeout(() => {
          setElapsed(0);
          setFinished(false);
        }, 350);
        return () => clearTimeout(t);
      }
      return;
    }
    setFinished(false);
    setElapsed(0);
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed((Date.now() - start) / 1000);
    }, 120);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // Asymptotic curve toward 95 %: progress = 0.95 * (1 - e^(-t/T)).
  // At T_typical we sit at 0.95 * (1 - 1/e) ≈ 60 %. Slow but never
  // overshoots — the user understands "almost there" rather than
  // "broken at 100 %".
  const raw = finished ? 1 : 0.95 * (1 - Math.exp(-elapsed / TYPICAL_SECONDS));
  const pct = Math.min(1, Math.max(0, raw));

  // Map % → step index. We treat a step as "current" once its preceding
  // cumulative threshold is crossed.
  const stepIdx = (() => {
    if (finished) return STEPS.length;
    for (let i = 0; i < STEPS.length; i++) {
      if (pct < CUMULATIVE[i]) return i;
    }
    return STEPS.length - 1;
  })();

  const currentLabel =
    stepIdx < STEPS.length
      ? t.optimize_progress.steps[STEPS[stepIdx].key]
      : t.optimize_progress.steps_done;

  // Compact ribbon for the re-run case: a thin progress bar + the current
  // step text underneath. Stays out of the way of the previous result.
  if (compact) {
    return (
      <div className="card p-3 sm:p-4">
        <div className="flex items-center gap-2 sm:gap-3 mb-2">
          <Loader2 className="w-3.5 h-3.5 text-cyan animate-spin flex-shrink-0" />
          <div className="text-[10px] sm:text-xs uppercase tracking-widest text-cyan font-semibold flex-shrink-0">
            {t.optimize_progress.title}
          </div>
          <div className="text-xs sm:text-sm text-text truncate flex-1">{currentLabel}</div>
          <div className="text-[11px] font-mono text-text-dim flex-shrink-0">
            {Math.floor(pct * 100)}%
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden border border-border">
          <div
            className="h-full bg-gradient-to-r from-cyan to-magenta transition-all duration-200"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="card-glow p-6 sm:p-8 relative overflow-hidden min-h-[460px]">
      <div className="absolute -top-32 -right-32 w-64 h-64 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-48 h-48 rounded-full bg-magenta/10 blur-3xl pointer-events-none" />

      <div className="relative">
        <div className="flex items-center gap-2 text-cyan text-[10px] sm:text-xs uppercase tracking-widest font-semibold">
          <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
          {t.optimize_progress.title}
        </div>
        <h2 className="text-xl sm:text-2xl font-bold mt-2 leading-tight">
          {currentLabel}
        </h2>
        <p className="text-text-muted text-xs sm:text-sm mt-1.5">
          {finished ? t.optimize_progress.hint_done : t.optimize_progress.hint}
        </p>

        {/* Progress bar — gradient fill, smoothed via CSS transition. */}
        <div className="mt-4 sm:mt-6">
          <div className="flex justify-between text-[11px] font-mono mb-1.5">
            <span className="text-text-muted">
              {Math.floor(pct * 100)}%
            </span>
            <span className="text-text-dim">
              {Math.floor(elapsed)}s
            </span>
          </div>
          <div className="h-2 rounded-full bg-bg-elevated overflow-hidden border border-border">
            <div
              className="h-full bg-gradient-to-r from-cyan to-magenta shadow-glow transition-all duration-200"
              style={{ width: `${pct * 100}%` }}
            />
          </div>
        </div>

        {/* Step list — past steps get a check, current gets a spinner,
            future steps get a dim dot. All steps are shown at once (no inner
            scroll) so the user sees the whole pipeline in a single view. */}
        <ol className="mt-4 sm:mt-6 space-y-1.5">
          {STEPS.map((s, i) => {
            const isPast = i < stepIdx;
            const isCurrent = i === stepIdx && !finished;
            const isFuture = i > stepIdx;
            return (
              <li
                key={s.key as string}
                className={`flex items-start gap-2.5 text-xs sm:text-sm transition-colors ${
                  isCurrent
                    ? "text-cyan"
                    : isPast
                    ? "text-text-muted"
                    : "text-text-dim"
                }`}
              >
                <span className="mt-0.5 flex-shrink-0 w-4 h-4 inline-flex items-center justify-center">
                  {isPast || (finished && i < STEPS.length) ? (
                    <Check className="w-4 h-4 text-positive" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-text-dim" />
                  )}
                </span>
                <span className={isFuture ? "opacity-60" : undefined}>
                  {t.optimize_progress.steps[s.key]}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
