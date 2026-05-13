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

export const useConfig = create<ConfigState>((set, get) => ({
  config: null,
  loading: false,
  load: async () => {
    if (get().config || get().loading) return;
    set({ loading: true });
    try {
      const c = await fetchConfig();
      set({ config: c, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  feature: (key, fallback) => {
    const f = get().config?.features;
    return (f ? (f as any)[key] : fallback) as any;
  },
}));
