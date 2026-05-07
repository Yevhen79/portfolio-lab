import { create } from "zustand";

import * as authApi from "../api/auth";

interface AuthState {
  token: string | null;
  user: authApi.MeResponse | null;
  loading: boolean;
  setToken: (token: string, profile?: authApi.AuthResponse) => void;
  refresh: () => Promise<void>;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: typeof window !== "undefined" ? localStorage.getItem("pl_token") : null,
  user: null,
  loading: false,
  setToken: (token, profile) => {
    localStorage.setItem("pl_token", token);
    set({ token });
    if (profile) {
      set({
        user: {
          id: profile.user_id,
          email: profile.email,
          name: profile.name,
          role: profile.role,
          status: profile.status,
          quota: {
            today_used: 0, today_limit: null, week_used: 0, week_limit: null,
            bonus_today: 0, can_generate: true, reason: "ok",
          },
        },
      });
    }
  },
  refresh: async () => {
    set({ loading: true });
    try {
      const u = await authApi.me();
      set({ user: u });
    } catch {
      set({ user: null });
    } finally {
      set({ loading: false });
    }
  },
  logout: () => {
    localStorage.removeItem("pl_token");
    set({ token: null, user: null });
  },
}));
