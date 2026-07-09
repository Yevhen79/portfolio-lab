import { Activity, AlertTriangle, BarChart3, DollarSign, Shield, TrendingDown, TrendingUp, Zap } from "lucide-react";

import { useT, tpl } from "../i18n";
import { useConfig } from "../store/config";
import { fmtNum, fmtPct, fmtUSD } from "../utils/format";
import MetricCard from "./MetricCard";

interface Props {
  data: {
    cagr_annual?: number | null;
    expected_return_annual: number;
    volatility_annual: number;
    sharpe_ratio: number;
    sortino_ratio: number;
    var_95_annual: number;
    cvar_95_annual: number;
    max_drawdown_estimate: number;
    risk_free_rate: number;
    initial_capital: number;
  };
}

export default function PortfolioMetrics({ data }: Props) {
  const t = useT();
  // Libertex gift build shows a leaner result set — no CAGR, Sortino, or
  // risk-free-rate cards (false in the full edition).
  const hideExtra = useConfig((s) => s.config?.features?.hide_extra_metrics ?? false);
  const expectedValue = data.initial_capital * (1 + data.expected_return_annual);
  const cagr = data.cagr_annual ?? null;
  const cagrValue = cagr !== null ? data.initial_capital * (1 + cagr) : null;
  const drag = cagr !== null ? data.expected_return_annual - cagr : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <MetricCard
        label={t.metrics.expected_return}
        value={fmtPct(data.expected_return_annual)}
        hint={tpl(t.metrics.expected_return_hint, { from: fmtUSD(data.initial_capital, 0), to: fmtUSD(expectedValue, 0) })}
        icon={<TrendingUp className="w-4 h-4" />}
        tone={data.expected_return_annual > 0 ? "positive" : "negative"}
        tooltip={t.metrics.expected_return_tooltip}
      />
      {!hideExtra && cagr !== null && (
        <MetricCard
          label="CAGR (geometric)"
          value={fmtPct(cagr)}
          hint={
            drag !== null && Math.abs(drag) > 0.005
              ? `variance drag ${drag >= 0 ? "+" : ""}${(drag * 100).toFixed(1)} pp · ${
                  cagrValue !== null ? fmtUSD(cagrValue, 0) : ""
                }`
              : "realised geometric return"
          }
          icon={<TrendingUp className="w-4 h-4" />}
          tone={cagr > 0 ? "positive" : "negative"}
          tooltip="Compound annual growth rate from historical returns. For variance-heavy assets (VIX, crypto, levered ETFs) CAGR is materially below arithmetic μ — the gap is the variance drag."
        />
      )}
      <MetricCard
        label={t.metrics.volatility}
        value={fmtPct(data.volatility_annual)}
        hint={t.metrics.volatility_hint}
        icon={<Activity className="w-4 h-4" />}
        tone="cyan"
        tooltip={t.metrics.volatility_tooltip}
      />
      <MetricCard
        label={t.metrics.sharpe}
        value={fmtNum(data.sharpe_ratio, 3)}
        hint={tpl(t.metrics.sharpe_hint, { rate: fmtPct(data.risk_free_rate) })}
        icon={<Zap className="w-4 h-4" />}
        tone={data.sharpe_ratio >= 1 ? "positive" : data.sharpe_ratio >= 0.5 ? "cyan" : "default"}
        tooltip={t.metrics.sharpe_tooltip}
      />
      {!hideExtra && (
        <MetricCard
          label={t.metrics.sortino}
          value={fmtNum(data.sortino_ratio, 3)}
          hint={t.metrics.sortino_hint}
          icon={<Shield className="w-4 h-4" />}
          tone={data.sortino_ratio >= 1 ? "positive" : "default"}
          tooltip={t.metrics.sortino_tooltip}
        />
      )}
      <MetricCard
        label={t.metrics.var_95}
        value={fmtPct(data.var_95_annual)}
        hint={t.metrics.var_95_hint}
        icon={<AlertTriangle className="w-4 h-4" />}
        tone="magenta"
        tooltip={t.metrics.var_95_tooltip}
      />
      <MetricCard
        label={t.metrics.cvar_95}
        value={fmtPct(data.cvar_95_annual)}
        hint={t.metrics.cvar_95_hint}
        icon={<TrendingDown className="w-4 h-4" />}
        tone="negative"
        tooltip={t.metrics.cvar_95_tooltip}
      />
      <MetricCard
        label={t.metrics.max_dd}
        value={fmtPct(data.max_drawdown_estimate)}
        hint={t.metrics.max_dd_hint}
        icon={<BarChart3 className="w-4 h-4" />}
        tone="negative"
        tooltip={t.metrics.max_dd_tooltip}
      />
      {!hideExtra && (
        <MetricCard
          label={t.metrics.rfr}
          value={fmtPct(data.risk_free_rate)}
          hint={t.metrics.rfr_hint}
          icon={<DollarSign className="w-4 h-4" />}
          tooltip={t.metrics.rfr_tooltip}
        />
      )}
    </div>
  );
}
