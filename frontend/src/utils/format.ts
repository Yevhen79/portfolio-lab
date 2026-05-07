export function fmtPct(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtNum(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

export function fmtUSD(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(x);
}

export function fmtDate(s: string): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export function fmtPnLClass(x: number): string {
  if (x > 0.0001) return "text-positive";
  if (x < -0.0001) return "text-negative";
  return "text-text-muted";
}

export const CATEGORY_COLORS: Record<string, string> = {
  stock: "#00D4FF",
  index: "#7C5CFF",
  commodity: "#FFB300",
  crypto: "#FF00AA",
  fx: "#00FF94",
  etf: "#FF6B9D",
};

export function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] || "#8A92AB";
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export interface WeightLike {
  symbol: string;
  name: string;
  category: string;
  weight: number;
  amount_usd: number;
  expected_return_annual: number;
  volatility_annual: number;
}

/**
 * Sparsify weights for display: drop entries below `threshold` (default 1%)
 * and renormalize the surviving weights to sum to 1.0.
 *
 * Used everywhere the UI shows allocation (pie, bar, table) so floating-point
 * noise from the optimizer never appears as "0.00%" rows or microscopic slices.
 */
export function sparsifyForDisplay(
  weights: WeightLike[] | undefined | null,
  threshold = 0.01,
): WeightLike[] {
  if (!Array.isArray(weights) || weights.length === 0) return [];
  const kept = weights.filter((w) => Number.isFinite(w.weight) && w.weight >= threshold);
  const total = kept.reduce((s, w) => s + w.weight, 0);
  if (total <= 0) return [];
  const ratio = 1 / total;
  return kept
    .map((w) => ({
      ...w,
      weight: w.weight * ratio,
      amount_usd: w.amount_usd * ratio,
    }))
    .sort((a, b) => b.weight - a.weight);
}
