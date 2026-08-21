"use client";

import { useEffect, useState } from "react";

const ITEMS = [
  { src: "/brand/carousel/begim-serum-commercial.mp4", poster: "/brand/carousel/begim-serum-commercial.jpg", caption: "Begim Serum", detail: "Beauty / ritual" },
  { src: "/brand/carousel/sunline-fashion.mp4", poster: undefined, caption: "Sunline", detail: "Campaign film" },
  { src: "/brand/carousel/heirloom-jewellery.mp4", poster: undefined, caption: "Heirloom", detail: "Palace world" },
  { src: "/brand/carousel/after-hours-audio.mp4", poster: undefined, caption: "After Hours", detail: "Audio brand film" },
  { src: "/brand/carousel/derma-neural-commercial.mp4", poster: "/brand/carousel/derma-neural-commercial.jpg", caption: "Derma Neural", detail: "Skincare commercial" },
  { src: "/brand/carousel/pop-the-ordinary.mp4", poster: "/brand/carousel/pop-the-ordinary.jpg", caption: "Pop The Ordinary", detail: "Launch film" },
] as const;

const ADVANCE_EVERY = 4800;

function circularDistance(index: number, active: number, total: number) {
  const raw = index - active;
  return ((raw + total / 2 + total) % total) - total / 2;
}

function wrap(index: number) {
  return (index + ITEMS.length) % ITEMS.length;
}

function DirectionArrow({ direction }: { direction: "previous" | "next" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={direction === "previous" ? "h-4 w-4 rotate-180" : "h-4 w-4"}>
      <path d="M3.5 10h12M11 5.5 15.5 10 11 14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The overlay's central piece: an interaction-first, cinematic coverflow of
 * FORM / SEVEN films. Only the central frame and immediate neighbours play;
 * this keeps the overlay responsive while the surrounding clips remain as
 * tactile, selectable contact-sheet frames.
 */
export function FormSevenCarousel() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setActive((index) => wrap(index + 1)), ADVANCE_EVERY);
    return () => window.clearInterval(id);
  }, [paused]);

  const selected = ITEMS[active];

  return (
    <section
      className="fs-work-reel"
      aria-label="Selected FORM / SEVEN campaign films"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <div className="fs-reel-topline">
        <span>Selected signals</span>
        <span aria-live="polite">{String(active + 1).padStart(2, "0")} / {String(ITEMS.length).padStart(2, "0")}</span>
      </div>

      <div className="fs-reel-stage">
        <div className="fs-reel-horizon" aria-hidden="true" />
        {ITEMS.map((item, index) => {
          const distance = circularDistance(index, active, ITEMS.length);
          const absoluteDistance = Math.abs(distance);
          const isSelected = index === active;
          const isVisible = absoluteDistance <= 2;
          const playing = absoluteDistance <= 1;

          return (
            <button
              key={item.src}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`Show ${item.caption}: ${item.detail}`}
              aria-current={isSelected ? "true" : undefined}
              className="fs-reel-card"
              style={{
                transform: `translate3d(calc(-50% + ${distance * 142}px), -50%, ${-absoluteDistance * 64}px) rotateY(${-distance * 17}deg) rotateZ(${-distance * 1.6}deg) scale(${Math.max(0.54, 1.08 - absoluteDistance * 0.24)})`,
                opacity: isVisible ? Math.max(0.18, 1 - absoluteDistance * 0.36) : 0,
                filter: `brightness(${isSelected ? 1.06 : Math.max(0.45, 0.9 - absoluteDistance * 0.17)}) saturate(${isSelected ? 1.08 : 0.76})`,
                zIndex: 20 - Math.round(absoluteDistance),
                pointerEvents: isVisible ? "auto" : "none",
              }}
            >
              <span className="fs-reel-frame" aria-hidden="true" />
              <video
                src={item.src}
                poster={item.poster}
                autoPlay={playing}
                muted
                loop
                playsInline
                preload={playing ? "auto" : "metadata"}
                className="h-full w-full object-cover"
              />
              <span className="fs-reel-card-meta" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            </button>
          );
        })}
      </div>

      <div className="fs-reel-caption">
        <div key={selected.caption} className="fs-caption-in">
          <span>{selected.caption}</span>
          <small>{selected.detail}</small>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setActive((index) => wrap(index - 1))} className="fs-reel-control" aria-label="Previous campaign">
            <DirectionArrow direction="previous" />
          </button>
          <button type="button" onClick={() => setActive((index) => wrap(index + 1))} className="fs-reel-control" aria-label="Next campaign">
            <DirectionArrow direction="next" />
          </button>
        </div>
      </div>
    </section>
  );
}
