"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RigPointer } from "@/components/HeroRig3D";

const HeroRig3D = dynamic(() => import("@/components/HeroRig3D").then((m) => m.HeroRig3D), { ssr: false });

/** Hero centrepiece: a procedural cinema rig that assembles under the cursor.
 * Mounts after idle so it never competes with hydration; the pointer is
 * tracked at window level so the canvas stays pointer-events-none and every
 * hero link keeps working. Coarse pointers get an autonomous build loop,
 * prefers-reduced-motion gets the rig fully assembled and still. */
export function HeroRig() {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const lastPct = useRef(-1);
  const ptr = useRef<RigPointer>({ x: 0, y: 0, inside: false, fine: true, reduced: false });

  useEffect(() => {
    ptr.current.fine = window.matchMedia("(pointer: fine)").matches;
    const red = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ptr.current.reduced = red;
    setReduced(red);

    const host = hostRef.current!;
    let cx = -1;
    let cy = -1;
    const update = () => {
      if (cx < 0) return;
      const r = host.getBoundingClientRect();
      const inside = r.bottom > 0 && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      ptr.current.inside = inside;
      if (inside) {
        ptr.current.x = ((cx - r.left) / r.width) * 2 - 1;
        ptr.current.y = -(((cy - r.top) / r.height) * 2 - 1);
      }
    };
    const onMove = (e: PointerEvent) => {
      cx = e.clientX;
      cy = e.clientY;
      update();
    };
    const onLeave = () => {
      ptr.current.inside = false;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", update, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "160px" });
    io.observe(host);

    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const idle = w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 400));
    idle(() => setReady(true));

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", update);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      io.disconnect();
    };
  }, []);

  const onAssembly = useCallback((v: number) => {
    const pct = Math.min(100, Math.round(v * 100));
    if (pct === lastPct.current) return;
    lastPct.current = pct;
    if (pctRef.current) pctRef.current.textContent = `${String(pct).padStart(3, "0")}%`;
    if (barRef.current) {
      const n = Math.round((pct / 100) * 8);
      barRef.current.textContent = "▰".repeat(n) + "▱".repeat(8 - n);
    }
    if (statusRef.current) statusRef.current.textContent = pct < 12 ? "IDLE" : pct < 88 ? "TRACKING" : "LOCKED";
  }, []);

  return (
    <>
      <div
        ref={hostRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-[1] transition-opacity duration-1000 ${
          ready ? "opacity-40 lg:opacity-100" : "opacity-0"
        }`}
      >
        {ready && (
          <HeroRig3D ptr={ptr} onAssembly={onAssembly} frameloop={reduced ? "demand" : visible ? "always" : "never"} />
        )}
      </div>
      <div className="pointer-events-none absolute right-4 top-1/2 z-10 hidden -translate-y-1/2 lg:block xl:right-6" aria-hidden>
        <span className="hud-label inline-flex items-center gap-3" style={{ writingMode: "vertical-rl" }}>
          <span>LENS TRACKING</span>
          <span ref={barRef} className="text-accent-400/80">
            ▱▱▱▱▱▱▱▱
          </span>
          <span ref={pctRef} className="text-white/70">
            000%
          </span>
          <span ref={statusRef} className="text-accent-400">
            IDLE
          </span>
        </span>
      </div>
    </>
  );
}
