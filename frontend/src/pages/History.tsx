import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Filter, Plus, Search } from "lucide-react";

import * as api from "../api/portfolios";
import type { PortfolioListItem } from "../api/portfolios";
import PortfolioTable from "../components/PortfolioTable";
import Section from "../components/Section";
import { useT, tpl } from "../i18n";

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
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight neon-text inline-block">{t.history.page_title}</h1>
          <p className="text-xs sm:text-base text-text-muted mt-1">{t.history.page_subtitle}</p>
        </div>
        <Link to="/build" className="btn-primary inline-flex items-center gap-2 text-sm self-start md:self-auto">
          <Plus className="w-4 h-4" /> {t.history.new_portfolio}
        </Link>
      </div>

      <Section
        title={filtered.length === 1 ? t.history.n_portfolios_one : tpl(t.history.n_portfolios, { n: filtered.length })}
        action={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
              <input
                type="text"
                placeholder={t.history.search}
                className="input pl-9 py-2 w-full sm:w-64"
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
                  className={`flex-1 px-2 sm:px-3 py-1.5 text-xs sm:text-sm rounded-lg capitalize transition-colors ${
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
          <PortfolioTable items={filtered} />
        )}
      </Section>
    </div>
  );
}
