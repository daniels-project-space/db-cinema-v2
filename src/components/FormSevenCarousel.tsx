"use client";

import { useEffect, useRef, useState } from "react";

/** Exported so the page can warm these before the overlay is ever opened. */
export const CAROUSEL_ITEMS = [
  { src: "/brand/carousel/begim-serum-commercial.mp4", poster: "/brand/carousel/begim-serum-commercial.jpg", caption: "Begim Serum", detail: "Beauty / ritual" },
  { src: "/brand/carousel/sunline-fashion.mp4", poster: "/brand/carousel/posters/sunline-fashion.jpg", caption: "Sunline", detail: "Campaign film" },
  { src: "/brand/carousel/heirloom-jewellery.mp4", poster: "/brand/carousel/posters/heirloom-jewellery.jpg", caption: "Heirloom", detail: "Palace world" },
  { src: "/brand/carousel/after-hours-audio.mp4", poster: "/brand/carousel/posters/after-hours-audio.jpg", caption: "After Hours", detail: "Audio brand film" },
  { src: "/brand/carousel/derma-neural-commercial.mp4", poster: "/brand/carousel/derma-neural-commercial.jpg", caption: "Derma Neural", detail: "Skincare commercial" },
  { src: "/brand/carousel/pop-the-ordinary.mp4", poster: "/brand/carousel/pop-the-ordinary.jpg", caption: "Pop The Ordinary", detail: "Launch film" },
] as const;

const ITEMS = CAROUSEL_ITEMS;

const ADVANCE_EVERY = 4200;

/**
 * How far from centre a film still plays.
 *
 * Every film used to be mounted, autoplaying and force-resumed on a 1.2s
 * interval — six simultaneous video decodes for three visible cards, which is
 * what made playback stutter. Only the front rank decodes now; the rest hold
 * their poster frame and resume when they come round.
 */
const PLAY_WITHIN = 1;

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
 * A live campaign reel. Every visible film is mounted and plays continuously so
 * the contact sheet feels alive even while another film sits at the front.
 */
export function FormSevenCarousel() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [readyIndexes, setReadyIndexes] = useState<Set<number>>(() => new Set());
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setActive((index) => wrap(index + 1)), ADVANCE_EVERY);
    return () => window.clearInterval(id);
  }, [paused]);

  /**
   * Play the front rank, hold the rest.
   *
   * Runs on every change of `active` rather than on a polling interval — the
   * old version resumed all six twice a second whether they were on screen or
   * not, which is both the stutter and a lot of wasted decode. A film that
   * isn't playing keeps its poster, so nothing goes blank.
   */
  useEffect(() => {
    const sync = () => {
      const hidden = document.visibilityState === "hidden";
      videoRefs.current.forEach((video, index) => {
        if (!video) return;
        const near = Math.abs(circularDistance(index, active, ITEMS.length)) <= PLAY_WITHIN;
        if (near && !hidden) {
          if (video.paused) void video.play().catch(() => undefined);
        } else if (!video.paused) {
          video.pause();
        }
      });
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [active]);

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

          return (
            <button
              key={item.src}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`Show ${item.caption}: ${item.detail}`}
              aria-current={isSelected ? "true" : undefined}
              className="fs-reel-card"
              /**
               * A cascade, not a row of near-equal cards. The centre film is
               * the point of this panel, so it sits well above its neighbours
               * in size, brightness and saturation and each rank steps down
               * clearly — the previous curve only shed 22% per step, which read
               * as three similar tiles rather than one hero with support.
               */
              style={{
                transform: `translate3d(calc(-50% + ${distance * 132}px), -50%, ${-absoluteDistance * 78}px) rotateY(${-distance * 17}deg) rotateZ(${-distance * 1.4}deg) scale(${isSelected ? 1.26 : Math.max(0.46, 0.78 - (absoluteDistance - 1) * 0.2)})`,
                opacity: isVisible ? (isSelected ? 1 : Math.max(0.14, 0.66 - (absoluteDistance - 1) * 0.34)) : 0,
                filter: `brightness(${isSelected ? 1.1 : Math.max(0.34, 0.68 - (absoluteDistance - 1) * 0.2)}) saturate(${isSelected ? 1.14 : 0.6})`,
                zIndex: 20 - Math.round(absoluteDistance),
                pointerEvents: isVisible ? "auto" : "none",
              }}
            >
              <img src={item.poster} alt="" loading={isSelected ? "eager" : "lazy"} decoding="async" className="h-full w-full object-cover" />
              <video
                ref={(video) => { videoRefs.current[index] = video; }}
                src={item.src}
                muted
                loop
                playsInline
                // the front rank is worth buffering; the back rank only needs
                // enough to start quickly when it comes round
                preload={absoluteDistance <= PLAY_WITHIN ? "auto" : "metadata"}
                onCanPlay={(event) => {
                  setReadyIndexes((ready) => ready.has(index) ? ready : new Set(ready).add(index));
                  // only start it if it's actually in the front rank — otherwise
                  // buffering a back card would kick off a decode we just paused
                  if (absoluteDistance <= PLAY_WITHIN && event.currentTarget.paused) {
                    void event.currentTarget.play().catch(() => undefined);
                  }
                }}
                aria-hidden="true"
                // a paused back card would otherwise sit on a frozen frame;
                // fall back to its poster until it plays again
                className={`fs-reel-motion h-full w-full object-cover ${
                  readyIndexes.has(index) && absoluteDistance <= PLAY_WITHIN ? "opacity-100" : "opacity-0"
                }`}
              />
              <span className="fs-reel-frame" aria-hidden="true" />
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
