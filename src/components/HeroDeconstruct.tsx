"use client";

import { useEffect, useRef } from "react";

/**
 * Hero background: a fully-rigged ARRI Alexa that deconstructs as you scroll
 * through the pinned hero. The source clip is on a pure-black field, screen-
 * blended over the dark hero so only the lit camera shows (black + letterbox
 * vanish — no matte, no crop). Scroll position drives video.currentTime.
 *
 * Fallbacks: touch / coarse-pointer devices get an ambient autoplay loop
 * (iOS can't reliably seek currentTime on scroll); reduced-motion visitors
 * just hold the poster frame.
 *
 * Mirrors the project's scroll idiom (see ScrollProgress): "use client",
 * requestAnimationFrame, passive listeners, transform/seek only.
 */
export function HeroDeconstruct() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return; // hold the poster

    // Touch devices: ambient loop instead of scroll-scrub.
    if (window.matchMedia("(pointer: coarse)").matches) {
      video.loop = true;
      video.muted = true;
      const play = () => void video.play().catch(() => {});
      if (video.readyState >= 2) play();
      else video.addEventListener("loadeddata", play, { once: true });
      return;
    }

    const track = video.closest<HTMLElement>("[data-hero-track]");
    if (!track) return;

    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
    let duration = video.duration || 10;
    let raf = 0;

    const update = () => {
      raf = 0;
      const scrollable = track.offsetHeight - window.innerHeight;
      const progress =
        scrollable > 0 ? clamp(-track.getBoundingClientRect().top / scrollable, 0, 1) : 0;
      const t = progress * (duration - 0.05);
      // Only seek on a real frame change (~30fps) to avoid decoder thrash.
      if (Math.abs(video.currentTime - t) > 1 / 30) {
        try {
          video.currentTime = t;
        } catch {
          /* seek not ready yet */
        }
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    const onMeta = () => {
      duration = video.duration || 10;
      video.pause();
      update();
    };

    if (video.readyState >= 1) onMeta();
    else video.addEventListener("loadedmetadata", onMeta, { once: true });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
      aria-hidden
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain opacity-90"
        style={{ mixBlendMode: "screen" }}
        src="/arri-deconstruct.mp4"
        poster="/arri-deconstruct-poster.jpg"
        muted
        playsInline
        preload="auto"
        tabIndex={-1}
      />
    </div>
  );
}
