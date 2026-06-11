"use client";

import { useEffect, useState } from "react";

/** Live ticking SMPTE-style timecode (HH:MM:SS:FF @ 24fps). */
export function Timecode({ className = "" }: { className?: string }) {
  const [tc, setTc] = useState("00:00:00:00");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTc("00:00:00:00");
      return;
    }
    const start = performance.now();
    let raf = 0;
    let last = "";
    const pad = (n: number) => String(n).padStart(2, "0");
    const tick = (now: number) => {
      const el = (now - start) / 1000;
      const f = Math.floor((el % 1) * 24);
      const s = Math.floor(el) % 60;
      const m = Math.floor(el / 60) % 60;
      const h = Math.floor(el / 3600) % 24;
      const next = `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
      if (next !== last) {
        last = next;
        setTc(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <span className={`font-mono tabular-nums ${className}`} suppressHydrationWarning>
      {tc}
    </span>
  );
}
