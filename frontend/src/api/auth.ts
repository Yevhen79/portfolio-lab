import { api } from "./client";

export interface AuthResponse {
  access_token: string;
  user_id: number;
  email: string;
  name: string;
  role: string;
  status: string;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const r = await api.post("/auth/login", { email, password });
  return r.data;
}

export async function register(email: string, name: string, password: string): Promise<AuthResponse> {
  const r = await api.post("/auth/register", { email, name, password });
  return r.data;
}

export interface MeResponse {
  id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  quota: {
    today_used: number;
    today_limit: number | null;
    week_used: number;
    week_limit: number | null;
    bonus_today: number;
    can_generate: boolean;
    reason: string;
  };
}

export async function me(): Promise<MeResponse> {
  const r = await api.get("/me");
  return r.data;
}

export async function requestQuota(amount: number, reason?: string) {
  const r = await api.post("/me/quota-request", { requested_amount: amount, reason });
  return r.data;
}

export async function myQuotaRequests() {
  const r = await api.get("/me/quota-requests");
  return r.data;
}
