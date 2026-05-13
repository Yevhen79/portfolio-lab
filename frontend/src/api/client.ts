import axios, { AxiosError } from "axios";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "/api";

export const api = axios.create({
  baseURL: API_BASE,
  // Hot-cache optimize ≈ 5s, cold-cache 500-asset universe with yfinance
  // misses can blow past 60s. 5 minutes gives breathing room without making
  // a genuine backend hang silent forever.
  timeout: 300_000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("pl_token");
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      const path = window.location.pathname;
      if (path !== "/login" && path !== "/register") {
        localStorage.removeItem("pl_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  },
);

export type ApiError = AxiosError<{ detail?: string }>;

export function errorMessage(e: unknown, fallback = "Request failed"): string {
  const ax = e as ApiError;
  return ax?.response?.data?.detail || ax?.message || fallback;
}
