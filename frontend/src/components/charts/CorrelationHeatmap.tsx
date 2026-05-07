import Plot from "react-plotly.js";

import { PLOT_CONFIG, PLOT_LAYOUT_DEFAULTS } from "./plotly_theme";

interface Props {
  symbols: string[];
  matrix: number[][];
  height?: number;
}

export default function CorrelationHeatmap({ symbols, matrix, height = 480 }: Props) {
  if (!symbols.length) {
    return (
      <div className="text-text-muted text-center py-12">
        No correlation data available.
      </div>
    );
  }
  return (
    <Plot
      data={[
        {
          z: matrix,
          x: symbols,
          y: symbols,
          type: "heatmap",
          colorscale: [
            [0, "#FF3B5C"],
            [0.25, "#FF00AA"],
            [0.5, "#0F1424"],
            [0.75, "#00D4FF"],
            [1, "#00FF94"],
          ],
          zmin: -1,
          zmax: 1,
          showscale: true,
          hovertemplate: "%{y} ↔ %{x}<br>ρ = %{z:.2f}<extra></extra>",
          colorbar: { tickfont: { color: "#8A92AB", size: 10 }, thickness: 12 },
        } as any,
      ]}
      layout={{
        ...PLOT_LAYOUT_DEFAULTS,
        height,
        margin: { l: 60, r: 30, t: 20, b: 60 },
        xaxis: { ...PLOT_LAYOUT_DEFAULTS.xaxis, side: "bottom", tickangle: -45 },
        yaxis: { ...PLOT_LAYOUT_DEFAULTS.yaxis, autorange: "reversed" },
      }}
      config={PLOT_CONFIG}
      style={{ width: "100%" }}
    />
  );
}
