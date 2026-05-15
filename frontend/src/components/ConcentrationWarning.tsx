import { AlertTriangle, Lightbulb } from "lucide-react";

import type { OptimizeResponse } from "../api/portfolios";
import { useT } from "../i18n";
import { fmtPct } from "../utils/format";

interface Props {
  result: OptimizeResponse;
  /** Current request params — surface the specific knobs the user can
   *  tweak in the tip list. */
  maxWeightPerAsset?: number;
  sparsifyThreshold?: number;
  minHistoryYears?: number;
}

/** Banner shown above the result when the optimiser produced a degenerate /
 *  highly-concentrated portfolio (1–2 effective positions). Math is correct
 *  but the outcome is rarely what the user actually wants — surface it
 *  explicitly and tell them which slider to move.
 *
 *  Triggers when EITHER:
 *    • fewer than 3 positions have weight ≥ 1% (the display threshold), OR
 *    • the top-1 position holds ≥ 60% of capital.
 */
export default function ConcentrationWarning({
  result,
  maxWeightPerAsset,
  sparsifyThreshold,
  minHistoryYears,
}: Props) {
  const t = useT();

  const weights = result.weights ?? [];
  const significant = weights.filter((w) => w.weight >= 0.01);
  const topWeight = weights.length > 0 ? Math.max(...weights.map((w) => w.weight)) : 0;
  const isDegenerate = significant.length < 3 || topWeight >= 0.60;
  if (!isDegenerate) return null;

  // Build the tip list dynamically based on current settings. Don't tell the
  // user "lower min-history-years" if they already have it at 6 — pointless.
  const tips: string[] = [];
  if (sparsifyThreshold !== undefined && sparsifyThreshold > 0.01) {
    tips.push(
      t.concentration.tip_lower_sparsify.replace(
        "{current}",
        fmtPct(sparsifyThreshold),
      ),
    );
  }
  if (maxWeightPerAsset === undefined || maxWeightPerAsset >= 0.99) {
    tips.push(t.concentration.tip_enable_cap);
  } else if (maxWeightPerAsset > 0.35) {
    tips.push(
      t.concentration.tip_tighten_cap.replace("{current}", fmtPct(maxWeightPerAsset)),
    );
  }
  if (minHistoryYears !== undefined && minHistoryYears > 6) {
    tips.push(
      t.concentration.tip_lower_history.replace("{current}", String(minHistoryYears)),
    );
  }
  // Always offer the "broaden categories" suggestion — it always helps.
  tips.push(t.concentration.tip_broaden_categories);

  return (
    <div className="card border-amber/30 p-4 sm:p-5 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-amber/15 border border-amber/30 flex items-center justify-center shrink-0">
        <AlertTriangle className="w-4 h-4 text-amber" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm sm:text-base font-semibold text-amber">
          {t.concentration.title}
        </div>
        <p className="text-xs sm:text-sm text-text-muted mt-1">
          {significant.length === 1
            ? t.concentration.body_one.replace("{top}", fmtPct(topWeight))
            : t.concentration.body_many
                .replace("{n}", String(significant.length))
                .replace("{top}", fmtPct(topWeight))}
        </p>
        {tips.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-1.5 text-[10px] sm:text-xs uppercase tracking-widest text-text-dim font-semibold mb-1.5">
              <Lightbulb className="w-3 h-3 text-amber" />
              {t.concentration.tips_label}
            </div>
            <ul className="space-y-1 text-xs sm:text-sm text-text-muted">
              {tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-amber mt-0.5">•</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
