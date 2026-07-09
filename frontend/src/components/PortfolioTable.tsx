import { Link } from "react-router-dom";

import type { PortfolioListItem } from "../api/portfolios";
import { useT } from "../i18n";
import { fmtDate, fmtNum, fmtPct, fmtUSD } from "../utils/format";

/**
 * Responsive portfolio table. Shared by History and (in the libertex edition)
 * the Dashboard, so the two render identically. Columns collapse gracefully
 * on narrow screens via the xs/sm/md breakpoints.
 */
export default function PortfolioTable({ items }: { items: PortfolioListItem[] }) {
  const t = useT();
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-none sm:rounded-xl border-y sm:border border-border">
      <table className="w-full text-xs sm:text-sm">
        <thead className="bg-bg-elevated">
          <tr className="text-text-muted text-[10px] sm:text-[11px] uppercase tracking-wider">
            <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium">{t.history.col_name}</th>
            <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium hidden sm:table-cell">{t.history.col_owner}</th>
            <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium hidden md:table-cell">{t.history.col_type}</th>
            <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium hidden xs:table-cell">{t.history.col_capital}</th>
            <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium">{t.history.col_return}</th>
            <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium hidden sm:table-cell">{t.history.col_vol}</th>
            <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium">{t.history.col_sharpe}</th>
            <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium hidden xs:table-cell">{t.history.col_created}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="border-t border-border hover:bg-bg-elevated/50 transition-colors">
              <td className="px-2 sm:px-4 py-2 sm:py-3 max-w-[180px] sm:max-w-none">
                <Link to={`/portfolio/${p.id}`} className="text-text hover:text-cyan font-medium block truncate">
                  {p.name}
                </Link>
                {p.is_public && <span className="ml-1 sm:ml-2 badge text-cyan bg-cyan/10 border border-cyan/30">{t.history.public_badge}</span>}
              </td>
              <td className="px-2 sm:px-4 py-2 sm:py-3 text-text-muted hidden sm:table-cell">{p.owner_name}</td>
              <td className="px-2 sm:px-4 py-2 sm:py-3 text-text-muted capitalize hidden md:table-cell">{p.portfolio_type.replace("_", " ")}</td>
              <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono hidden xs:table-cell whitespace-nowrap">{fmtUSD(p.initial_capital, 0)}</td>
              <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono text-positive whitespace-nowrap">{fmtPct(p.expected_return_annual)}</td>
              <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono hidden sm:table-cell whitespace-nowrap">{fmtPct(p.volatility_annual)}</td>
              <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono text-cyan whitespace-nowrap">{fmtNum(p.sharpe_ratio, 2)}</td>
              <td className="px-2 sm:px-4 py-2 sm:py-3 text-right text-text-muted text-xs hidden xs:table-cell whitespace-nowrap">{fmtDate(p.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
