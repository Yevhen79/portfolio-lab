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
}

export default function AllocationTable({ weights }: { weights: Weight[] }) {
  const t = useT();
  return (
    <div className="overflow-auto rounded-xl border border-border max-h-[520px]">
      <table className="w-full text-sm">
        <thead className="bg-bg-elevated sticky top-0 z-10">
          <tr className="text-text-muted text-[11px] uppercase tracking-wider">
            <th className="text-left px-4 py-3 font-medium">{t.table.col_symbol}</th>
            <th className="text-left px-4 py-3 font-medium">{t.table.col_name}</th>
            <th className="text-left px-4 py-3 font-medium">{t.table.col_category}</th>
            <th className="text-right px-4 py-3 font-medium">{t.table.col_weight}</th>
            <th className="text-right px-4 py-3 font-medium">{t.table.col_usd}</th>
            <th className="text-right px-4 py-3 font-medium">{t.table.col_e_r_annual}</th>
            <th className="text-right px-4 py-3 font-medium">{t.table.col_sigma_annual}</th>
          </tr>
        </thead>
        <tbody>
          {weights.map((w) => (
            <tr key={w.symbol} className="border-t border-border hover:bg-bg-elevated/50 transition-colors">
              <td className="px-4 py-3 font-mono font-semibold text-cyan">{w.symbol}</td>
              <td className="px-4 py-3 text-text-muted">{w.name}</td>
              <td className="px-4 py-3">
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
              <td className="px-4 py-3 text-right font-mono font-semibold">{fmtPct(w.weight)}</td>
              <td className="px-4 py-3 text-right font-mono">{fmtUSD(w.amount_usd, 0)}</td>
              <td className="px-4 py-3 text-right font-mono text-positive">{fmtPct(w.expected_return_annual)}</td>
              <td className="px-4 py-3 text-right font-mono text-text-muted">{fmtPct(w.volatility_annual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
