import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, AlertCircle } from "lucide-react";

import * as authApi from "../api/auth";
import { errorMessage } from "../api/client";
import { useT } from "../i18n";
import LangSwitcher from "../components/LangSwitcher";
import { useAuth } from "../store/auth";

export default function Login() {
  const t = useT();
  const [email, setEmail] = useState("evgenij.shakotko@gmail.com");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setToken, refresh } = useAuth();
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await authApi.login(email, password);
      setToken(r.access_token, r);
      await refresh();
      nav("/");
    } catch (e) {
      setError(errorMessage(e, t.auth.login_failed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg bg-grid p-6">
      <div className="card-glow p-10 w-full max-w-md animate-slide-up">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-neon-gradient flex items-center justify-center shadow-glow">
              <Sparkles className="w-6 h-6 text-bg" />
            </div>
            <div>
              <div className="font-bold text-2xl neon-text leading-tight">{t.app.name}</div>
              <div className="text-xs uppercase tracking-widest text-text-dim">{t.app.tagline}</div>
            </div>
          </div>
          <LangSwitcher />
        </div>

        <h1 className="text-2xl font-semibold mb-1">{t.auth.login_title}</h1>
        <p className="text-text-muted text-sm mb-8">{t.auth.login_subtitle}</p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wide text-text-muted mb-1.5">{t.auth.email}</label>
            <input
              type="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-text-muted mb-1.5">{t.auth.password}</label>
            <input
              type="password"
              required
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red bg-red/10 border border-red/30 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? t.auth.signing_in : t.auth.sign_in}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-text-muted">
          {t.auth.no_account}{" "}
          <Link to="/register" className="text-cyan hover:underline">
            {t.auth.register_link}
          </Link>
        </div>
      </div>
    </div>
  );
}
