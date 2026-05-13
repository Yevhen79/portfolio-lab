import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../store/auth";
import { useConfig } from "../store/config";
import Navbar from "./Navbar";

export default function Layout() {
  const { token, user, refresh } = useAuth();
  const loadConfig = useConfig((s) => s.load);
  const nav = useNavigate();

  useEffect(() => {
    // Bootstrap deployment config once; safe to call multiple times.
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!token) {
      nav("/login");
      return;
    }
    if (!user) {
      void refresh();
    }
  }, [token, user, nav, refresh]);

  if (!token) return null;

  return (
    <div className="min-h-screen bg-bg bg-grid">
      <Navbar />
      <main className="mx-auto max-w-[1600px] px-3 sm:px-6 py-4 sm:py-8 animate-slide-up">
        <Outlet />
      </main>
    </div>
  );
}
