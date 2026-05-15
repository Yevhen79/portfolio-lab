import { AlertTriangle, Lightbulb } from "lucide-react";

import { useT, tpl } from "../i18n";
import { fmtPct } from "../utils/format";

/** Structured error returned by /api/optimize when a portfolio cannot be
 *  built. Keys mirror `backend/app/services/errors.PortfolioBuildError`. */
export interface BuildErrorDetail {
  code: string;
  context: Record<string, any>;
}

interface Props {
  /** The whole error payload from axios. We accept it raw and figure out
   *  whether it's the new structured shape, a string (legacy), or a
   *  network-level error (timeout etc.). */
  error: unknown;
  /** Optional retry button (e.g. for transient network errors). */
  onRetry?: () => void;
}

/** Parses the diverse error shapes our axios client can hand us and
 *  returns the structured detail when present. */
function asStructured(error: unknown): BuildErrorDetail | null {
  if (typeof error !== "object" || error === null) return null;
  // Axios error shape: error.response.data.detail
  const ax = error as { response?: { data?: { detail?: any } } };
  const detail = ax.response?.data?.detail;
  if (detail && typeof detail === "object" && typeof detail.code === "string") {
    return { code: detail.code, context: detail.context ?? {} };
  }
  return null;
}

/** Formats a number with up to 1 decimal as a percentage — used by
 *  context interpolation so backend `0.4123` renders as `41.2%`. */
const pct = (v: any): string =>
  typeof v === "number" && Number.isFinite(v) ? fmtPct(v) : "—";

export default function BuildErrorCard({ error, onRetry }: Props) {
  const t = useT();
  const structured = asStructured(error);
  const E = t.build_errors;

  // 1. Friendly message + 2-3 suggestions per known code.
  const code = structured?.code ?? "GENERIC";
  const ctx = structured?.context ?? {};
  const messages = E.codes as Record<string, { title: string; body: string; tips: string[] }>;
  const entry = messages[code] || messages.GENERIC;

  // Interpolate context numbers into the body where placeholders exist.
  const body = tpl(entry.body, {
    target: pct(ctx.target),
    max_available: pct(ctx.max_available),
    min_achievable: pct(ctx.min_achievable),
    n_assets: ctx.n_assets ?? 0,
    min_history_years: ctx.min_history_years ?? 0,
    portfolio_type: ctx.portfolio_type ?? "",
    raw: ctx.message ?? "",
  });

  return (
    <div className="card-glow p-5 sm:p-6 border-red/30">
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-red/15 border border-red/30 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-red" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg sm:text-xl font-semibold text-red">{entry.title}</h3>
          <p className="text-sm sm:text-base text-text mt-1.5">{body}</p>

          {entry.tips && entry.tips.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-text-dim font-semibold mb-2">
                <Lightbulb className="w-3.5 h-3.5 text-amber" />
                {E.tips_title}
              </div>
              <ul className="space-y-1.5 text-sm text-text-muted">
                {entry.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-amber mt-0.5">•</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Diagnostics block — only when we have non-empty context. Helps
              the user (and us) understand exactly what was off. */}
          {Object.keys(ctx).length > 0 && (
            <details className="mt-3 text-xs text-text-dim">
              <summary className="cursor-pointer hover:text-text-muted">
                {E.details_label} ({code})
              </summary>
              <pre className="mt-2 p-2 bg-bg-elevated/50 rounded text-[11px] overflow-x-auto">
                {JSON.stringify(ctx, null, 2)}
              </pre>
            </details>
          )}

          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-4 btn-ghost text-sm inline-flex items-center gap-2"
            >
              {E.retry}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
