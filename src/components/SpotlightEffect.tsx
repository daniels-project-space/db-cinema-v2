"use client";

import { useEffect } from "react";

/**
 * Single delegated pointermove listener that feeds every `.spot` surface
 * its cursor position via CSS vars (--mx/--my). One listener for the whole
 * site instead of a handler per card.
 */
export function SpotlightEffect() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const onMove = (e: PointerEvent) => {
      const t = (e.target as Element | null)?.closest?.(".spot, .chat-panel") as HTMLElement | null;
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty("--mx", `${e.clientX - r.left}px`);
      t.style.setProperty("--my", `${e.clientY - r.top}px`);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  return null;
}
