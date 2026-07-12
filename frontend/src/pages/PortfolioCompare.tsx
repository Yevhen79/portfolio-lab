import { useEffect, useState } from "react";
import { GitCompare, X, Plus } from "lucide-react";

import * as api from "../api/portfolios";
import type { PortfolioListItem, PortfolioOut } from "../api/portfolios";
import EfficientFrontier from "../components/charts/EfficientFrontier";
import Section from "../components/Section";
import Plot from "react-plotly.js";
import { NEON, PLOT_CONFIG, PLOT_LAYOUT_DEFAULTS } from "../components/charts/plotly_theme";
import { useT } from "../i18n";
import { fmtNum, fmtPct, fmtUSD } from "../utils/format";

const COLOURS = [NEON.cyan, NEON.magenta, NEON.green];

export default function PortfolioCompare() {
  const t = useT();
  const [available, setAvailable] = useState<PortfolioListItem[]>([]);
  const [selected, setSelected] = useState<PortfolioOut[]>([]);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await api.listPortfolios();
      setAvailable(r.portfolios);
    })();
  }, []);

  async function add(id: number) {
    if (selected.find((p) => p.id === id)) return;
    if (selected.length >= 3) return;
    const p = await api.getPortfolio(id);
    setSelected([...selected, p]);
    setPicker(false);
  }

  function remove(id: number) {
    setSelected(selected.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight neon-text inline-block">{t.compare.page_title}</h1>
        <p className="text-text-muted mt-1">{t.compare.page_subtitle}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {selected.map((p, idx) => (
          <div key={p.id} className="card-glow p-5 relative" style={{ borderColor: COLOURS[idx] }}>
            <button onClick={() => remove(p.id)} className="absolute top-3 right-3 text-text-dim hover:text-red">
              <X className="w-4 h-4" />
            </button>
            <div className="font-semibold truncate" style={{ color: COLOURS[idx] }}>{p.name}</div>
            <div className="text-xs text-text-muted mb-3">by {p.owner_name}</div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <div className="text-text-dim">Return</div>
                <div className="font-mono font-bold text-positive">{fmtPct(p.expected_return_annual)}</div>
              </div>
              <div>
                <div className="text-text-dim">Risk</div>
                <div className="font-mono font-bold">{fmtPct(p.volatility_annual)}</div>
              </div>
              <div>
                <div className="text-text-dim">Sharpe</div>
                <div className="font-mono font-bold text-cyan">{fmtNum(p.sharpe_ratio, 2)}</div>
              </div>
            </div>
          </div>
        ))}
        {selected.length < 3 && (
          <button
            onClick={() => setPicker(!picker)}
            className="card border-dashed border-2 border-border hover:border-cyan p-5 flex items-center justify-center gap-2 text-text-muted hover:text-cyan transition-colors min-h-[140px]"
          >
            <Plus className="w-5 h-5" /> {t.compare.add_portfolio}
          </button>
        )}
      </div>

      {picker && (
        <Section title={t.compare.pick_portfolio} action={<button onClick={() => setPicker(false)} className="btn-ghost">{t.compare.cancel}</button>}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[400px] overflow-auto">
            {available.filter((p) => !selected.find((s) => s.id === p.id)).map((p) => (
              <button
                key={p.id}
                onClick={() => add(p.id)}
                className="card-glow group p-3 text-left"
              >
                <div className="font-medium truncate group-hover:text-cyan transition-colors">{p.name}</div>
                <div className="text-xs text-text-muted truncate">{p.owner_name}</div>
                <div className="text-xs mt-1 text-cyan font-mono">{t.dashboard.sharpe_short} {fmtNum(p.sharpe_ratio, 2)}</div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {selected.length >= 2 && (
        <>
          <Section title={t.compare.risk_return_map}>
            <Plot
              data={selected.map((p, idx) => ({
                x: [p.volatility_annual * 100],
                y: [p.expected_return_annual * 100],
                type: "scatter",
                mode: "markers+text",
                name: p.name,
                text: [p.name],
                textposition: "top center",
                textfont: { color: COLOURS[idx], size: 12 },
                marker: { size: 22, color: COLOURS[idx], line: { color: "#fff", width: 2 }, symbol: "star" },
                hovertemplate: `${p.name}<br>Return: %{y:.2f}%<br>Risk: %{x:.2f}%<extra></extra>`,
              }))}
              layout={{
                ...PLOT_LAYOUT_DEFAULTS,
                height: 400,
                showlegend: false,
                xaxis: { ...PLOT_LAYOUT_DEFAULTS.xaxis, title: { text: "Volatility (%)" } },
                yaxis: { ...PLOT_LAYOUT_DEFAULTS.yaxis, title: { text: "Expected Return (%)" } },
              }}
              config={PLOT_CONFIG}
              style={{ width: "100%" }}
            />
          </Section>

          <Section title={t.compare.metrics_title}>
            <div className="overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-bg-elevated">
                  <tr>
                    <th className="text-left px-4 py-3 text-text-muted text-[11px] uppercase">{t.history.col_type}</th>
                    {selected.map((p, idx) => (
                      <th key={p.id} className="text-right px-4 py-3 font-semibold" style={{ color: COLOURS[idx] }}>
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    [t.compare.metric_initial_capital, (p: PortfolioOut) => fmtUSD(p.initial_capital, 0)],
                    [t.compare.metric_expected_return, (p: PortfolioOut) => fmtPct(p.expected_return_annual)],
                    [t.compare.metric_volatility, (p: PortfolioOut) => fmtPct(p.volatility_annual)],
                    [t.compare.metric_sharpe, (p: PortfolioOut) => fmtNum(p.sharpe_ratio, 3)],
                    [t.compare.metric_sortino, (p: PortfolioOut) => fmtNum(p.sortino_ratio, 3)],
                    [t.compare.metric_var, (p: PortfolioOut) => fmtPct(p.var_95_annual)],
                    [t.compare.metric_cvar, (p: PortfolioOut) => fmtPct(p.cvar_95_annual)],
                    [t.compare.metric_max_dd, (p: PortfolioOut) => fmtPct(p.max_drawdown_estimate)],
                    [t.compare.metric_assets, (p: PortfolioOut) => `${p.weights.length}`],
                    [t.compare.metric_type, (p: PortfolioOut) => p.portfolio_type],
                  ].map(([label, fn], i) => (
                    <tr key={i as number} className="border-t border-border row-hover">
                      <td className="px-4 py-3 text-text-muted">{label as string}</td>
                      {selected.map((p) => (
                        <td key={p.id} className="px-4 py-3 text-right font-mono">{(fn as any)(p)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title={t.compare.combined_frontier}>
            <Plot
              data={selected.flatMap((p, idx) => [
                {
                  x: (p.efficient_frontier || []).map((q: any) => q.risk_annual * 100),
                  y: (p.efficient_frontier || []).map((q: any) => q.return_annual * 100),
                  type: "scatter",
                  mode: "lines",
                  name: p.name,
                  line: { color: COLOURS[idx], width: 2 },
                },
                {
                  x: [p.volatility_annual * 100],
                  y: [p.expected_return_annual * 100],
                  type: "scatter",
                  mode: "markers",
                  name: `${p.name} pick`,
                  showlegend: false,
                  marker: { size: 16, color: COLOURS[idx], symbol: "star", line: { color: "#fff", width: 2 } },
                },
              ])}
              layout={{
                ...PLOT_LAYOUT_DEFAULTS,
                height: 460,
                xaxis: { ...PLOT_LAYOUT_DEFAULTS.xaxis, title: { text: "Volatility (%)" } },
                yaxis: { ...PLOT_LAYOUT_DEFAULTS.yaxis, title: { text: "Return (%)" } },
              }}
              config={PLOT_CONFIG}
              style={{ width: "100%" }}
            />
          </Section>
        </>
      )}

      {selected.length === 0 && (
        <div className="card p-12 text-center">
          <GitCompare className="w-12 h-12 text-text-dim mx-auto mb-3" />
          <div className="text-text-muted">{t.compare.empty}</div>
        </div>
      )}
    </div>
  );
}
