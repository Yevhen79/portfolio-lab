import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { Loader2, X, AlertCircle } from "lucide-react";

import { getAssetPrices, type AssetPriceHistory } from "../api/assets";
import { errorMessage } from "../api/client";
import { NEON, PLOT_CONFIG, PLOT_LAYOUT_DEFAULTS } from "./charts/plotly_theme";
import { useT } from "../i18n";
import { categoryColor, fmtPct, fmtUSD } from "../utils/format";

interface Props {
  symbol: string | null;
  years: number;
  onClose: () => void;
}

/** Modal showing the historical price line for a single instrument over the
 *  current optimisation window. Opened when the user clicks a bar in the
 *  allocation chart. */
export default function AssetHistoryModal({ symbol, years, onClose }: Props) {
  const t = useT();
  const [data, setData] = useState<AssetPriceHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetch when symbol changes (i.e. modal opens for a new asset). We don't
  // refetch on `years` changes during the lifetime of an open modal — the
  // user can close and reopen if they tweak the slider.
  useEffect(() => {
    if (!symbol) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    getAssetPrices(symbol, years)
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(errorMessage(e, t.asset_modal.error_generic));
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, years, t.asset_modal.error_generic]);

  // Close on Esc — wired regardless of state so the listener disappears when
  // the modal unmounts (the parent unmounts us when `symbol` is null).
  useEffect(() => {
    if (!symbol) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [symbol, onClose]);

  const plotData = useMemo(() => {
    if (!data) return null;
    const xs = data.points.map((p) => p.date);
    const ys = data.points.map((p) => p.close);
    const color = categoryColor(data.category) || NEON.cyan;
    return [
      {
        x: xs,
        y: ys,
        type: "scatter" as const,
        mode: "lines" as const,
        name: data.symbol,
        line: { color, width: 2 },
        hovertemplate: "%{x|%b %Y}<br><b>%{y:,.2f}</b> " + (data.currency || "") + "<extra></extra>",
      },
    ];
  }, [data]);

  if (!symbol) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        // Close when clicking the backdrop (but not when clicking inside).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card-glow w-full max-w-5xl h-full sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-2xl overflow-hidden flex flex-col">
        <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-border">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
              <span className="font-mono font-bold text-cyan text-xl sm:text-2xl">{symbol}</span>
              {data?.name && data.name !== data.symbol && (
                <span className="text-text-muted text-sm sm:text-lg truncate">{data.name}</span>
              )}
              {data?.category && (
                <span
                  className="badge"
                  style={{
                    color: categoryColor(data.category),
                    backgroundColor: categoryColor(data.category) + "15",
                    border: `1px solid ${categoryColor(data.category)}40`,
                  }}
                >
                  {data.category}
                </span>
              )}
            </div>
            {data && (
              <div className="text-xs text-text-muted mt-1.5 font-mono">
                {data.start} → {data.end} · {data.interval === "1wk" ? t.asset_modal.weekly : t.asset_modal.monthly}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.asset_modal.close}
            className="text-text-muted hover:text-red transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 sm:p-5">
          {busy && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-8 h-8 text-cyan animate-spin" />
              <div className="text-text-muted text-sm">{t.asset_modal.loading}</div>
            </div>
          )}
          {error && !busy && (
            <div className="flex items-start gap-3 text-red border border-red/30 rounded-xl p-4">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium">{t.asset_modal.error_title}</div>
                <div className="text-sm text-text-muted">{error}</div>
              </div>
            </div>
          )}
          {data && plotData && !busy && (
            <>
              <Plot
                data={plotData as any}
                layout={{
                  ...PLOT_LAYOUT_DEFAULTS,
                  height: 360,
                  // Tighter left margin on phones so the y-axis labels don't
                  // eat half the chart width. 50 px is enough for "1.00k"-ish
                  // tick labels.
                  margin: { l: window.innerWidth < 640 ? 50 : 70, r: 16, t: 10, b: 40 },
                  xaxis: {
                    ...PLOT_LAYOUT_DEFAULTS.xaxis,
                    type: "date",
                    rangeslider: { visible: false },
                  },
                  yaxis: {
                    ...PLOT_LAYOUT_DEFAULTS.yaxis,
                    title: { text: t.asset_modal.price + (data.currency ? ` (${data.currency})` : ""), font: { color: NEON.muted } },
                    type: data.first_close > 0 && data.last_close / data.first_close > 50 ? "log" : "linear",
                  },
                }}
                config={PLOT_CONFIG}
                style={{ width: "100%" }}
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                <Stat label={t.asset_modal.first_close} value={fmtUSD(data.first_close, 2)} />
                <Stat label={t.asset_modal.last_close} value={fmtUSD(data.last_close, 2)} />
                <Stat label={t.asset_modal.total_return} value={fmtPct(data.total_return)}
                  color={data.total_return >= 0 ? "positive" : "negative"} />
                <Stat label={t.asset_modal.cagr} value={fmtPct(data.cagr)}
                  color={data.cagr >= 0 ? "positive" : "negative"} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: "positive" | "negative" }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-widest text-text-dim">{label}</div>
      <div
        className={`font-mono text-lg font-bold mt-1 ${
          color === "positive" ? "text-positive" : color === "negative" ? "text-negative" : "text-text"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
