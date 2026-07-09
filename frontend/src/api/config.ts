import { api } from "./client";

export type DeploymentMode = "personal" | "libertex_lite";
export type Edition = "full" | "libertex";

export interface AppConfig {
  deployment_mode: DeploymentMode;
  /** Which product this instance is. Drives branding + theme. */
  edition: Edition;
  app_name: string;
  tagline: string;
  /** Broker term interpolated into copy: "" for full, "Libertex" for libertex. */
  broker_name: string;
  /** Theme key the UI applies to <html data-theme>: "full" | "libertex". */
  theme: string;
  features: {
    max_assets: number;
    advanced_metrics: boolean;
    black_litterman: boolean;
    monte_carlo: boolean;
    custom_constraints: boolean;
    broker_api: boolean;
    export_formats: string[];
    cov_methods: string[];
    geometric_mean: boolean;
    history_max_years: number;
    monte_carlo_sims: number;
    /** UI simplifications for the libertex gift build (all false in full). */
    hide_swaps_ui: boolean;
    force_swaps: boolean;
    hide_min_variance: boolean;
    ai_strategy_naming: boolean;
    hide_backtest: boolean;
    hide_compare: boolean;
    nobel_hero: boolean;
    dashboard_table: boolean;
    hide_history: boolean;
    advanced_collapsed: boolean;
    hide_cov_method: boolean;
    hide_universe_presets: boolean;
    hide_sparsify: boolean;
    hide_extra_metrics: boolean;
  };
}

export async function fetchConfig(): Promise<AppConfig> {
  const r = await api.get("/config");
  return r.data;
}
