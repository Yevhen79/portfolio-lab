import { api } from "./client";

export interface AssetWeight {
  symbol: string;
  name: string;
  category: string;
  weight: number;
  amount_usd: number;
  expected_return_annual: number;
  volatility_annual: number;
  /** Geometric annual return (CAGR) over the asset's own full history.
   *  Null if not provided by backend (e.g. libertex_lite mode). */
  cagr_annual?: number | null;
}

export interface MonteCarloResult {
  n_simulations: number;
  n_months: number;
  initial_capital: number;
  expected_value: number;
  expected_return_pct: number;
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  var_95: number;
  cvar_95: number;
  median_path: number[];
  p5_path: number[];
  p25_path: number[];
  p75_path: number[];
  p95_path: number[];
  paths_sample: number[][];
  months: number[];
}

export interface OptimizeRequest {
  portfolio_type: "min_variance" | "max_sharpe" | "target_return" | "target_risk";
  initial_capital: number;
  risk_tolerance: "conservative" | "moderate" | "aggressive";
  target_return?: number | null;
  target_risk?: number | null;
  history_years: number;
  min_history_years: number;
  cov_method: "ledoit_wolf" | "sample" | "ewma";
  long_only: boolean;
  sparsify: boolean;
  sparsify_threshold: number;
  /** Per-asset hard cap on weight. Prevents single-asset "portfolios" at
   *  the feasibility boundary. 0.35 default. Set to 1.0 to disable. */
  max_weight_per_asset?: number;
  /** Subtract Libertex overnight-swap costs from each asset's returns before
   *  optimising. Mirrors what the user actually keeps after holding CFDs on
   *  a Libertex account. Default false — historical-only as a baseline. */
  apply_swaps?: boolean;
  max_assets_in_universe: number;
  categories?: string[] | null;
  /** Tickers to PULL OUT of the universe before optimisation. Matched
   *  case-insensitively against `Asset.symbol`. Backend default is []. */
  exclude_symbols?: string[];
  /** "Drop from peak" filter — exclude assets currently more than X
   *  fraction below their historical peak. 0.60 = drop if last/peak < 0.40.
   *  Set to 1.0 to disable. Backend default 0.60 catches names like
   *  ENPH-2024 (last ~$100 vs peak $329 = 68% below ATH). */
  max_drop_from_peak_pct?: number;
  /** Restrict universe to MetaTrader-tradeable instruments only. After
   *  dedup ~80 assets (mostly blue-chip stocks + popular crypto + a few
   *  FX crosses). Default false = full Libertex CFD pool. */
  mt_only?: boolean;
}

export interface OptimizeResponse {
  portfolio_type: string;
  initial_capital: number;
  weights: AssetWeight[];
  universe_size: number;
  sparsified: boolean;
  expected_return_annual: number;
  /** Geometric mean (CAGR) of the realised portfolio. Compare with arithmetic
   *  `expected_return_annual` to see variance drag — large gap = volatile mix. */
  cagr_annual: number;
  volatility_annual: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  var_95_annual: number;
  cvar_95_annual: number;
  max_drawdown_estimate: number;
  risk_free_rate: number;
  efficient_frontier: Array<Record<string, number>>;
  monte_carlo: MonteCarloResult;
  correlation_matrix: { symbols: string[]; matrix: number[][] };
  benchmark_comparison: any;
  history_years: number;
  min_history_years: number;
  cov_method: string;
  estimation_window_start: string;
  estimation_window_end: string;
  /** Per-run pipeline trace id. Empty string if persistence failed. */
  trace_id?: string;
}

export async function downloadTrace(traceId: string): Promise<void> {
  const r = await api.get(`/optimize/trace/${encodeURIComponent(traceId)}`, {
    responseType: "blob",
  });
  const blob = new Blob([r.data], { type: "text/markdown; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `portfolio-trace-${traceId.slice(0, 8)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface PortfolioListItem {
  id: number;
  user_id: number;
  owner_name: string;
  name: string;
  portfolio_type: string;
  initial_capital: number;
  expected_return_annual: number;
  volatility_annual: number;
  sharpe_ratio: number;
  is_public: boolean;
  is_mine: boolean;
  created_at: string;
}

export interface PortfolioOut extends OptimizeResponse {
  id: number;
  user_id: number;
  owner_name: string;
  name: string;
  risk_tolerance: string;
  target_return: number | null;
  target_risk: number | null;
  is_public: boolean;
  notes: string | null;
  created_at: string;
}

export async function optimize(req: OptimizeRequest): Promise<OptimizeResponse> {
  const r = await api.post("/optimize", req);
  return r.data;
}

export async function quotaStatus() {
  const r = await api.get("/optimize/quota-status");
  return r.data;
}

export async function savePortfolio(payload: {
  name: string;
  notes?: string | null;
  is_public: boolean;
  optimize_request: OptimizeRequest;
  optimize_result: OptimizeResponse;
}): Promise<PortfolioOut> {
  const r = await api.post("/portfolios", payload);
  return r.data;
}

export async function listPortfolios(): Promise<{ portfolios: PortfolioListItem[]; total: number }> {
  const r = await api.get("/portfolios");
  return r.data;
}

export async function getPortfolio(id: number): Promise<PortfolioOut> {
  const r = await api.get(`/portfolios/${id}`);
  return r.data;
}

export async function updatePortfolio(id: number, patch: { name?: string; notes?: string; is_public?: boolean }) {
  const r = await api.patch(`/portfolios/${id}`, patch);
  return r.data;
}

export async function deletePortfolio(id: number) {
  await api.delete(`/portfolios/${id}`);
}

export async function downloadFile(id: number, kind: "pdf" | "excel") {
  const r = await api.get(`/export/portfolio/${id}/${kind}`, { responseType: "blob" });
  const blob = new Blob([r.data], {
    type: kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `portfolio_${id}.${kind === "pdf" ? "pdf" : "xlsx"}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
