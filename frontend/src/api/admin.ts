import { api } from "./client";

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  daily_limit: number | null;
  weekly_limit: number | null;
  bonus_today: number;
  created_at: string;
  last_login_at: string | null;
  portfolio_count: number;
  today_generations: number;
}

export interface QuotaRequestRow {
  id: number;
  user_id: number;
  user_email: string;
  user_name: string;
  requested_amount: number;
  reason: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
}

export async function listUsers(): Promise<{ users: AdminUser[]; total: number }> {
  const r = await api.get("/admin/users");
  return r.data;
}

export async function updateUser(uid: number, patch: Partial<AdminUser>) {
  const r = await api.patch(`/admin/users/${uid}`, patch);
  return r.data;
}

export async function approveUser(uid: number) {
  await api.post(`/admin/users/${uid}/approve`);
}

export async function blockUser(uid: number) {
  await api.post(`/admin/users/${uid}/block`);
}

export async function deleteUser(uid: number) {
  await api.delete(`/admin/users/${uid}`);
}

export async function listQuotaRequests(): Promise<QuotaRequestRow[]> {
  const r = await api.get("/admin/quota-requests");
  return r.data;
}

export async function decideQuotaRequest(rid: number, approve: boolean) {
  const r = await api.post(`/admin/quota-requests/${rid}/decide`, { approve });
  return r.data;
}

export async function notifications(): Promise<{ pending_users: number; pending_quota_requests: number }> {
  const r = await api.get("/admin/notifications");
  return r.data;
}

export async function refreshLibertex() {
  const r = await api.post("/admin/refresh-libertex");
  return r.data;
}

export async function auditLog(limit = 100) {
  const r = await api.get(`/admin/audit-log?limit=${limit}`);
  return r.data;
}
