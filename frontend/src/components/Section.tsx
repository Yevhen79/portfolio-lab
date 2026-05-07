import { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  help?: ReactNode;
}

export default function Section({ title, subtitle, children, action, className = "", help }: Props) {
  return (
    <section className={`card p-6 ${className}`}>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight inline-flex items-center">
            {title}
            {help}
          </h2>
          {subtitle && <p className="text-sm text-text-muted mt-1">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
