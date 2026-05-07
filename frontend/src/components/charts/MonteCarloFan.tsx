import Plot from "react-plotly.js";

import { NEON, PLOT_CONFIG, PLOT_LAYOUT_DEFAULTS } from "./plotly_theme";

interface Props {
  months: number[];
  median: number[];
  p5: number[];
  p25: number[];
  p75: number[];
  p95: number[];
  paths_sample?: number[][];
  initial: number;
  benchmarkValue?: number | null;
  height?: number;
}

export default function MonteCarloFan({
  months,
  median,
  p5,
  p25,
  p75,
  p95,
  paths_sample,
  initial,
  benchmarkValue,
  height = 460,
}: Props) {
  const data: any[] = [];

  // p5-p95 outer band
  data.push({
    x: months.concat([...months].reverse()),
    y: p95.concat([...p5].reverse()),
    fill: "toself",
    fillcolor: "rgba(0,212,255,0.08)",
    line: { color: "rgba(0,0,0,0)" },
    showlegend: true,
    name: "5th–95th percentile",
    hoverinfo: "skip",
    type: "scatter",
  });
  // p25-p75 inner band
  data.push({
    x: months.concat([...months].reverse()),
    y: p75.concat([...p25].reverse()),
    fill: "toself",
    fillcolor: "rgba(0,212,255,0.18)",
    line: { color: "rgba(0,0,0,0)" },
    showlegend: true,
    name: "25th–75th percentile",
    hoverinfo: "skip",
    type: "scatter",
  });

  if (paths_sample && paths_sample.length > 0) {
    paths_sample.slice(0, 30).forEach((path) => {
      data.push({
        x: months,
        y: path,
        type: "scatter",
        mode: "lines",
        showlegend: false,
        line: { color: "rgba(255,0,170,0.10)", width: 1 },
        hoverinfo: "skip",
      });
    });
  }

  data.push({
    x: months,
    y: median,
    type: "scatter",
    mode: "lines",
    name: "Median path",
    line: { color: NEON.cyan, width: 2.5 },
    hovertemplate: "Month %{x}<br>Median: $%{y:,.0f}<extra></extra>",
  });

  data.push({
    x: [months[0], months[months.length - 1]],
    y: [initial, initial],
    type: "scatter",
    mode: "lines",
    name: "Initial capital",
    line: { color: NEON.muted, width: 1, dash: "dot" },
    hoverinfo: "skip",
  });

  if (benchmarkValue !== null && benchmarkValue !== undefined) {
    const benchPath = months.map(
      (m) => initial * Math.pow(benchmarkValue / initial, m / months[months.length - 1]),
    );
    data.push({
      x: months,
      y: benchPath,
      type: "scatter",
      mode: "lines",
      name: "S&P 500 (geometric)",
      line: { color: NEON.amber, width: 2, dash: "dash" },
      hovertemplate: "Month %{x}<br>S&P 500: $%{y:,.0f}<extra></extra>",
    });
  }

  const layout: any = {
    ...PLOT_LAYOUT_DEFAULTS,
    height,
    xaxis: { ...PLOT_LAYOUT_DEFAULTS.xaxis, title: { text: "Months", font: { color: NEON.muted } }, dtick: 1 },
    yaxis: { ...PLOT_LAYOUT_DEFAULTS.yaxis, title: { text: "Portfolio Value (USD)", font: { color: NEON.muted } } },
  };
  return <Plot data={data} layout={layout} config={PLOT_CONFIG} style={{ width: "100%" }} />;
}
