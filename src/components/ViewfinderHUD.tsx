"use client";

import { Timecode } from "@/components/Timecode";

/** Camera-viewfinder overlay for the hero: corner brackets, REC dot,
 * ticking timecode and exposure readouts. Pure decoration, pointer-through. */
export function ViewfinderHUD() {
  return (
    <div className="pointer-events-none absolute inset-4 z-10 hidden sm:block md:inset-8" aria-hidden>
      <div className="vf-corner tl" />
      <div className="vf-corner tr" />
      <div className="vf-corner bl" />
      <div className="vf-corner br" />

      <div className="absolute left-5 top-4 flex items-center gap-2">
        <span className="rec-dot" />
        <span className="hud-label !text-white/60">REC</span>
        <span className="hud-label">4.6K · 16:9</span>
      </div>

      <div className="absolute right-5 top-4">
        <Timecode className="text-[11px] tracking-[0.18em] text-white/55" />
      </div>

      <div className="absolute bottom-4 left-5">
        <span className="hud-label">
          DB·CR <span className="tick">/</span> LONDON 51.5072°N
        </span>
      </div>

      <div className="absolute bottom-4 right-5">
        <span className="hud-label">ISO 800 · ƒ/2.8 · 24 FPS</span>
      </div>
    </div>
  );
}
