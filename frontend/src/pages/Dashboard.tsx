import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BarChart3, GitCompare, History, Plus, Sparkles, TrendingUp, Zap } from "lucide-react";

import * as api from "../api/portfolios";
import type { PortfolioListItem } from "../api/portfolios";
import Section from "../components/Section";
import { useT } from "../i18n";
import { useAuth } from "../store/auth";
import { fmtDate, fmtNum, fmtPct, fmtUSD } from "../utils/format";

export default function Dashboard() {
  const { user } = useAuth();
  const t = useT();
  const [items, setItems] = useState<PortfolioListItem[]>([]);
  const [loading, setLoading] = useState(true);

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

  const myPortfolios = items.filter((p) => p.is_mine);
  const sharedPortfolios = items.filter((p) => !p.is_mine);
  const bestSharpe = [...items].sort((a, b) => b.sharpe_ratio - a.sharpe_ratio)[0];

  return (
    <div className="space-y-4 sm:space-y-8">
      {/* Hero */}
      <div className="card-glow p-5 sm:p-8 relative overflow-hidden">
        <div className="absolute -top-32 -right-32 w-64 h-64 rounded-full bg-cyan/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-48 h-48 rounded-full bg-magenta/15 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-cyan text-[10px] sm:text-xs uppercase tracking-widest font-semibold">
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> {t.dashboard.welcome}, {user?.name}
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold mt-2 sm:mt-3 leading-tight max-w-3xl">
            {t.dashboard.hero_title_pre} <span className="neon-text">{t.dashboard.hero_title_em}</span>{t.dashboard.hero_title_post}
          </h1>
          <p className="text-xs sm:text-base text-text-muted mt-2 sm:mt-3 max-w-2xl">{t.dashboard.hero_subtitle}</p>
          <div className="mt-4 sm:mt-6 flex flex-wrap gap-2 sm:gap-3">
            <Link to="/build" className="btn-primary inline-flex items-center gap-2 text-sm">
              <Plus className="w-4 h-4" /> {t.dashboard.build_new}
            </Link>
            <Link to="/history" className="btn-ghost inline-flex items-center gap-2 text-sm">
              <History className="w-4 h-4" /> {t.dashboard.view_history}
            </Link>
            <Link to="/compare" className="btn-ghost inline-flex items-center gap-2 text-sm">
              <GitCompare className="w-4 h-4" /> {t.dashboard.compare_btn}
            </Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="card-glow p-4 sm:p-5">
          <div className="text-[10px] sm:text-[11px] uppercase tracking-widest text-text-dim font-medium flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" /> {t.dashboard.my_portfolios}
          </div>
          <div className="metric-value text-cyan mt-2">{myPortfolios.length}</div>
        </div>
        <div className="card-glow p-4 sm:p-5">
          <div className="text-[10px] sm:text-[11px] uppercase tracking-widest text-text-dim font-medium flex items-center gap-1.5">
            <GitCompare className="w-3.5 h-3.5" /> {t.dashboard.shared}
          </div>
          <div className="metric-value text-magenta mt-2">{sharedPortfolios.length}</div>
        </div>
        <div className="card-glow p-4 sm:p-5">
          <div className="text-[10px] sm:text-[11px] uppercase tracking-widest text-text-dim font-medium flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" /> {t.dashboard.best_sharpe}
          </div>
          <div className="metric-value text-positive mt-2">{bestSharpe ? fmtNum(bestSharpe.sharpe_ratio, 2) : "—"}</div>
          {bestSharpe && <div className="text-xs text-text-muted truncate mt-0.5">{bestSharpe.name}</div>}
        </div>
        <div className="card-glow p-4 sm:p-5">
          <div className="text-[10px] sm:text-[11px] uppercase tracking-widest text-text-dim font-medium flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> {t.dashboard.quota_today}
          </div>
          {user?.role === "admin" ? (
            <div className="metric-value text-cyan mt-2">∞</div>
          ) : (
            <div className="metric-value text-cyan mt-2">
              {user?.quota?.today_used ?? 0}
              <span className="text-text-muted text-base">
                {" "}/ {(user?.quota?.today_limit ?? 0) + (user?.quota?.bonus_today ?? 0)}
              </span>
            </div>
          )}
        </div>
      </div>

      <Section title={t.dashboard.recent_title} subtitle={t.dashboard.recent_subtitle}>
        {loading ? (
          <div className="text-text-muted text-center py-8">{t.dashboard.loading}</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-text-muted">{t.dashboard.no_portfolios_yet}</p>
            <Link to="/build" className="btn-primary mt-4 inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> {t.dashboard.build_new}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.slice(0, 9).map((p) => (
              <Link
                key={p.id}
                to={`/portfolio/${p.id}`}
                className="card-glow p-5 group hover:scale-[1.01] transition-transform"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="font-semibold truncate text-text group-hover:text-cyan transition-colors">{p.name}</div>
                  <ArrowRight className="w-4 h-4 text-text-dim group-hover:text-cyan transition-colors flex-shrink-0" />
                </div>
                <div className="text-xs text-text-muted mb-3 flex items-center gap-2 flex-wrap">
                  <span>{t.dashboard.by} {p.owner_name}</span>
                  <span>·</span>
                  <span className="capitalize">{p.portfolio_type.replace("_", " ")}</span>
                  {!p.is_mine && (
                    <span className="badge text-magenta bg-magenta/10 border border-magenta/30">{t.dashboard.shared_badge}</span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] text-text-dim uppercase tracking-wider">{t.dashboard.return_short}</div>
                    <div className="font-mono text-positive font-semibold mt-0.5">{fmtPct(p.expected_return_annual)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-dim uppercase tracking-wider">{t.dashboard.risk_short}</div>
                    <div className="font-mono text-text mt-0.5">{fmtPct(p.volatility_annual)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-dim uppercase tracking-wider">{t.dashboard.sharpe_short}</div>
                    <div className="font-mono text-cyan font-semibold mt-0.5">{fmtNum(p.sharpe_ratio, 2)}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs text-text-muted">
                  <span>{fmtUSD(p.initial_capital, 0)}</span>
                  <span>{fmtDate(p.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
