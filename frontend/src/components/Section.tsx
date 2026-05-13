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
    <section className={`card p-4 sm:p-6 ${className}`}>
      {/* On phones the `action` slot (search box, filters, snap-buttons) drops
          to its own row below the title — at < 420 px the two flex children
          collide otherwise. From `xs:` up they sit side-by-side. */}
      <div className="flex flex-col xs:flex-row xs:items-start xs:justify-between gap-2 xs:gap-3 mb-4 sm:mb-5">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight inline-flex items-center">
            {title}
            {help}
          </h2>
          {subtitle && <p className="text-xs sm:text-sm text-text-muted mt-1">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
