"use client";

import { useEffect, useRef } from "react";

/**
 * Full-bleed showcase: a rigged ARRI Alexa that deconstructs as you scroll a
 * pinned track. The clip is on a pure-black field, screen-blended over a black
 * backdrop so the black vanishes and only the lit camera shows — no window, no
 * frame. The camera fills the screen.
 *
 * Motion: scroll sets a TARGET time; displayed time eases toward it with a
 * frame-rate-independent exponential glide (consistent on 60/120Hz), so the
 * camera carries weight and coasts to a stop. The same eased progress drives a
 * gentle zoom and a bottom film-scrubber + frame counter — one rAF,
 * transform/opacity only.
 *
 * Fallbacks: touch gets an ambient loop (iOS can't seek on scroll);
 * reduced-motion holds the poster.
 */
export function CameraDeconstruct() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
    const smooth = (e0: number, e1: number, x: number) => {
      const t = clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    };

    let duration = video.duration || 10;
    let totalFrames = Math.max(1, Math.round(duration * 24));
    let lastFrame = -1;

    const paint = (p: number) => {
      if (stageRef.current) {
        // big base zoom (fills the screen) → gentle pull-back as it deconstructs
        const scale = 1.18 - 0.1 * p;
        stageRef.current.style.transform = `scale(${scale.toFixed(4)})`;
      }
      if (barRef.current) barRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
      if (headRef.current) headRef.current.style.left = `${(p * 100).toFixed(2)}%`;
      if (frameRef.current) {
        const f = Math.round(p * totalFrames);
        if (f !== lastFrame) {
          lastFrame = f;
          frameRef.current.textContent = String(f).padStart(3, "0");
        }
      }
      if (captionRef.current) {
        const r = smooth(0.34, 0.72, p);
        captionRef.current.style.opacity = r.toFixed(3);
        captionRef.current.style.transform = `translateY(${((1 - r) * 14).toFixed(2)}px)`;
      }
    };

    const showCaption = () => {
      if (captionRef.current) {
        captionRef.current.style.opacity = "1";
        captionRef.current.style.transform = "none";
      }
    };
    const setTotal = () => {
      if (totalRef.current) totalRef.current.textContent = String(totalFrames).padStart(3, "0");
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      paint(0.16);
      showCaption();
      if (scrubRef.current) scrubRef.current.style.display = "none";
      return;
    }

    // Mobile/iOS: don't loop — use the same scroll-scrub as desktop. iOS won't
    // decode/seek an idle preload until a gesture activates it, so prime the
    // element (play→pause) on the first touch/scroll, then fall through to the
    // scrub path below (which seeks bidirectionally as you scroll up/down).
    if (window.matchMedia("(pointer: coarse)").matches) {
      video.muted = true;
      video.playsInline = true;
      const prime = () => {
        video.play().then(() => video.pause()).catch(() => {});
      };
      window.addEventListener("touchstart", prime, { once: true, passive: true });
      window.addEventListener("touchmove", prime, { once: true, passive: true });
      window.addEventListener("scroll", prime, { once: true, passive: true });
    }

    const track = video.closest<HTMLElement>("[data-deconstruct-track]");
    if (!track) return;

    let targetTime = 0;
    let displayTime = 0;
    let raf = 0;
    let prev = 0;
    const EPS = 0.003;
    const RESPONSE = 0.08;

    const readTarget = () => {
      const scrollable = track.offsetHeight - window.innerHeight;
      const prog =
        scrollable > 0 ? clamp(-track.getBoundingClientRect().top / scrollable, 0, 1) : 0;
      targetTime = prog * (duration - 0.05);
    };

    // Reliable scrub: never issue a seek while one is in flight (prevents the
    // "stuck" pile-up), and never seek past what's actually buffered (prevents
    // the "renders halfway" stall) — re-attempt from `seeked`/`progress` as more
    // of the file loads.
    const seekTo = () => {
      if (video.seeking) return;
      const b = video.buffered;
      const loadedEnd = b.length ? b.end(0) : 0; // contiguous buffer from 0
      const safe = Math.min(displayTime, Math.max(0, loadedEnd - 0.05));
      if (Math.abs(video.currentTime - safe) > 1 / 30) {
        try {
          video.currentTime = safe;
        } catch {
          /* not ready */
        }
      }
    };

    const tick = (now: number) => {
      const dt = prev ? Math.min(now - prev, 50) : 1000 / 60;
      prev = now;
      const k = 1 - Math.pow(1 - RESPONSE, dt / (1000 / 60));
      const delta = targetTime - displayTime;
      if (Math.abs(delta) < EPS) {
        displayTime = targetTime;
        raf = 0;
        prev = 0;
      } else {
        displayTime += delta * k;
        raf = requestAnimationFrame(tick);
      }
      seekTo();
      paint(clamp(displayTime / (duration - 0.05), 0, 1));
    };

    const wake = () => {
      readTarget();
      if (!raf) {
        prev = 0;
        raf = requestAnimationFrame(tick);
      }
    };

    const onMeta = () => {
      duration = video.duration || 10;
      totalFrames = Math.max(1, Math.round(duration * 24));
      setTotal();
      video.pause();
      readTarget();
      displayTime = targetTime;
      try {
        video.currentTime = displayTime;
      } catch {
        /* not ready */
      }
      paint(clamp(displayTime / (duration - 0.05), 0, 1));
    };

    setTotal();
    if (video.readyState >= 1) onMeta();
    else video.addEventListener("loadedmetadata", onMeta, { once: true });

    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", wake);
    video.addEventListener("seeked", seekTo);
    video.addEventListener("progress", seekTo);
    return () => {
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", wake);
      video.removeEventListener("seeked", seekTo);
      video.removeEventListener("progress", seekTo);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="section-window relative max-w-full overflow-x-clip" style={{ height: "220vh" }} data-deconstruct-track>
      <div className="sticky top-[93px] h-[calc(100vh-93px)] overflow-hidden bg-[#050507]">
        {/* the camera — full-bleed, black screen-blended away */}
        <div ref={stageRef} className="absolute inset-0 z-0 will-change-transform">
          <video
            ref={videoRef}
            className="h-full w-full object-cover object-center"
            style={{ mixBlendMode: "screen" }}
            src="/arri-deconstruct.mp4"
            poster="/arri-deconstruct-poster.jpg"
            muted
            playsInline
            preload="auto"
            tabIndex={-1}
            aria-hidden
          />
        </div>

        {/* legibility scrims for the edge captions */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-[#050507] to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-2/5 bg-gradient-to-t from-[#050507] via-[#050507]/55 to-transparent"
          aria-hidden
        />

        {/* top label */}
        <div className="absolute inset-x-0 top-7 z-20 px-6 text-center">
          <div className="hud-label !text-accent-400/90">Engineered to perform</div>
        </div>

        {/* bottom caption + film scrubber */}
        <div className="absolute inset-x-0 bottom-8 z-20 px-6 text-center">
          <div ref={captionRef} style={{ opacity: 0 }}>
            <h2 className="font-display text-2xl font-bold text-white/90 sm:text-3xl">
              Built like the cameras{" "}
              <span className="serif-accent gradient-text text-[1.06em]">we rent</span>
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/45">
              Every body, lens and rig — stripped, checked and rebuilt between shoots.
            </p>
          </div>

          <div ref={scrubRef} className="mx-auto mt-4 flex max-w-md items-center gap-3" aria-hidden>
            <span
              ref={frameRef}
              className="w-9 text-left font-mono text-[11px] tracking-widest text-white/40"
            >
              000
            </span>
            <div className="relative h-px flex-1 bg-white/10">
              <div
                ref={barRef}
                className="absolute inset-y-0 left-0 w-full origin-left bg-accent-400/70"
                style={{ transform: "scaleX(0)" }}
              />
              <div
                ref={headRef}
                className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-400 shadow-[0_0_10px_2px_rgba(56,189,248,0.5)]"
                style={{ left: "0%" }}
              />
            </div>
            <span
              ref={totalRef}
              className="w-9 text-right font-mono text-[11px] tracking-widest text-white/40"
            >
              240
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
