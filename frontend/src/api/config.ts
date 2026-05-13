import { api } from "./client";

export type DeploymentMode = "personal" | "libertex_lite";

export interface AppConfig {
  deployment_mode: DeploymentMode;
  app_name: string;
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
  };
}

export async function fetchConfig(): Promise<AppConfig> {
  const r = await api.get("/config");
  return r.data;
}
