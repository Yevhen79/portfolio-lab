import Plot from "react-plotly.js";

import { NEON, PLOT_CONFIG, PLOT_LAYOUT_DEFAULTS } from "./plotly_theme";

interface Props {
  frontier: Array<{ return_annual: number; risk_annual: number }>;
  selected?: { return: number; risk: number; label?: string };
  riskFreeRate?: number;
  height?: number;
}

export default function EfficientFrontier({ frontier, selected, riskFreeRate, height = 400 }: Props) {
  const x = frontier.map((p) => p.risk_annual * 100);
  const y = frontier.map((p) => p.return_annual * 100);

  const data: any[] = [
    {
      x,
      y,
      type: "scatter",
      mode: "lines",
      name: "Efficient Frontier",
      line: { color: NEON.cyan, width: 2.5 },
      hovertemplate: "Risk: %{x:.2f}%<br>Return: %{y:.2f}%<extra></extra>",
    },
    {
      x,
      y,
      type: "scatter",
      mode: "lines",
      fill: "tozeroy",
      showlegend: false,
      line: { color: "rgba(0,212,255,0)" },
      fillcolor: "rgba(0,212,255,0.06)",
      hoverinfo: "skip",
    },
  ];

  if (selected) {
    data.push({
      x: [selected.risk * 100],
      y: [selected.return * 100],
      type: "scatter",
      mode: "markers+text",
      name: selected.label || "Your Portfolio",
      text: [selected.label || "★"],
      textposition: "top center",
      textfont: { color: NEON.magenta, size: 13, family: "JetBrains Mono" },
      marker: {
        size: 18,
        color: NEON.magenta,
        line: { color: "#fff", width: 2 },
        symbol: "star",
      },
      hovertemplate: "Risk: %{x:.2f}%<br>Return: %{y:.2f}%<extra></extra>",
    });
  }

  if (riskFreeRate !== undefined && selected) {
    const slope = (selected.return - riskFreeRate) / selected.risk;
    const xLine = [0, Math.max(...x) * 1.1];
    const yLine = xLine.map((xi) => (riskFreeRate * 100) + slope * xi);
    data.push({
      x: xLine,
      y: yLine,
      type: "scatter",
      mode: "lines",
      name: "Capital Market Line",
      line: { color: NEON.amber, width: 1.5, dash: "dash" },
      hovertemplate: "CML — slope %{customdata:.2f}<extra></extra>",
      customdata: xLine.map(() => slope),
    });
  }

  const layout: any = {
    ...PLOT_LAYOUT_DEFAULTS,
    height,
    title: { text: "", font: { size: 0 } },
    xaxis: { ...PLOT_LAYOUT_DEFAULTS.xaxis, title: { text: "Volatility (annual %)", font: { color: NEON.muted } } },
    yaxis: { ...PLOT_LAYOUT_DEFAULTS.yaxis, title: { text: "Expected Return (annual %)", font: { color: NEON.muted } } },
  };

  return <Plot data={data} layout={layout} config={PLOT_CONFIG} style={{ width: "100%" }} />;
}
