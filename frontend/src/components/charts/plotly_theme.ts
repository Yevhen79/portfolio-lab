export const NEON = {
  cyan: "#00D4FF",
  magenta: "#FF00AA",
  green: "#00FF94",
  red: "#FF3B5C",
  amber: "#FFB300",
  violet: "#7C5CFF",
  pink: "#FF6B9D",
  bg: "#070A12",
  surface: "#0F1424",
  border: "#1F2640",
  text: "#E5E9F4",
  muted: "#8A92AB",
  dim: "#5A627B",
};

export const PLOT_LAYOUT_DEFAULTS: any = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { family: "Inter, sans-serif", color: NEON.text, size: 12 },
  margin: { l: 60, r: 24, t: 30, b: 50 },
  xaxis: {
    gridcolor: NEON.border,
    zerolinecolor: NEON.border,
    linecolor: NEON.border,
    tickfont: { color: NEON.muted, size: 11 },
  },
  yaxis: {
    gridcolor: NEON.border,
    zerolinecolor: NEON.border,
    linecolor: NEON.border,
    tickfont: { color: NEON.muted, size: 11 },
  },
  legend: {
    bgcolor: "rgba(15,20,36,0.7)",
    bordercolor: NEON.border,
    borderwidth: 1,
    font: { color: NEON.text, size: 11 },
  },
  hoverlabel: {
    bgcolor: NEON.surface,
    bordercolor: NEON.cyan,
    font: { color: NEON.text, family: "JetBrains Mono", size: 11 },
  },
};

export const PLOT_CONFIG: any = {
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d", "toggleSpikelines"],
};
