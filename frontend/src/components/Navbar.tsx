import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  CalendarClock,
  GitCompare,
  History,
  LogOut,
  Menu,
  Plus,
  Shield,
  Sparkles,
  X,
} from "lucide-react";

import * as adminApi from "../api/admin";
import { useT } from "../i18n";
import { useAuth } from "../store/auth";
import { useBrand, useConfig } from "../store/config";
import LangSwitcher from "./LangSwitcher";

export default function Navbar() {
  const { user, logout } = useAuth();
  const t = useT();
  const brand = useBrand();
  const cfgFeatures = useConfig((s) => s.config?.features);
  // Edition can hide whole pages (libertex gift build).
  const hideBacktest = cfgFeatures?.hide_backtest ?? false;
  const hideCompare = cfgFeatures?.hide_compare ?? false;
  const loc = useLocation();
  const nav = useNavigate();
  const [notif, setNotif] = useState({ pending_users: 0, pending_quota_requests: 0 });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (user?.role === "admin") {
      adminApi.notifications().then(setNotif).catch(() => undefined);
      const id = setInterval(() => {
        adminApi.notifications().then(setNotif).catch(() => undefined);
      }, 30000);
      return () => clearInterval(id);
    }
  }, [user?.role]);

  // Close the mobile drawer whenever the route changes — so tapping a link
  // closes the menu and the user sees the new page.
  useEffect(() => {
    setDrawerOpen(false);
  }, [loc.pathname]);

  const isActive = (p: string) => loc.pathname === p || loc.pathname.startsWith(p + "/");

  const desktopLinkClass = (p: string) =>
    `flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
      isActive(p)
        ? "text-cyan bg-cyan/10 border border-cyan/30"
        : "text-text-muted hover:text-text hover:bg-bg-elevated"
    }`;

  const mobileLinkClass = (p: string) =>
    `flex items-center gap-3 px-4 py-3 rounded-xl text-base transition-colors ${
      isActive(p)
        ? "text-cyan bg-cyan/10 border border-cyan/30"
        : "text-text-muted hover:text-text hover:bg-bg-elevated"
    }`;

  const totalNotif = notif.pending_users + notif.pending_quota_requests;

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-bg/80 border-b border-border">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
        {/* Logo. Compact on mobile, full label from sm: up. */}
        <Link to="/" className="flex items-center gap-2 sm:gap-3 group shrink-0 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-neon-gradient flex items-center justify-center shadow-glow group-hover:animate-pulse-glow shrink-0">
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-bg" />
          </div>
          <div className="hidden xs:block min-w-0">
            <div className="font-bold text-base sm:text-lg neon-text leading-tight truncate">
              {brand.appName}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-text-dim hidden sm:block">
              {brand.tagline}
            </div>
          </div>
        </Link>

        {/* Desktop nav (≥ lg). Below that we collapse to a drawer. */}
        <nav className="hidden lg:flex items-center gap-1">
          <Link to="/" className={desktopLinkClass("/")}>
            <BarChart3 className="w-4 h-4" /> {t.nav.dashboard}
          </Link>
          <Link to="/build" className={desktopLinkClass("/build")}>
            <Plus className="w-4 h-4" /> {t.nav.build}
          </Link>
          {!hideBacktest && (
            <Link to="/backtest" className={desktopLinkClass("/backtest")}>
              <CalendarClock className="w-4 h-4" /> {t.nav.backtest}
            </Link>
          )}
          <Link to="/history" className={desktopLinkClass("/history")}>
            <History className="w-4 h-4" /> {t.nav.history}
          </Link>
          {!hideCompare && (
            <Link to="/compare" className={desktopLinkClass("/compare")}>
              <GitCompare className="w-4 h-4" /> {t.nav.compare}
            </Link>
          )}
          {user?.role === "admin" && (
            <Link to="/admin" className={desktopLinkClass("/admin") + " relative"}>
              <Shield className="w-4 h-4" /> {t.nav.admin}
              {totalNotif > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 text-[10px] flex items-center justify-center rounded-full bg-magenta text-bg font-bold">
                  {totalNotif}
                </span>
              )}
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <LangSwitcher />
          {/* User info pill — visible only when we have horizontal room. */}
          {user && (
            <div className="text-right hidden xl:block">
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
                      : ""}{" "}
                    {t.nav.today}
                  </span>
                )}
              </div>
            </div>
          )}
          {/* Desktop logout */}
          <button
            onClick={() => {
              logout();
              nav("/login");
            }}
            className="hidden lg:inline-flex p-2 rounded-lg border border-border hover:border-red/40 hover:text-red transition-colors"
            title={t.nav.logout}
          >
            <LogOut className="w-4 h-4" />
          </button>
          {/* Mobile hamburger */}
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            className="lg:hidden relative p-2 rounded-lg border border-border hover:border-cyan/40 hover:text-cyan transition-colors"
            aria-label="Menu"
            aria-expanded={drawerOpen}
          >
            {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            {totalNotif > 0 && !drawerOpen && (
              <span className="absolute -top-1 -right-1 w-4 h-4 text-[9px] flex items-center justify-center rounded-full bg-magenta text-bg font-bold">
                {totalNotif}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Mobile slide-down drawer. Lives BELOW the sticky bar, slides open
          when the hamburger is tapped. Backdrop closes on tap-outside. */}
      {drawerOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 top-14 sm:top-16 bg-black/50 backdrop-blur-sm z-20"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="lg:hidden absolute left-0 right-0 top-full bg-bg-elevated/95 backdrop-blur-md border-b border-border shadow-2xl z-30 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
            {user && (
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text">{user.name}</div>
                  <div className="text-[11px] text-text-dim flex items-center gap-1.5 mt-0.5">
                    <Activity className="w-3 h-3" />
                    {user.role === "admin" ? (
                      <span className="text-cyan">{t.nav.unlimited}</span>
                    ) : (
                      <span>
                        {user.quota?.today_used ?? 0}
                        {user.quota?.today_limit !== null && user.quota?.today_limit !== undefined
                          ? ` / ${(user.quota.today_limit + (user.quota.bonus_today || 0))}`
                          : ""}{" "}
                        {t.nav.today}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            <nav className="p-3 space-y-1">
              <Link to="/" className={mobileLinkClass("/")}>
                <BarChart3 className="w-5 h-5" /> {t.nav.dashboard}
              </Link>
              <Link to="/build" className={mobileLinkClass("/build")}>
                <Plus className="w-5 h-5" /> {t.nav.build}
              </Link>
              {!hideBacktest && (
                <Link to="/backtest" className={mobileLinkClass("/backtest")}>
                  <CalendarClock className="w-5 h-5" /> {t.nav.backtest}
                </Link>
              )}
              <Link to="/history" className={mobileLinkClass("/history")}>
                <History className="w-5 h-5" /> {t.nav.history}
              </Link>
              {!hideCompare && (
                <Link to="/compare" className={mobileLinkClass("/compare")}>
                  <GitCompare className="w-5 h-5" /> {t.nav.compare}
                </Link>
              )}
              {user?.role === "admin" && (
                <Link to="/admin" className={mobileLinkClass("/admin") + " relative"}>
                  <Shield className="w-5 h-5" /> {t.nav.admin}
                  {totalNotif > 0 && (
                    <span className="ml-auto min-w-5 h-5 px-1.5 text-[10px] flex items-center justify-center rounded-full bg-magenta text-bg font-bold">
                      {totalNotif}
                    </span>
                  )}
                </Link>
              )}
              <button
                onClick={() => {
                  logout();
                  nav("/login");
                }}
                className="w-full mt-2 flex items-center gap-3 px-4 py-3 rounded-xl text-base text-text-muted hover:text-red hover:bg-red/10 border border-border hover:border-red/40 transition-colors"
              >
                <LogOut className="w-5 h-5" /> {t.nav.logout}
              </button>
            </nav>
          </div>
        </>
      )}
    </header>
  );
}
