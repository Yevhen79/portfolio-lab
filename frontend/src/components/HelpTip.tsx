import { HelpCircle } from "lucide-react";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  children: ReactNode;
  title?: string;
  /** Preferred side. Kept for backward-compat; the component now auto-flips
   *  to whichever side has enough viewport room. */
  side?: "right" | "left" | "bottom" | "top";
  width?: number;
}

/**
 * `(?)` icon that reveals a styled popover with explanatory copy.
 *
 * Two engineering details worth highlighting:
 *
 * 1. **Portal**: the popover is rendered into `document.body` rather than
 *    inline. The form / result cards use `backdrop-blur-md` which creates
 *    a new CSS stacking context — `z-50` on an in-card child gets confined
 *    to that context and the popover gets visually clipped by the next
 *    sibling card. A portal escapes that entirely.
 *
 * 2. **Auto-positioning**: we measure the trigger button's `getBoundingClientRect`
 *    and pick the side with the most room left in the viewport. Prevents the
 *    tooltip from hanging off the right edge on narrow screens or near the
 *    column boundary in two-column layouts.
 *
 * Opens on hover (desktop) and on click (touch/keyboard). Click outside or
 * Escape dismisses when sticky-opened.
 */
export default function HelpTip({ children, title, side = "right", width = 320 }: Props) {
  const [open, setOpen] = useState(false);
  const [sticky, setSticky] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    placement: "right" | "left" | "bottom" | "top";
  } | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Recompute coords whenever the popover opens, the window resizes, or
  // the user scrolls (popover follows the trigger). `useLayoutEffect`
  // ensures we measure before the browser paints.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const compute = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const popH = popoverRef.current?.offsetHeight ?? 200;
      const margin = 8;

      // Try preferred side first, then fall back through sensible
      // alternatives by available space.
      const fits = {
        right: vw - rect.right > width + margin,
        left: rect.left > width + margin,
        bottom: vh - rect.bottom > popH + margin,
        top: rect.top > popH + margin,
      };
      const order: Array<"right" | "left" | "bottom" | "top"> = [
        side,
        side === "right" ? "left" : "right",
        "bottom",
        "top",
      ];
      const placement = order.find((p) => fits[p]) ?? "bottom";

      let top = 0;
      let left = 0;
      if (placement === "right") {
        top = rect.top + rect.height / 2 - (popH / 2);
        left = rect.right + margin;
      } else if (placement === "left") {
        top = rect.top + rect.height / 2 - (popH / 2);
        left = rect.left - width - margin;
      } else if (placement === "bottom") {
        top = rect.bottom + margin;
        left = rect.left + rect.width / 2 - width / 2;
      } else {
        top = rect.top - popH - margin;
        left = rect.left + rect.width / 2 - width / 2;
      }

      // Final clamp so the popover never escapes the viewport.
      left = Math.max(margin, Math.min(left, vw - width - margin));
      top = Math.max(margin, Math.min(top, vh - popH - margin));
      setCoords({ top, left, placement });
    };

    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, side, width]);

  useEffect(() => {
    if (!sticky) return;
    function onDocClick(e: MouseEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) {
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

  return (
    <>
      <span
        ref={triggerRef}
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
      </span>
      {open && coords && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[100]
            bg-bg-elevated/95 backdrop-blur-md border border-cyan/40 rounded-xl shadow-glow
            px-4 py-3 text-xs leading-relaxed text-text
            normal-case tracking-normal font-normal text-left
            animate-slide-up"
          style={{ top: coords.top, left: coords.left, width }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => !sticky && setOpen(false)}
        >
          {title && (
            <div className="text-cyan font-semibold uppercase tracking-wider text-[11px] mb-1.5">
              {title}
            </div>
          )}
          <div className="text-text-muted">{children}</div>
        </div>,
        document.body,
      )}
    </>
  );
}
