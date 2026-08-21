"use client";

import { useEffect, useState } from "react";

const ITEMS = [
  { src: "/brand/carousel/begim-serum-commercial.mp4", poster: "/brand/carousel/begim-serum-commercial.jpg", caption: "Begim Serum — Beauty & Ritual" },
  { src: "/brand/carousel/sunline-fashion.mp4", poster: undefined, caption: "Sunline Fashion — Campaign Film" },
  { src: "/brand/carousel/heirloom-jewellery.mp4", poster: undefined, caption: "Heirloom Jewellery — Palace World" },
  { src: "/brand/carousel/after-hours-audio.mp4", poster: undefined, caption: "After Hours — Audio Brand Film" },
  { src: "/brand/carousel/derma-neural-commercial.mp4", poster: "/brand/carousel/derma-neural-commercial.jpg", caption: "Derma Neural — Skincare Commercial" },
  { src: "/brand/carousel/pop-the-ordinary.mp4", poster: "/brand/carousel/pop-the-ordinary.jpg", caption: "Pop The Ordinary — Skincare Launch" },
] as const;

const ADVANCE_EVERY = 4000;
const SPACING = 96;

function circularDistance(index: number, active: number, total: number) {
  const raw = index - active;
  return ((raw + total / 2 + total) % total) - total / 2;
}

/**
 * Auto-advancing coverflow carousel of real FORM/SEVEN ad renders — the center
 * tile is largest, neighbours shrink and fade toward the edges, all playing
 * on loop simultaneously (small, pre-trimmed mobile clips). Caption under the
 * stage swaps with the active tile.
 */
export function FormSevenCarousel() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setActive((i) => (i + 1) % ITEMS.length), ADVANCE_EVERY);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="relative h-[210px] w-full select-none overflow-hidden">
        {ITEMS.map((item, i) => {
          const d = circularDistance(i, active, ITEMS.length);
          const abs = Math.abs(d);
          const scale = Math.max(0.55, 1.28 - abs * 0.3);
          const opacity = Math.max(0, 1 - abs * 0.42);
          const z = 10 - Math.round(abs);
          return (
            <button
              key={item.src}
              onClick={() => setActive(i)}
              aria-label={item.caption}
              className="fs-carousel-tile absolute left-1/2 top-1/2 aspect-[9/16] w-[108px] overflow-hidden rounded-2xl border border-white/15 bg-white/[0.04] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] backdrop-blur-md"
              style={{
                transform: `translate(calc(-50% + ${d * SPACING}px), -50%) scale(${scale})`,
                opacity,
                zIndex: z,
                pointerEvents: abs > 2.2 ? "none" : "auto",
              }}
            >
              <video
                src={item.src}
                poster={item.poster}
                autoPlay
                muted
                loop
                playsInline
                className="h-full w-full object-cover"
              />
            </button>
          );
        })}
      </div>
      <div key={active} className="fs-caption-in mt-3 text-center font-mono text-[11px] uppercase tracking-wider text-white/55">
        {ITEMS[active].caption}
      </div>
    </div>
  );
}
