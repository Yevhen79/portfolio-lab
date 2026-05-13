import { X } from "lucide-react";

import { useT } from "../i18n";
import { categoryColor, fmtPct, fmtUSD } from "../utils/format";

interface Weight {
  symbol: string;
  name: string;
  category: string;
  weight: number;
  amount_usd: number;
  expected_return_annual: number;
  volatility_annual: number;
  cagr_annual?: number | null;
}

interface Props {
  weights: Weight[];
  /** When provided, a small × button appears at the end of each row that
   *  hands the symbol back to the parent — used by the builder page to
   *  drop an asset from the universe and re-optimize. Omit on read-only
   *  views (saved portfolios, compare view) so the action doesn't show. */
  onExclude?: (symbol: string) => void;
}

export default function AllocationTable({ weights, onExclude }: Props) {
  const t = useT();
  const showExclude = typeof onExclude === "function";
  // Compact cells on phones: tighter horizontal padding, smaller text, no name
  // column wrapping. The table itself is wrapped in `overflow-auto` so the
  // user can still horizontally scroll to reach σ / CAGR if they care.
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-none sm:rounded-xl border-y sm:border border-border max-h-[520px]">
      <table className="w-full text-xs sm:text-sm">
        <thead className="bg-bg-elevated sticky top-0 z-10">
          <tr className="text-text-muted text-[10px] sm:text-[11px] uppercase tracking-wider">
            <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium">{t.table.col_symbol}</th>
            <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium hidden sm:table-cell">{t.table.col_name}</th>
            <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium hidden xs:table-cell">{t.table.col_category}</th>
            <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium">{t.table.col_weight}</th>
            <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium">{t.table.col_usd}</th>
            <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium" title="Arithmetic μ × 12 — used by the optimiser">{t.table.col_e_r_annual}</th>
            <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium" title="Geometric (compound) annual return — what buy-and-hold actually realised">{t.table.col_cagr_annual}</th>
            <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium hidden sm:table-cell">{t.table.col_sigma_annual}</th>
            {showExclude && <th className="w-8 px-1 py-2 sm:py-3" />}
          </tr>
        </thead>
        <tbody>
          {weights.map((w) => {
            const cagr = w.cagr_annual ?? null;
            const drag = cagr !== null ? w.expected_return_annual - cagr : null;
            // Flag rows where variance drag is > 10 pp — those are the
            // "looks great on arithmetic, terrible on CAGR" suspects (VIX, etc.)
            const dragWarn = drag !== null && drag > 0.10;
            return (
              <tr key={w.symbol} className="border-t border-border hover:bg-bg-elevated/50 transition-colors group">
                <td className="px-2 sm:px-4 py-2 sm:py-3 font-mono font-semibold text-cyan whitespace-nowrap">{w.symbol}</td>
                <td className="px-2 sm:px-4 py-2 sm:py-3 text-text-muted hidden sm:table-cell">{w.name}</td>
                <td className="px-2 sm:px-4 py-2 sm:py-3 hidden xs:table-cell">
                  <span
                    className="badge"
                    style={{
                      color: categoryColor(w.category),
                      backgroundColor: categoryColor(w.category) + "15",
                      border: `1px solid ${categoryColor(w.category)}40`,
                    }}
                  >
                    {w.category}
                  </span>
                </td>
                <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono font-semibold whitespace-nowrap">{fmtPct(w.weight)}</td>
                <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono whitespace-nowrap">{fmtUSD(w.amount_usd, 0)}</td>
                <td className={`px-2 sm:px-4 py-2 sm:py-3 text-right font-mono whitespace-nowrap ${dragWarn ? "text-amber" : "text-positive"}`}
                    title={dragWarn ? `Arithmetic μ overstates CAGR by ${(drag!*100).toFixed(1)} pp — variance drag` : undefined}>
                  {fmtPct(w.expected_return_annual)}
                </td>
                <td className={`px-2 sm:px-4 py-2 sm:py-3 text-right font-mono whitespace-nowrap ${cagr !== null && cagr < 0 ? "text-negative" : "text-text"}`}>
                  {cagr !== null ? fmtPct(cagr) : "—"}
                </td>
                <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono text-text-muted whitespace-nowrap hidden sm:table-cell">{fmtPct(w.volatility_annual)}</td>
                {showExclude && (
                  <td className="px-1 py-2 sm:py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onExclude!(w.symbol)}
                      title={t.builder.exclude_button_title}
                      aria-label={t.builder.exclude_button_title}
                      // On touch screens the row has no :hover, so always show
                      // the × instead of relying on `group-hover` opacity.
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-text-dim opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-red/10 hover:text-red transition-all"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
