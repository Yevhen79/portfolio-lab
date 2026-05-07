import { HelpCircle } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";

type Side = "right" | "left" | "bottom";

interface Props {
  children: ReactNode;
  title?: string;
  side?: Side;
  width?: number;
}

/**
 * Small `(?)` icon that reveals a styled popover with explanatory copy.
 * Opens on hover (desktop) and on click (touch/keyboard). Click outside or
 * Escape to dismiss when sticky-opened.
 */
export default function HelpTip({ children, title, side = "right", width = 320 }: Props) {
  const [open, setOpen] = useState(false);
  const [sticky, setSticky] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!sticky) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setSticky(false);
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSticky(false);
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [sticky]);

  const sideClasses: Record<Side, string> = {
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  };

  const arrowClasses: Record<Side, string> = {
    right: "left-[-5px] top-1/2 -translate-y-1/2 border-r-cyan/40",
    left: "right-[-5px] top-1/2 -translate-y-1/2 border-l-cyan/40",
    bottom: "top-[-5px] left-1/2 -translate-x-1/2 border-b-cyan/40",
  };

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center align-middle"
      onMouseEnter={() => !sticky && setOpen(true)}
      onMouseLeave={() => !sticky && setOpen(false)}
    >
      <button
        type="button"
        aria-label="More info"
        onClick={(e) => {
          e.stopPropagation();
          if (sticky) {
            setSticky(false);
            setOpen(false);
          } else {
            setSticky(true);
            setOpen(true);
          }
        }}
        className="ml-1.5 text-text-dim hover:text-cyan transition-colors leading-none"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          className={`absolute z-50 ${sideClasses[side]}
            bg-bg-elevated border border-cyan/40 rounded-xl shadow-glow
            px-4 py-3 text-xs leading-relaxed text-text
            normal-case tracking-normal font-normal text-left
            animate-slide-up`}
          style={{ width }}
          onMouseEnter={() => setOpen(true)}
        >
          {title && (
            <div className="text-cyan font-semibold uppercase tracking-wider text-[11px] mb-1.5">
              {title}
            </div>
          )}
          <div className="text-text-muted">{children}</div>
          <span
            className={`absolute w-0 h-0 border-y-[6px] border-y-transparent
              ${side === "right" ? "border-r-[6px]" : side === "left" ? "border-l-[6px]" : "border-b-[6px]"}
              ${arrowClasses[side]}`}
          />
        </div>
      )}
    </span>
  );
}
