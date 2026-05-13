import Plot from "react-plotly.js";

import { categoryColor } from "../../utils/format";
import { NEON, PLOT_CONFIG, PLOT_LAYOUT_DEFAULTS } from "./plotly_theme";

interface Weight {
  symbol: string;
  name: string;
  category: string;
  weight: number;
  amount_usd: number;
}

interface Props {
  weights: Weight[];
  height?: number;
  /** Click handler fired with the asset's symbol when the user clicks a bar.
   *  Used by the builder/view pages to pop up the price-history modal. */
  onBarClick?: (symbol: string) => void;
}

// Truncate names too long for the chart's left margin while keeping them
// recognisable. 32 chars caps at ~6 short words on desktop; on phones we
// drop to 14 because the margin is tiny — anything longer gets the ticker.
const MAX_LABEL_LEN_DESKTOP = 32;
const MAX_LABEL_LEN_MOBILE = 14;
const trimName = (s: string, cap: number): string =>
  s.length <= cap ? s : s.slice(0, cap - 1).trimEnd() + "…";

export default function WeightsBar({ weights, height = 460, onBarClick }: Props) {
  const sorted = [...weights].sort((a, b) => b.weight - a.weight);
  const values = sorted.map((w) => w.weight * 100);
  const colors = sorted.map((w) => categoryColor(w.category));

  // Tailwind sm: breakpoint is 640 px — below that we tighten everything for
  // a phone (iPhone 16 Pro Max is 440 px wide). We pick the layout once at
  // render time; Plotly auto-resizes when the parent reflows, but the margin
  // / font-size choices below are baked in.
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  const labelCap = isMobile ? MAX_LABEL_LEN_MOBILE : MAX_LABEL_LEN_DESKTOP;
  // On mobile prefer the (shorter) ticker over a truncated long name —
  // "Texas Pacif…" reads worse than "TPL".
  const labels = sorted.map((w) => {
    if (!w.name || w.name === w.symbol) return w.symbol;
    if (isMobile && w.name.length > labelCap + 4) return w.symbol;
    return trimName(w.name, labelCap);
  });
  const customdata = sorted.map((w) => [w.symbol, `$${w.amount_usd.toFixed(0)}`]);

  return (
    <Plot
      data={[
        {
          x: values,
          y: labels,
          type: "bar",
          orientation: "h",
          marker: { color: colors, line: { color: NEON.bg, width: 1 } },
          text: values.map((v) => `${v.toFixed(2)}%`),
          textposition: "outside",
          textfont: { color: NEON.text, family: "JetBrains Mono", size: 11 },
          customdata,
          hovertemplate:
            "<b>%{customdata[0]}</b> · %{y}<br>%{customdata[1]} · %{x:.2f}%<extra></extra>",
        } as any,
      ]}
      layout={{
        ...PLOT_LAYOUT_DEFAULTS,
        height: Math.max(height, (isMobile ? 60 : 80) + labels.length * (isMobile ? 22 : 24)),
        // Left margin tracks viewport: 230 px to fit full company names on
        // desktop, 90 px on phones because the labels there are tickers /
        // 14-char names. r: 36 leaves room for the "% outside" labels.
        margin: { l: isMobile ? 90 : 230, r: isMobile ? 36 : 60, t: 10, b: 30 },
        xaxis: { ...PLOT_LAYOUT_DEFAULTS.xaxis, title: { text: "Weight (%)", font: { color: NEON.muted } } },
        yaxis: {
          ...PLOT_LAYOUT_DEFAULTS.yaxis,
          autorange: "reversed",
          tickfont: {
            color: NEON.text,
            family: "Inter, sans-serif",
            size: isMobile ? 10 : 11,
          },
          automargin: false,
        },
      }}
      config={PLOT_CONFIG}
      style={{ width: "100%" }}
      className={onBarClick ? "plotly-clickable" : undefined}
      onClick={(e: any) => {
        // Plotly hands us an event with `points`. For a horizontal bar each
        // point has `pointNumber` (= index in our `sorted` array). We pluck
        // the symbol from there rather than parsing the label, because the
        // label is trimmed/aliased.
        if (!onBarClick) return;
        const pt = e?.points?.[0];
        const idx = pt?.pointNumber ?? pt?.pointIndex;
        if (typeof idx !== "number" || idx < 0 || idx >= sorted.length) return;
        onBarClick(sorted[idx].symbol);
      }}
    />
  );
}
