"use client";

import { useEffect, useRef } from "react";

/**
 * A soft radial glow that trails the cursor across the whole site.
 * One fixed element, transform-only updates lerped on rAF — costs nothing.
 * Desktop pointers only; hidden for touch and reduced-motion.
 */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 3;
    let x = tx;
    let y = ty;
    let raf = 0;
    let active = false;

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!active) {
        active = true;
        el.style.opacity = "1";
        raf = requestAnimationFrame(tick);
      }
    };

    function tick() {
      x += (tx - x) * 0.09;
      y += (ty - y) * 0.09;
      el!.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (Math.abs(tx - x) < 0.3 && Math.abs(ty - y) < 0.3) {
        active = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    }

    el.style.opacity = "0";
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <div ref={ref} className="cursor-glow" style={{ opacity: 0 }} aria-hidden />;
}
