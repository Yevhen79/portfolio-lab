import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Activity, BarChart3, GitCompare, History, LogOut, Plus, Shield, Sparkles } from "lucide-react";

import * as adminApi from "../api/admin";
import { useT } from "../i18n";
import { useAuth } from "../store/auth";
import LangSwitcher from "./LangSwitcher";

export default function Navbar() {
  const { user, logout } = useAuth();
  const t = useT();
  const loc = useLocation();
  const nav = useNavigate();
  const [notif, setNotif] = useState({ pending_users: 0, pending_quota_requests: 0 });

  useEffect(() => {
    if (user?.role === "admin") {
      adminApi.notifications().then(setNotif).catch(() => undefined);
      const id = setInterval(() => {
        adminApi.notifications().then(setNotif).catch(() => undefined);
      }, 30000);
      return () => clearInterval(id);
    }
  }, [user?.role]);

  const isActive = (p: string) => loc.pathname === p || loc.pathname.startsWith(p + "/");
  const navLinkClass = (p: string) =>
    `flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
      isActive(p)
        ? "text-cyan bg-cyan/10 border border-cyan/30"
        : "text-text-muted hover:text-text hover:bg-bg-elevated"
    }`;

  const totalNotif = notif.pending_users + notif.pending_quota_requests;

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-bg/80 border-b border-border">
      <div className="mx-auto max-w-[1600px] px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-neon-gradient flex items-center justify-center shadow-glow group-hover:animate-pulse-glow">
            <Sparkles className="w-5 h-5 text-bg" />
          </div>
          <div>
            <div className="font-bold text-lg neon-text leading-tight">{t.app.name}</div>
            <div className="text-[10px] uppercase tracking-widest text-text-dim">{t.app.tagline}</div>
          </div>
        </Link>

        <nav className="flex items-center gap-1">
          <Link to="/" className={navLinkClass("/")}>
            <BarChart3 className="w-4 h-4" /> {t.nav.dashboard}
          </Link>
          <Link to="/build" className={navLinkClass("/build")}>
            <Plus className="w-4 h-4" /> {t.nav.build}
          </Link>
          <Link to="/history" className={navLinkClass("/history")}>
            <History className="w-4 h-4" /> {t.nav.history}
          </Link>
          <Link to="/compare" className={navLinkClass("/compare")}>
            <GitCompare className="w-4 h-4" /> {t.nav.compare}
          </Link>
          {user?.role === "admin" && (
            <Link to="/admin" className={navLinkClass("/admin") + " relative"}>
              <Shield className="w-4 h-4" /> {t.nav.admin}
              {totalNotif > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 text-[10px] flex items-center justify-center rounded-full bg-magenta text-bg font-bold">
                  {totalNotif}
                </span>
              )}
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          <LangSwitcher />
          {user && (
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium text-text">{user.name}</div>
              <div className="text-[11px] text-text-dim flex items-center gap-1.5">
                <Activity className="w-3 h-3" />
                {user.role === "admin" ? (
                  <span className="text-cyan">{t.nav.unlimited}</span>
                ) : (
                  <span>
                    {user.quota?.today_used ?? 0}
                    {user.quota?.today_limit !== null && user.quota?.today_limit !== undefined
                      ? ` / ${(user.quota.today_limit + (user.quota.bonus_today || 0))}`
                      : ""} {t.nav.today}
                  </span>
                )}
              </div>
            </div>
          )}
          <button
            onClick={() => {
              logout();
              nav("/login");
            }}
            className="p-2 rounded-lg border border-border hover:border-red/40 hover:text-red transition-colors"
            title={t.nav.logout}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
