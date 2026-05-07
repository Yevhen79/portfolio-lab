import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, ShieldOff, Trash2, UserPlus, XCircle } from "lucide-react";

import * as adminApi from "../api/admin";
import type { AdminUser, QuotaRequestRow } from "../api/admin";
import { errorMessage } from "../api/client";
import Section from "../components/Section";
import { useT, tpl } from "../i18n";
import { fmtDate } from "../utils/format";

export default function Admin() {
  const t = useT();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [requests, setRequests] = useState<QuotaRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<{ daily_limit: number | null; weekly_limit: number | null }>(
    { daily_limit: 5, weekly_limit: null },
  );
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [u, r] = await Promise.all([adminApi.listUsers(), adminApi.listQuotaRequests()]);
      setUsers(u.users);
      setRequests(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function approveUser(uid: number) {
    await adminApi.approveUser(uid);
    void load();
  }
  async function blockUser(uid: number) {
    if (!confirm(t.admin.confirm_block)) return;
    await adminApi.blockUser(uid);
    void load();
  }
  async function deleteUser(uid: number) {
    if (!confirm(t.admin.confirm_delete)) return;
    await adminApi.deleteUser(uid);
    void load();
  }
  async function decideRequest(rid: number, approve: boolean) {
    await adminApi.decideQuotaRequest(rid, approve);
    void load();
  }
  async function saveEdit(uid: number) {
    await adminApi.updateUser(uid, editValues as any);
    setEditing(null);
    void load();
  }
  async function refreshLibertex() {
    setRefreshing(true);
    try {
      const r = await adminApi.refreshLibertex();
      alert(tpl(t.admin.libertex_refreshed, { added: r.added, updated: r.updated, total: r.total }));
    } catch (e) {
      alert(t.admin.libertex_failed + errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const pendingUsers = users.filter((u) => u.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight neon-text inline-block">{t.admin.page_title}</h1>
          <p className="text-text-muted mt-1">{t.admin.page_subtitle}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={refreshLibertex} disabled={refreshing} className="btn-ghost inline-flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {t.admin.refresh_libertex}
          </button>
        </div>
      </div>

      {error && <div className="card p-4 text-red border-red/30">{error}</div>}

      {pendingUsers.length > 0 && (
        <Section title={tpl(t.admin.pending_users_title, { n: pendingUsers.length })} subtitle={t.admin.pending_users_subtitle}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingUsers.map((u) => (
              <div key={u.id} className="card p-4 border-magenta/30 bg-magenta/5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold">{u.name}</div>
                    <div className="text-xs text-text-muted">{u.email}</div>
                    <div className="text-[10px] text-text-dim mt-1">{tpl(t.admin.registered, { date: fmtDate(u.created_at) })}</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => approveUser(u.id)} className="p-2 rounded-lg hover:bg-positive/10 text-positive" title="Approve">
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteUser(u.id)} className="p-2 rounded-lg hover:bg-red/10 text-red" title="Reject">
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {pendingRequests.length > 0 && (
        <Section title={tpl(t.admin.pending_quota_title, { n: pendingRequests.length })} subtitle={t.admin.pending_quota_subtitle}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingRequests.map((r) => (
              <div key={r.id} className="card p-4 border-cyan/30 bg-cyan/5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold">{r.user_name}</div>
                    <div className="text-xs text-text-muted">{r.user_email}</div>
                    <div className="text-sm mt-2">
                      {t.admin.requesting_more} <span className="font-mono text-cyan font-bold">+{r.requested_amount}</span> {t.admin.additional_generations}
                    </div>
                    {r.reason && <div className="text-xs text-text-muted mt-1 italic">"{r.reason}"</div>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => decideRequest(r.id, true)} className="p-2 rounded-lg hover:bg-positive/10 text-positive" title="Approve">
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => decideRequest(r.id, false)} className="p-2 rounded-lg hover:bg-red/10 text-red" title="Deny">
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={tpl(t.admin.users_title, { n: users.length })} subtitle={t.admin.users_subtitle}>
        {loading ? (
          <div className="text-text-muted text-center py-8">{t.dashboard.loading}</div>
        ) : (
          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated">
                <tr className="text-text-muted text-[11px] uppercase tracking-wider">
                  <th className="text-left px-4 py-3">{t.admin.col_user}</th>
                  <th className="text-left px-4 py-3">{t.admin.col_role}</th>
                  <th className="text-left px-4 py-3">{t.admin.col_status}</th>
                  <th className="text-right px-4 py-3">{t.admin.col_daily}</th>
                  <th className="text-right px-4 py-3">{t.admin.col_weekly}</th>
                  <th className="text-right px-4 py-3">{t.admin.col_bonus}</th>
                  <th className="text-right px-4 py-3">{t.admin.col_today}</th>
                  <th className="text-right px-4 py-3">{t.admin.col_portfolios}</th>
                  <th className="text-right px-4 py-3">{t.admin.col_last_login}</th>
                  <th className="text-right px-4 py-3">{t.admin.col_actions}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-border hover:bg-bg-elevated/50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-text-muted">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${u.role === "admin" ? "bg-magenta/15 text-magenta border border-magenta/30" : "bg-bg-elevated text-text-muted"}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${
                        u.status === "approved" ? "bg-positive/15 text-positive border border-positive/30" :
                        u.status === "pending" ? "bg-amber/15 text-amber border border-amber/30" :
                        "bg-red/15 text-red border border-red/30"
                      }`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {editing === u.id ? (
                        <input
                          type="number"
                          className="input py-1 px-2 w-20 text-right"
                          value={editValues.daily_limit ?? ""}
                          onChange={(e) => setEditValues((v) => ({ ...v, daily_limit: e.target.value === "" ? null : Number(e.target.value) }))}
                        />
                      ) : (
                        u.daily_limit ?? <span className="text-cyan">∞</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {editing === u.id ? (
                        <input
                          type="number"
                          className="input py-1 px-2 w-20 text-right"
                          value={editValues.weekly_limit ?? ""}
                          onChange={(e) => setEditValues((v) => ({ ...v, weekly_limit: e.target.value === "" ? null : Number(e.target.value) }))}
                          placeholder="—"
                        />
                      ) : (
                        u.weekly_limit ?? "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {u.bonus_today > 0 ? <span className="text-cyan">+{u.bonus_today}</span> : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-cyan">{u.today_generations}</td>
                    <td className="px-4 py-3 text-right font-mono">{u.portfolio_count}</td>
                    <td className="px-4 py-3 text-right text-text-muted text-xs">{u.last_login_at ? fmtDate(u.last_login_at) : t.admin.never}</td>
                    <td className="px-4 py-3 text-right">
                      {u.role === "admin" ? (
                        <span className="text-text-dim text-xs">—</span>
                      ) : editing === u.id ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => saveEdit(u.id)} className="text-positive hover:bg-positive/10 p-1.5 rounded">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setEditing(null)} className="text-text-muted hover:bg-bg-elevated p-1.5 rounded">
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => {
                              setEditing(u.id);
                              setEditValues({ daily_limit: u.daily_limit, weekly_limit: u.weekly_limit });
                            }}
                            className="text-text-muted hover:text-cyan hover:bg-cyan/10 p-1.5 rounded"
                            title="Edit limits"
                          >
                            <UserPlus className="w-4 h-4" />
                          </button>
                          {u.status === "pending" && (
                            <button onClick={() => approveUser(u.id)} className="text-positive hover:bg-positive/10 p-1.5 rounded" title="Approve">
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                          {u.status !== "blocked" && (
                            <button onClick={() => blockUser(u.id)} className="text-amber hover:bg-amber/10 p-1.5 rounded" title="Block">
                              <ShieldOff className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => deleteUser(u.id)} className="text-red hover:bg-red/10 p-1.5 rounded" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t.admin.quota_history_title}>
        <div className="overflow-auto rounded-xl border border-border max-h-[400px]">
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated sticky top-0">
              <tr className="text-text-muted text-[11px] uppercase tracking-wider">
                <th className="text-left px-4 py-3">{t.admin.quota_col_user}</th>
                <th className="text-left px-4 py-3">{t.admin.quota_col_reason}</th>
                <th className="text-right px-4 py-3">{t.admin.quota_col_amount}</th>
                <th className="text-right px-4 py-3">{t.admin.quota_col_status}</th>
                <th className="text-right px-4 py-3">{t.admin.quota_col_requested}</th>
                <th className="text-right px-4 py-3">{t.admin.quota_col_decided}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-3">{r.user_name}</td>
                  <td className="px-4 py-3 text-text-muted text-xs italic">{r.reason || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-cyan">+{r.requested_amount}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`badge ${
                      r.status === "approved" ? "bg-positive/15 text-positive border border-positive/30" :
                      r.status === "denied" ? "bg-red/15 text-red border border-red/30" :
                      "bg-amber/15 text-amber border border-amber/30"
                    }`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-text-muted text-xs">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3 text-right text-text-muted text-xs">{r.decided_at ? fmtDate(r.decided_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
