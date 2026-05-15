import { useCallback, useRef } from "react";
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

  // Keep `sorted` accessible in event handlers without re-binding on every
  // render — the imperative click listeners we attach in `onInitialized`
  // run outside React's render cycle, so they read this ref instead of
  // closing over a possibly-stale `sorted` array.
  const sortedRef = useRef(sorted);
  sortedRef.current = sorted;

  /** Robust bar-click wiring that defeats two Plotly quirks:
   *
   *  1. **`plotly_click` is unreliable.** Plotly suppresses the event when
   *     the cursor moved > ~5 px between mousedown and mouseup. On touchpads
   *     and high-DPI mice this fires constantly, so user taps silently
   *     do nothing.
   *
   *  2. **Bar paths have `pointer-events: none`.** Plotly puts a transparent
   *     drag overlay on top to handle hover hit-testing, so listeners on
   *     the path elements themselves never receive events.
   *
   *  Workaround: attach a single DOM `click` listener to the graph div and
   *  hit-test by geometry. `getBoundingClientRect()` reads from the layout
   *  tree directly — it doesn't care about `pointer-events`. The browser's
   *  native `click` event fires on any complete mousedown+mouseup pair on
   *  the same element, with no MINDRAG threshold, so trackpad drift is fine.
   *
   *  Re-runs harmlessly on every relayout — we tag the gd so subsequent
   *  calls are no-ops. */
  const wireBarClicks = useCallback(
    (gd: HTMLElement) => {
      if (!onBarClick) return;
      if ((gd as any).__pl_bar_click_bound) return;
      (gd as any).__pl_bar_click_bound = true;
      gd.addEventListener("click", (ev) => {
        const paths = gd.querySelectorAll<SVGPathElement>(
          ".barlayer .trace.bars .points .point path",
        );
        // Hit-test in DOM order. Hover tooltip stays untouched because we
        // never read or alter pointer-events on the path nodes.
        for (let i = 0; i < paths.length; i++) {
          const r = paths[i].getBoundingClientRect();
          if (
            r.width > 0 && r.height > 0 &&
            ev.clientX >= r.left && ev.clientX <= r.right &&
            ev.clientY >= r.top && ev.clientY <= r.bottom
          ) {
            const w = sortedRef.current[i];
            if (w) onBarClick(w.symbol);
            ev.stopPropagation();
            return;
          }
        }
      });
    },
    [onBarClick],
  );

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
      onInitialized={(_figure, gd) => wireBarClicks(gd as unknown as HTMLElement)}
      onUpdate={(_figure, gd) => wireBarClicks(gd as unknown as HTMLElement)}
      onClick={(e: any) => {
        // Belt-and-braces: Plotly's own plotly_click event also wired, in
        // case the SVG click path is somehow blocked on some browsers. If
        // both fire the symbol is the same; the parent's state guard makes
        // double-trigger a no-op.
        if (!onBarClick) return;
        const pt = e?.points?.[0];
        const idx = pt?.pointNumber ?? pt?.pointIndex;
        if (typeof idx !== "number" || idx < 0 || idx >= sorted.length) return;
        onBarClick(sorted[idx].symbol);
      }}
    />
  );
}
