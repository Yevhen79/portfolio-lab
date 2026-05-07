import Plot from "react-plotly.js";

import { categoryColor } from "../../utils/format";
import { PLOT_CONFIG, PLOT_LAYOUT_DEFAULTS } from "./plotly_theme";

interface Props {
  weights: Array<{ symbol: string; name: string; category: string; weight: number; amount_usd: number }>;
  height?: number;
}

export default function WeightsPie({ weights, height = 400 }: Props) {
  const labels = weights.map((w) => w.symbol);
  const values = weights.map((w) => w.weight * 100);
  const colors = weights.map((w) => categoryColor(w.category));
  const text = weights.map(
    (w) => `${w.symbol}<br>${w.name}<br>$${w.amount_usd.toFixed(0)}`,
  );

  return (
    <Plot
      data={[
        {
          type: "pie",
          labels,
          values,
          text,
          hoverinfo: "label+percent+text",
          textinfo: "label+percent",
          textfont: { color: "#fff", size: 11, family: "JetBrains Mono" },
          marker: { colors, line: { color: "#0F1424", width: 1.5 } },
          hole: 0.55,
          sort: false,
          rotation: 90,
        } as any,
      ]}
      layout={{
        ...PLOT_LAYOUT_DEFAULTS,
        height,
        showlegend: false,
        margin: { l: 10, r: 10, t: 10, b: 10 },
        annotations: [
          {
            text: `${weights.length}<br><span style="font-size:11px;color:#8A92AB">assets</span>`,
            x: 0.5,
            y: 0.5,
            showarrow: false,
            font: { color: "#00D4FF", size: 28, family: "JetBrains Mono" },
          },
        ],
      }}
      config={PLOT_CONFIG}
      style={{ width: "100%" }}
    />
  );
}
