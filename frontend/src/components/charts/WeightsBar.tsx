import Plot from "react-plotly.js";

import { categoryColor } from "../../utils/format";
import { NEON, PLOT_CONFIG, PLOT_LAYOUT_DEFAULTS } from "./plotly_theme";

interface Props {
  weights: Array<{ symbol: string; name: string; category: string; weight: number; amount_usd: number }>;
  height?: number;
}

export default function WeightsBar({ weights, height = 460 }: Props) {
  const sorted = [...weights].sort((a, b) => b.weight - a.weight);
  const symbols = sorted.map((w) => w.symbol);
  const values = sorted.map((w) => w.weight * 100);
  const colors = sorted.map((w) => categoryColor(w.category));

  return (
    <Plot
      data={[
        {
          x: values,
          y: symbols,
          type: "bar",
          orientation: "h",
          marker: { color: colors, line: { color: NEON.bg, width: 1 } },
          text: values.map((v) => `${v.toFixed(2)}%`),
          textposition: "outside",
          textfont: { color: NEON.text, family: "JetBrains Mono", size: 11 },
          hovertemplate: "%{y}: %{x:.2f}%<extra></extra>",
        } as any,
      ]}
      layout={{
        ...PLOT_LAYOUT_DEFAULTS,
        height: Math.max(height, 80 + symbols.length * 24),
        margin: { l: 90, r: 60, t: 10, b: 30 },
        xaxis: { ...PLOT_LAYOUT_DEFAULTS.xaxis, title: { text: "Weight (%)", font: { color: NEON.muted } } },
        yaxis: { ...PLOT_LAYOUT_DEFAULTS.yaxis, autorange: "reversed", tickfont: { color: NEON.text, family: "JetBrains Mono", size: 11 } },
      }}
      config={PLOT_CONFIG}
      style={{ width: "100%" }}
    />
  );
}
