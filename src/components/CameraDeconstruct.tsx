"use client";

import { useEffect, useRef } from "react";

/**
 * Standalone showcase: a fully-rigged ARRI Alexa that deconstructs into its
 * parts as you scroll a pinned track. The clip is on a pure-black field,
 * screen-blended so only the lit camera shows.
 *
 * The panel is a 3-band flex column — label / camera / caption — so copy
 * always sits ABOVE and BELOW the camera, never on top of it.
 *
 * Motion: scroll sets a TARGET time; displayed time eases toward it with a
 * frame-rate-independent exponential glide (consistent on 60/120Hz), so the
 * camera carries weight and coasts to a stop. The same eased progress drives
 * a dolly push-in, breathing viewfinder brackets, a film scrubber + live
 * frame counter, and the payoff-line reveal — one rAF, transform/opacity only
 * (no per-frame filters; see the perf notes in globals).
 *
 * Fallbacks: touch gets an ambient loop (iOS can't seek on scroll);
 * reduced-motion holds the poster. Both show a tidy static composition.
 */
export function CameraDeconstruct() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
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
    // smoothstep — soft ease for envelopes
    const smooth = (e0: number, e1: number, x: number) => {
      const t = clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    };

    let duration = video.duration || 10;
    let totalFrames = Math.max(1, Math.round(duration * 24));
    let lastFrame = -1;

    // Write every scroll-driven visual from a single normalised progress p∈[0,1].
    const paint = (p: number) => {
      if (stageRef.current) {
        // dolly push-in → settle; stays >=1 so object-cover never reveals a gap
        const scale = 1.06 - 0.06 * p;
        stageRef.current.style.transform = `scale(${scale.toFixed(4)})`;
      }
      if (focusRef.current) {
        const fs = 1.04 - 0.06 * p; // brackets tighten as it deconstructs
        focusRef.current.style.transform = `scale(${fs.toFixed(4)})`;
        focusRef.current.style.opacity = (
          0.45 + 0.4 * smooth(0, 0.22, p) - 0.45 * smooth(0.88, 1, p)
        ).toFixed(3);
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
        const r = smooth(0.34, 0.72, p); // payoff line rises in over the back half
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

    // reduced motion: hold poster, static composition, no scrubber.
    if (reduceMotion) {
      paint(0.16);
      showCaption();
      if (scrubRef.current) scrubRef.current.style.display = "none";
      return;
    }

    // touch: ambient loop, static framing, no (meaningless) scrubber.
    if (window.matchMedia("(pointer: coarse)").matches) {
      video.loop = true;
      video.muted = true;
      const play = () => void video.play().catch(() => {});
      if (video.readyState >= 2) play();
      else video.addEventListener("loadeddata", play, { once: true });
      paint(0.28);
      showCaption();
      if (scrubRef.current) scrubRef.current.style.display = "none";
      return;
    }

    const track = video.closest<HTMLElement>("[data-deconstruct-track]");
    if (!track) return;

    let targetTime = 0;
    let displayTime = 0;
    let raf = 0;
    let prev = 0;
    const EPS = 0.003;
    const RESPONSE = 0.08; // per-60fps glide; lower = more drag/coast

    const readTarget = () => {
      const scrollable = track.offsetHeight - window.innerHeight;
      const prog =
        scrollable > 0 ? clamp(-track.getBoundingClientRect().top / scrollable, 0, 1) : 0;
      targetTime = prog * (duration - 0.05);
    };

    const tick = (now: number) => {
      const dt = prev ? Math.min(now - prev, 50) : 1000 / 60;
      prev = now;
      // frame-rate-independent exponential approach toward the target
      const k = 1 - Math.pow(1 - RESPONSE, dt / (1000 / 60));
      const delta = targetTime - displayTime;
      if (Math.abs(delta) < EPS) {
        displayTime = targetTime;
        raf = 0;
        prev = 0; // settled — sleep until next scroll
      } else {
        displayTime += delta * k;
        raf = requestAnimationFrame(tick);
      }
      if (Math.abs(video.currentTime - displayTime) > 1 / 120) {
        try {
          video.currentTime = displayTime;
        } catch {
          /* seek not ready yet */
        }
      }
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
    return () => {
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", wake);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="section-window relative" style={{ height: "220vh" }} data-deconstruct-track>
      <div className="sticky top-[93px] flex h-[calc(100vh-93px)] flex-col overflow-hidden">
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-500/[0.06] blur-[120px]"
          aria-hidden
        />
        <div className="hero-grid" aria-hidden />

        {/* ── band 1: label (above the camera) ── */}
        <div className="relative z-20 shrink-0 px-6 pt-6 text-center sm:pt-8">
          <div className="hud-label !text-accent-400/90">Engineered to perform</div>
        </div>

        {/* ── band 2: the camera ── */}
        <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center">
          <div ref={stageRef} className="relative h-full w-full will-change-transform">
            <video
              ref={videoRef}
              className="h-full w-full object-contain object-center sm:object-cover"
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

          {/* cinematic vignette */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at center, transparent 60%, rgba(5,5,8,0.45) 100%)",
            }}
            aria-hidden
          />

          {/* breathing viewfinder focus brackets */}
          <div
            ref={focusRef}
            className="pointer-events-none absolute inset-x-[12%] inset-y-[15%] will-change-transform"
            style={{ opacity: 0 }}
            aria-hidden
          >
            <span className="absolute left-0 top-0 h-6 w-6 border-l border-t border-accent-400/50" />
            <span className="absolute right-0 top-0 h-6 w-6 border-r border-t border-accent-400/50" />
            <span className="absolute bottom-0 left-0 h-6 w-6 border-b border-l border-accent-400/50" />
            <span className="absolute bottom-0 right-0 h-6 w-6 border-b border-r border-accent-400/50" />
          </div>
        </div>

        {/* ── band 3: caption + film scrubber (below the camera) ── */}
        <div className="relative z-20 shrink-0 px-6 pb-8 text-center">
          <div ref={captionRef} style={{ opacity: 0 }}>
            <h2 className="font-display text-3xl font-bold text-white/90 sm:text-4xl">
              Built like the cameras{" "}
              <span className="serif-accent gradient-text text-[1.06em]">we rent</span>
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/45">
              Every body, lens and rig — stripped, checked and rebuilt between shoots.
            </p>
          </div>

          <div ref={scrubRef} className="mx-auto mt-6 flex max-w-md items-center gap-3" aria-hidden>
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
