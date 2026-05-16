import { api } from "./client";
import type { OptimizeRequest, OptimizeResponse } from "./portfolios";

/** Backtest request shape = OptimizeRequest + required `as_of_date`. */
export interface BacktestRequest extends OptimizeRequest {
  /** ISO YYYY-MM-DD. Must be in the past — optimiser sees data up to and
   *  including this date, the realised window starts the next month. */
  as_of_date: string;
  /** ISO YYYY-MM-DD. End of the realised window. Defaults to
   *  min(as_of + 12 months, today) when omitted. Must be after as_of and
   *  not in the future. */
  forward_end_date?: string | null;
}

export interface RealizedAssetReturn {
  symbol: string;
  name: string;
  weight: number;
  expected_return_annual: number;
  realized_return: number;
}

export interface RealizedMetrics {
  months_observed: number;
  forward_start: string;
  forward_end: string;

  total_return: number;
  /** Annualised arithmetic μ × 12. Null if window is shorter than ~3 months. */
  return_annual: number | null;
  /** Geometric CAGR. Null if window is shorter than 12 months. */
  cagr_annual: number | null;
  volatility_annual: number | null;
  sharpe_ratio: number | null;
  max_drawdown: number;
  final_value: number;

  equity_path: number[];
  equity_timestamps: string[];

  per_asset: RealizedAssetReturn[];

  benchmark_total_return: number | null;
  benchmark_return_annual: number | null;
}

export interface ComparisonRow {
  metric: string;
  planned: number | null;
  actual: number | null;
  format: "pct" | "ratio" | "usd";
}

export interface BacktestResponse {
  as_of_date: string;
  forward_window_end: string;
  months_observed: number;
  plan: OptimizeResponse;
  realized: RealizedMetrics | null;
  comparison: { rows: ComparisonRow[] };
}

export async function runBacktest(req: BacktestRequest): Promise<BacktestResponse> {
  const r = await api.post("/backtest", req);
  return r.data;
}
