import { ReactNode } from "react";

interface Props {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "positive" | "negative" | "cyan" | "magenta";
  tooltip?: string;
}

export default function MetricCard({ label, value, hint, icon, tone = "default", tooltip }: Props) {
  const toneClass: Record<string, string> = {
    default: "text-text",
    positive: "text-positive",
    negative: "text-negative",
    cyan: "text-cyan",
    magenta: "text-magenta",
  };

  return (
    <div className="card-glow p-5 group" title={tooltip}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-widest text-text-dim font-medium">{label}</div>
        {icon && <div className="text-text-muted group-hover:text-cyan transition-colors">{icon}</div>}
      </div>
      <div className={`metric-value ${toneClass[tone]}`}>{value}</div>
      {hint && <div className="text-xs text-text-muted mt-1.5">{hint}</div>}
    </div>
  );
}
