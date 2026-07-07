import { create } from "zustand";

import { fetchConfig, type AppConfig } from "../api/config";

interface ConfigState {
  config: AppConfig | null;
  loading: boolean;
  load: () => Promise<void>;
  feature: <K extends keyof AppConfig["features"]>(
    key: K,
    fallback?: AppConfig["features"][K],
  ) => AppConfig["features"][K] | undefined;
}

/** Apply the edition theme to <html> so the accent CSS variables swap for the
 *  whole app, and stamp the tab title with the brand. Idempotent. */
function applyBranding(c: AppConfig): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = c.theme || "full";
  if (c.app_name) document.title = c.app_name;
}

export const useConfig = create<ConfigState>((set, get) => ({
  config: null,
  loading: false,
  load: async () => {
    if (get().config || get().loading) return;
    set({ loading: true });
    try {
      const c = await fetchConfig();
      set({ config: c, loading: false });
      applyBranding(c);
    } catch {
      set({ loading: false });
    }
  },
  feature: (key, fallback) => {
    const f = get().config?.features;
    return (f ? (f as any)[key] : fallback) as any;
  },
}));

/** Convenience selectors for branding — components read the live brand name,
 *  tagline and broker term from config (falling back to generic defaults so
 *  the UI renders before /api/config resolves). */
export function useBrand() {
  const config = useConfig((s) => s.config);
  return {
    edition: config?.edition ?? "full",
    appName: config?.app_name ?? "Portfolio Lab",
    tagline: config?.tagline ?? "Markowitz Engine",
    brokerName: config?.broker_name ?? "",
  };
}
