"use client";

import { useEffect, useRef } from "react";

/**
 * A standalone showcase section: a fully-rigged ARRI Alexa that deconstructs
 * into its parts as you scroll through a pinned track. The clip is on a pure-
 * black field, screen-blended over the dark section so only the lit camera
 * shows (black + letterbox vanish — no matte, no crop).
 *
 * Scroll position sets a TARGET time; the displayed time eases toward it every
 * frame (lerp). That gives weight — the camera keeps drifting for a beat after
 * you stop scrolling, then settles, instead of snapping frame-to-frame.
 *
 * Fallbacks: touch / coarse-pointer devices get an ambient autoplay loop
 * (iOS can't reliably seek currentTime on scroll); reduced-motion visitors
 * just hold the poster frame.
 *
 * Mirrors the project's scroll idiom (see ScrollProgress): "use client",
 * requestAnimationFrame, passive listeners, transform/seek only.
 */
export function CameraDeconstruct() {
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

    const track = video.closest<HTMLElement>("[data-deconstruct-track]");
    if (!track) return;

    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

    let duration = video.duration || 10;
    let targetTime = 0; // where the scroll says we should be
    let displayTime = 0; // where we actually are (eased toward target)
    let raf = 0;

    // Lower = more drag/inertia (the camera coasts longer after you stop).
    const EASE = 0.075;
    const EPS = 0.004; // seconds; below this, snap and stop the loop

    const readTarget = () => {
      const scrollable = track.offsetHeight - window.innerHeight;
      const progress =
        scrollable > 0 ? clamp(-track.getBoundingClientRect().top / scrollable, 0, 1) : 0;
      targetTime = progress * (duration - 0.05);
    };

    // Persistent loop: glide displayTime toward targetTime, seek, and keep
    // running until the two converge — that residual motion IS the inertia.
    const tick = () => {
      const delta = targetTime - displayTime;
      if (Math.abs(delta) < EPS) {
        displayTime = targetTime;
        raf = 0; // settled — sleep until the next scroll
      } else {
        displayTime += delta * EASE;
        raf = requestAnimationFrame(tick);
      }
      if (Math.abs(video.currentTime - displayTime) > 1 / 60) {
        try {
          video.currentTime = displayTime;
        } catch {
          /* seek not ready yet */
        }
      }
    };

    const wake = () => {
      readTarget();
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onMeta = () => {
      duration = video.duration || 10;
      video.pause();
      readTarget();
      displayTime = targetTime;
      try {
        video.currentTime = displayTime;
      } catch {
        /* not ready */
      }
    };

    if (video.readyState >= 1) onMeta();
    else video.addEventListener("loadedmetadata", onMeta, { once: true });

    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", wake);
    return () => {
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", wake);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      className="section-window relative"
      style={{ height: "220vh" }}
      data-deconstruct-track
    >
      <div className="sticky top-[93px] flex h-[calc(100vh-93px)] flex-col overflow-hidden">
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-500/[0.06] blur-[120px]"
          aria-hidden
        />
        <div className="hero-grid" aria-hidden />

        {/* the deconstructing camera, screen-blended onto the black */}
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

        {/* section chrome — framed around the camera, never over it */}
        <div className="relative z-10 px-6 pt-12 text-center">
          <div className="hud-label !text-accent-400/90">Engineered to perform</div>
        </div>
        <div className="relative z-10 mt-auto px-6 pb-14 text-center">
          <h2 className="font-display text-3xl font-bold text-white/90 sm:text-4xl">
            Built like the cameras{" "}
            <span className="serif-accent gradient-text text-[1.06em]">we rent</span>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/45">
            Every body, lens and rig stripped, checked and rebuilt between shoots.
          </p>
        </div>
      </div>
    </section>
  );
}
