import Plot from "react-plotly.js";

import { NEON, PLOT_CONFIG, PLOT_LAYOUT_DEFAULTS } from "./plotly_theme";

interface Props {
  paths_sample: number[][];
  initial: number;
  height?: number;
}

export default function DistributionChart({ paths_sample, initial, height = 320 }: Props) {
  const finals = paths_sample.map((p) => p[p.length - 1]);
  if (!finals.length) return null;

  return (
    <Plot
      data={[
        {
          x: finals,
          type: "histogram",
          name: "Final values",
          marker: { color: NEON.cyan, line: { color: NEON.bg, width: 1 } },
          opacity: 0.85,
          nbinsx: 40,
        } as any,
      ]}
      layout={{
        ...PLOT_LAYOUT_DEFAULTS,
        height,
        showlegend: false,
        shapes: [
          {
            type: "line",
            x0: initial,
            x1: initial,
            y0: 0,
            y1: 1,
            yref: "paper",
            line: { color: NEON.amber, width: 2, dash: "dot" },
          },
        ],
        annotations: [
          {
            x: initial,
            y: 1,
            yref: "paper",
            text: "Initial",
            showarrow: false,
            font: { color: NEON.amber, size: 10 },
            xanchor: "left",
          },
        ],
        xaxis: { ...PLOT_LAYOUT_DEFAULTS.xaxis, title: { text: "Final portfolio value (USD)", font: { color: NEON.muted } } },
        yaxis: { ...PLOT_LAYOUT_DEFAULTS.yaxis, title: { text: "Frequency", font: { color: NEON.muted } } },
      }}
      config={PLOT_CONFIG}
      style={{ width: "100%" }}
    />
  );
}
