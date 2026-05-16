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

// Per-render width check. Plotly layouts get reused across pages, but we
// need to switch legend placement (right→bottom) and disable pan/zoom on
// touch devices. Each chart component grabs this once at render time.
const isNarrow = (): boolean =>
  typeof window !== "undefined" && window.innerWidth < 640;

const isTouch = (): boolean =>
  typeof window !== "undefined" &&
  (("ontouchstart" in window) || (navigator as any).maxTouchPoints > 0);

const narrow = isNarrow();
const touch = isTouch();

export const PLOT_LAYOUT_DEFAULTS: any = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { family: "Inter, sans-serif", color: NEON.text, size: 12 },
  margin: { l: 60, r: 24, t: 30, b: 50 },
  // Disable drag/zoom on touch devices so a vertical finger-swipe scrolls the
  // page instead of getting eaten by Plotly's zoom-rect interaction. The bar
  // chart's own click handler still fires via DOM events.
  dragmode: touch ? false : "zoom",
  xaxis: {
    gridcolor: NEON.border,
    zerolinecolor: NEON.border,
    linecolor: NEON.border,
    tickfont: { color: NEON.muted, size: 11 },
    fixedrange: touch,
  },
  yaxis: {
    gridcolor: NEON.border,
    zerolinecolor: NEON.border,
    linecolor: NEON.border,
    tickfont: { color: NEON.muted, size: 11 },
    fixedrange: touch,
  },
  legend: narrow
    ? {
        // On phones the legend goes BELOW the plot, horizontal, centred.
        // Otherwise it overlays the chart and covers half the data.
        orientation: "h",
        bgcolor: "rgba(15,20,36,0.7)",
        bordercolor: NEON.border,
        borderwidth: 1,
        font: { color: NEON.text, size: 10 },
        yanchor: "top",
        y: -0.18,
        xanchor: "center",
        x: 0.5,
      }
    : {
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
  // Drop the toolbar entirely on mobile — the user never uses the camera /
  // pan / autoscale buttons on a phone, and the toolbar leaks into the
  // chart area causing visual confusion.
  displayModeBar: !touch,
  scrollZoom: false,
  doubleClick: touch ? false : "reset",
  modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d", "toggleSpikelines"],
};
