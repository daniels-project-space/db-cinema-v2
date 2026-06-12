"use client";

import { useRef, type ReactNode } from "react";

/** Magnetic hover — the child leans a few px toward the cursor and snaps
 * back on leave. Mouse only; transform only. */
export function Magnetic({
  children,
  strength = 0.22,
  className = "",
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: React.PointerEvent) {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${(dx * strength).toFixed(1)}px, ${(dy * strength).toFixed(1)}px)`;
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "translate(0, 0)";
  }

  return (
    <div
      ref={ref}
      className={`inline-block transition-transform duration-300 ease-out ${className}`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {children}
    </div>
  );
}
