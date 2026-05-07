import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Filter, Plus, Search } from "lucide-react";

import * as api from "../api/portfolios";
import type { PortfolioListItem } from "../api/portfolios";
import Section from "../components/Section";
import { useT, tpl } from "../i18n";
import { fmtDate, fmtNum, fmtPct, fmtUSD } from "../utils/format";

type FilterMode = "all" | "mine" | "shared";

export default function History() {
  const t = useT();
  const [items, setItems] = useState<PortfolioListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.listPortfolios();
        setItems(r.portfolios);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = items
    .filter((p) => (filter === "mine" ? p.is_mine : filter === "shared" ? !p.is_mine : true))
    .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.owner_name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight neon-text inline-block">{t.history.page_title}</h1>
          <p className="text-text-muted mt-1">{t.history.page_subtitle}</p>
        </div>
        <Link to="/build" className="btn-primary inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> {t.history.new_portfolio}
        </Link>
      </div>

      <Section
        title={filtered.length === 1 ? t.history.n_portfolios_one : tpl(t.history.n_portfolios, { n: filtered.length })}
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
              <input
                type="text"
                placeholder={t.history.search}
                className="input pl-9 py-2 w-64"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center bg-bg-elevated border border-border rounded-xl p-1">
              {([
                { v: "all" as const, label: t.history.filter_all },
                { v: "mine" as const, label: t.history.filter_mine },
                { v: "shared" as const, label: t.history.filter_shared },
              ]).map((f) => (
                <button
                  key={f.v}
                  onClick={() => setFilter(f.v)}
                  className={`px-3 py-1.5 text-sm rounded-lg capitalize transition-colors ${
                    filter === f.v ? "bg-cyan/15 text-cyan" : "text-text-muted hover:text-text"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {loading ? (
          <div className="text-text-muted text-center py-12">{t.dashboard.loading}</div>
        ) : filtered.length === 0 ? (
          <div className="text-text-muted text-center py-12 flex flex-col items-center gap-3">
            <Filter className="w-8 h-8 opacity-40" />
            {t.history.no_match}
          </div>
        ) : (
          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated">
                <tr className="text-text-muted text-[11px] uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">{t.history.col_name}</th>
                  <th className="text-left px-4 py-3 font-medium">{t.history.col_owner}</th>
                  <th className="text-left px-4 py-3 font-medium">{t.history.col_type}</th>
                  <th className="text-right px-4 py-3 font-medium">{t.history.col_capital}</th>
                  <th className="text-right px-4 py-3 font-medium">{t.history.col_return}</th>
                  <th className="text-right px-4 py-3 font-medium">{t.history.col_vol}</th>
                  <th className="text-right px-4 py-3 font-medium">{t.history.col_sharpe}</th>
                  <th className="text-right px-4 py-3 font-medium">{t.history.col_created}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-bg-elevated/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/portfolio/${p.id}`} className="text-text hover:text-cyan font-medium">
                        {p.name}
                      </Link>
                      {p.is_public && <span className="ml-2 badge text-cyan bg-cyan/10 border border-cyan/30">{t.history.public_badge}</span>}
                    </td>
                    <td className="px-4 py-3 text-text-muted">{p.owner_name}</td>
                    <td className="px-4 py-3 text-text-muted capitalize">{p.portfolio_type.replace("_", " ")}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtUSD(p.initial_capital, 0)}</td>
                    <td className="px-4 py-3 text-right font-mono text-positive">{fmtPct(p.expected_return_annual)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtPct(p.volatility_annual)}</td>
                    <td className="px-4 py-3 text-right font-mono text-cyan">{fmtNum(p.sharpe_ratio, 2)}</td>
                    <td className="px-4 py-3 text-right text-text-muted text-xs">{fmtDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
