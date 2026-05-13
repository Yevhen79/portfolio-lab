import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, FileText, Globe, Loader2, Lock, Trash2 } from "lucide-react";

import { errorMessage } from "../api/client";
import * as api from "../api/portfolios";
import type { PortfolioOut } from "../api/portfolios";
import AllocationTable from "../components/AllocationTable";
import AssetHistoryModal from "../components/AssetHistoryModal";
import CorrelationHeatmap from "../components/charts/CorrelationHeatmap";
import DistributionChart from "../components/charts/DistributionChart";
import EfficientFrontier from "../components/charts/EfficientFrontier";
import MonteCarloFan from "../components/charts/MonteCarloFan";
import WeightsBar from "../components/charts/WeightsBar";
import PortfolioMetrics from "../components/PortfolioMetrics";
import Section from "../components/Section";
import { useT, tpl } from "../i18n";
import { useAuth } from "../store/auth";
import { fmtDate, fmtPct, fmtUSD, sparsifyForDisplay } from "../utils/format";

export default function PortfolioView() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const t = useT();
  const [data, setData] = useState<PortfolioOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historySymbol, setHistorySymbol] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      setLoading(true); setError(null);
      try {
        setData(await api.getPortfolio(Number(id)));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function togglePublic() {
    if (!data) return;
    const upd = await api.updatePortfolio(data.id, { is_public: !data.is_public });
    setData({ ...data, is_public: upd.is_public });
  }

  async function remove() {
    if (!data || !confirm(t.portfolio_view.confirm_delete)) return;
    await api.deletePortfolio(data.id);
    nav("/history");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 text-cyan animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="card p-8">
        <p className="text-red">{error || t.portfolio_view.not_found}</p>
        <Link to="/history" className="btn-ghost mt-4 inline-flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> {t.portfolio_view.back_to_history}
        </Link>
      </div>
    );
  }

  const isMine = user && data.user_id === user.id;
  const benchValue = data.benchmark_comparison?.expected_value_12m ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <button onClick={() => nav(-1)} className="text-text-muted hover:text-cyan text-sm flex items-center gap-1 mb-2">
            <ArrowLeft className="w-4 h-4" /> {t.portfolio_view.back}
          </button>
          <h1 className="text-3xl font-bold tracking-tight neon-text inline-block">{data.name}</h1>
          <div className="text-text-muted text-sm mt-1 flex items-center gap-3">
            <span>{t.portfolio_view.by} <span className="text-text">{data.owner_name}</span></span>
            <span>·</span>
            <span>{fmtDate(data.created_at)}</span>
            <span>·</span>
            <span className="capitalize">{data.portfolio_type.replace("_", " ")}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => api.downloadFile(data.id, "pdf")} className="btn-ghost inline-flex items-center gap-2">
            <FileText className="w-4 h-4" /> {t.portfolio_view.download_pdf}
          </button>
          <button onClick={() => api.downloadFile(data.id, "excel")} className="btn-ghost inline-flex items-center gap-2">
            <Download className="w-4 h-4" /> {t.portfolio_view.download_excel}
          </button>
          {isMine && (
            <>
              <button onClick={togglePublic} className="btn-ghost inline-flex items-center gap-2">
                {data.is_public ? <Globe className="w-4 h-4 text-cyan" /> : <Lock className="w-4 h-4" />}
                {data.is_public ? t.portfolio_view.public : t.portfolio_view.private}
              </button>
              <button onClick={remove} className="btn-danger inline-flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> {t.portfolio_view.delete}
              </button>
            </>
          )}
        </div>
      </div>

      {data.notes && (
        <div className="card p-4 text-sm text-text-muted italic">"{data.notes}"</div>
      )}

      <div className="card-glow p-6">
        <PortfolioMetrics data={data} />
      </div>

      {(() => {
        const visible = sparsifyForDisplay(data.weights, 0.01);
        const hidden = data.weights.length - visible.length;
        const subtitle = hidden > 0
          ? tpl(t.portfolio_view.aa_subtitle_filtered, { visible: visible.length, hidden, capital: fmtUSD(data.initial_capital, 0) })
          : tpl(t.portfolio_view.aa_subtitle_full, { visible: visible.length, capital: fmtUSD(data.initial_capital, 0) });
        return (
          <Section
            title={t.builder.asset_allocation}
            subtitle={subtitle}
            action={<span className="text-[11px] text-text-dim italic">{t.asset_modal.click_hint}</span>}
          >
            {/* Bar chart spans the whole section — the pie used to duplicate it. */}
            <WeightsBar weights={visible} onBarClick={setHistorySymbol} />
            <div className="mt-6">
              <AllocationTable weights={visible} />
            </div>
          </Section>
        );
      })()}

      {data.efficient_frontier && data.efficient_frontier.length > 0 && (
        <Section title={t.builder.efficient_frontier_title} subtitle={t.builder.efficient_frontier_subtitle}>
          <EfficientFrontier
            frontier={data.efficient_frontier as any}
            selected={{ return: data.expected_return_annual, risk: data.volatility_annual, label: data.name }}
            riskFreeRate={data.risk_free_rate}
          />
        </Section>
      )}

      {data.monte_carlo && (
        <Section
          title={t.builder.forecast_title}
          subtitle={tpl(t.portfolio_view.forecast_subtitle, { n: data.monte_carlo.n_simulations.toLocaleString(), value: fmtUSD(data.monte_carlo.expected_value, 0) })}
        >
          <MonteCarloFan
            months={data.monte_carlo.months}
            median={data.monte_carlo.median_path}
            p5={data.monte_carlo.p5_path}
            p25={data.monte_carlo.p25_path}
            p75={data.monte_carlo.p75_path}
            p95={data.monte_carlo.p95_path}
            paths_sample={data.monte_carlo.paths_sample}
            initial={data.initial_capital}
            benchmarkValue={benchValue}
          />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            {[
              { k: t.builder.pct_worst, v: data.monte_carlo.percentiles.p5, c: "text-negative" },
              { k: t.builder.pct_25th, v: data.monte_carlo.percentiles.p25, c: "text-text" },
              { k: t.builder.pct_median, v: data.monte_carlo.percentiles.p50, c: "text-cyan" },
              { k: t.builder.pct_75th, v: data.monte_carlo.percentiles.p75, c: "text-text" },
              { k: t.builder.pct_best, v: data.monte_carlo.percentiles.p95, c: "text-positive" },
            ].map((p) => (
              <div key={p.k} className="card p-3 text-center">
                <div className="text-[10px] uppercase tracking-widest text-text-dim">{p.k}</div>
                <div className={`font-mono text-lg font-bold ${p.c}`}>{fmtUSD(p.v, 0)}</div>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <DistributionChart paths_sample={data.monte_carlo.paths_sample} initial={data.initial_capital} />
          </div>
        </Section>
      )}

      {data.benchmark_comparison?.available && (
        <Section title={t.builder.benchmark_title} subtitle={t.builder.benchmark_subtitle}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card p-4">
              <div className="text-xs text-text-muted uppercase tracking-wider">{t.builder.benchmark_return}</div>
              <div className="text-2xl font-mono font-bold mt-1">{fmtPct(data.benchmark_comparison.expected_return_annual)}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-text-muted uppercase tracking-wider">{t.builder.benchmark_vol}</div>
              <div className="text-2xl font-mono font-bold mt-1">{fmtPct(data.benchmark_comparison.volatility_annual)}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-text-muted uppercase tracking-wider">{t.builder.alpha_label}</div>
              <div className={`text-2xl font-mono font-bold mt-1 ${data.benchmark_comparison.alpha_vs_benchmark >= 0 ? "text-positive" : "text-negative"}`}>
                {data.benchmark_comparison.alpha_vs_benchmark >= 0 ? "+" : ""}
                {fmtPct(data.benchmark_comparison.alpha_vs_benchmark)}
              </div>
            </div>
          </div>
        </Section>
      )}

      {data.correlation_matrix?.symbols && data.correlation_matrix.symbols.length > 1 && (
        <Section title={t.builder.correlation_title}>
          <CorrelationHeatmap
            symbols={data.correlation_matrix.symbols}
            matrix={data.correlation_matrix.matrix}
          />
        </Section>
      )}

      <Section title={t.portfolio_view.config_title}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          {[
            [t.portfolio_view.config_type, data.portfolio_type],
            [t.portfolio_view.config_risk_tolerance, data.risk_tolerance],
            [t.portfolio_view.config_target_return, data.target_return ? fmtPct(data.target_return) : "—"],
            [t.portfolio_view.config_target_risk, data.target_risk ? fmtPct(data.target_risk) : "—"],
            [t.portfolio_view.config_cov_method, data.cov_method],
            [t.portfolio_view.config_history_window, `${data.history_years}y`],
            [t.portfolio_view.config_min_history, `${data.min_history_years}y`],
            [t.portfolio_view.config_universe_size, `${data.universe_size} ${t.portfolio_view.assets_unit}`],
            [t.portfolio_view.config_sparsified, data.sparsified ? t.portfolio_view.yes : t.portfolio_view.no],
          ].map(([k, v]) => (
            <div key={k} className="card p-3">
              <div className="text-[10px] uppercase tracking-widest text-text-dim">{k}</div>
              <div className="font-mono text-text mt-0.5">{v}</div>
            </div>
          ))}
        </div>
      </Section>

      <AssetHistoryModal
        symbol={historySymbol}
        years={data.history_years || 20}
        onClose={() => setHistorySymbol(null)}
      />
    </div>
  );
}
