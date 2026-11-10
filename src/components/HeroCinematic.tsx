"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GafferCall } from "@/components/GafferCall";
import { IconArrowRight, IconStar } from "@/components/icons";

type Rating = { ratingValue: number; reviewCount: number; reviewCountLabel: string } | null;
type Cat = { name: string; count: number };

/**
 * Minimal gear callouts, mapped to the kit in the opening room frame.
 * Coords are in the video's 1600x900 space; the SVG uses
 * preserveAspectRatio="xMidYMid slice" so lines/dots track the object-cover
 * crop. Labels are drop-shadowed text (no box) for a light HUD feel.
 */
const CALLOUTS: {
  cat: string;
  unit: string;
  dot: [number, number];
  label: [number, number]; // text anchor (top-left of the accent bar)
  from: [number, number]; // where the connector line meets the label
}[] = [
  // dots point at the real kit in clip 1's opening (1600x900 video space):
  // camera->ARRI body, lighting->DB CINEMA neon, lenses->flight case, audio->boom mic
  { cat: "Cameras", unit: "bodies", dot: [540, 250], label: [150, 150], from: [170, 162] },
  { cat: "Lenses", unit: "lenses", dot: [250, 560], label: [110, 628], from: [140, 616] },
  { cat: "Lighting", unit: "fixtures", dot: [955, 135], label: [1235, 250], from: [1225, 262] },
  { cat: "Audio", unit: "kits", dot: [1455, 420], label: [1245, 662], from: [1270, 650] },
];

export function HeroCinematic({ rating, categories }: { rating: Rating; categories: Cat[] }) {
  const c1Ref = useRef<HTMLVideoElement>(null);
  const c2Ref = useRef<HTMLVideoElement>(null);
  const loopRef = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [phase, setPhase] = useState<"c1" | "c2" | "loop">("c1");
  const [reduce, setReduce] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [mobileCtaReady, setMobileCtaReady] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mobile) {
      setMobileCtaReady(false);
      return;
    }
    setMobileCtaReady(true);
  }, [mobile]);

  useEffect(() => {
    const c1 = c1Ref.current;
    const c2 = c2Ref.current;
    const loopV = loopRef.current;
    if (!c1 || !c2 || !loopV) return;
    // React's `muted` JSX prop is unreliable for autoplay — set it on the element.
    c1.muted = c2.muted = loopV.muted = true;
    c1.setAttribute("webkit-playsinline", "true");
    c2.setAttribute("webkit-playsinline", "true");
    loopV.setAttribute("webkit-playsinline", "true");
    const failPlayback = () => {
      setPlaybackBlocked(true);
      setReduce(true);
    };
    const playbackStarted = () => {
      setPlaybackBlocked(false);
      setReduce(false);
    };

    // keep the initial load light: don't touch clip 2 / loop until needed.
    // clip 2 starts buffering ~40% into clip 1; the loop lazy-loads only once
    // clip 2 is playing.
    let c2Queued = false;
    let loopQueued = false;
    const onTime = () => {
      setT(c1.currentTime);
      const d = c1.duration || 15;
      if (!c2Queued && c1.currentTime > d * 0.4) {
        c2Queued = true;
        c2.preload = "auto";
        c2.load();
      }
    };
    const toC2 = () => {
      setPhase("c2");
      void c2.play().catch(failPlayback);
      if (!loopQueued) {
        loopQueued = true;
        loopV.preload = "auto";
        loopV.load();
      }
    };
    const toLoop = () => {
      setPhase("loop");
      void loopV.play().catch(failPlayback);
    };
    c1.addEventListener("timeupdate", onTime);
    c1.addEventListener("ended", toC2);
    c2.addEventListener("ended", toLoop);
    c1.addEventListener("playing", playbackStarted);
    c2.addEventListener("playing", playbackStarted);
    loopV.addEventListener("playing", playbackStarted);
    c1.addEventListener("error", failPlayback);
    c2.addEventListener("error", failPlayback);
    loopV.addEventListener("error", failPlayback);
    // play from the top. on iOS, seeking a muted autoplay video while it is
    // still loading blacks it out a second in — so never set currentTime here.
    const mobileViewport = window.matchMedia("(max-width: 767px)").matches;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion && !mobileViewport) {
      c1.pause();
      setReduce(true);
      setPlaybackBlocked(true);
    } else {
      void c1.play().catch(failPlayback); // autoplay blocked -> show an explicit play control
    }
    return () => {
      c1.removeEventListener("timeupdate", onTime);
      c1.removeEventListener("ended", toC2);
      c2.removeEventListener("ended", toLoop);
      c1.removeEventListener("playing", playbackStarted);
      c2.removeEventListener("playing", playbackStarted);
      loopV.removeEventListener("playing", playbackStarted);
      c1.removeEventListener("error", failPlayback);
      c2.removeEventListener("error", failPlayback);
      loopV.removeEventListener("error", failPlayback);
    };
  }, []);

  // `mobile` starts false during server rendering to avoid a hydration
  // mismatch. Retry the first muted play after the client has identified a
  // phone: Safari can reject the pre-hydration attempt before it is ready.
  useEffect(() => {
    if (!mobile || phase !== "c1") return;
    const video = c1Ref.current;
    if (!video || !video.paused) return;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute("webkit-playsinline", "true");
    const retry = () => {
      if (document.hidden || !video.paused) return;
      void video.play().then(() => {
        setPlaybackBlocked(false);
        setReduce(false);
      }).catch(() => {
        setPlaybackBlocked(true);
        setReduce(true);
      });
    };
    video.addEventListener("canplay", retry, { once: true });
    retry();
    return () => {
      video.removeEventListener("canplay", retry);
    };
  }, [mobile, phase]);

  const playFilm = () => {
    const first = c1Ref.current;
    const second = c2Ref.current;
    const loop = loopRef.current;
    if (!first) return;
    second?.pause();
    loop?.pause();
    first.muted = true;
    first.playsInline = true;
    if (first.ended && first.readyState >= 2) first.currentTime = 0;
    setPhase("c1");
    setT(0);
    setReduce(false);
    setPlaybackBlocked(false);
    void first.play().catch(() => {
      setReduce(true);
      setPlaybackBlocked(true);
    });
  };

  const gearVisible = !reduce && phase === "c1" && t > 0.5 && t < 4.6;
  const ctaVisible = reduce || phase !== "c1" || t > (mobile ? 0.4 : 0) || (mobile && mobileCtaReady);
  const ctaTransition = mobile
    ? "opacity .7s cubic-bezier(0.16,1,0.3,1), transform .7s cubic-bezier(0.16,1,0.3,1)"
    : "opacity 1s cubic-bezier(0.16,1,0.3,1), transform 1s cubic-bezier(0.16,1,0.3,1)";
  const countBy = new Map(categories.map((c) => [c.name, c.count]));

  return (
    <>
      {/* persistent cinematic still under everything — if a clip can't paint
          (iOS decoder/buffer hiccup) the hero falls back to this, never black */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/intro-poster.jpg"
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      {/* three stacked clips, instant hard-cut hand-off (clip 2 + loop preload while clip 1 plays) */}
      <video
        ref={c1Ref}
        className="absolute inset-0 h-full w-full object-cover object-center"
        // the clip1->clip2 anamorphic match is now baked into intro.mp4 itself
        // (scaleX 1.0325 scaleY 1.0125), so no CSS transform — alignment is in
        // the pixels and immune to window size / sub-pixel rendering.
        style={{ opacity: reduce || phase === "c1" ? 1 : 0 }}
        poster="/intro-poster.jpg"
        autoPlay={mobile && phase === "c1"}
        muted
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-hidden
      >
        {/* 1080p at ~3.4Mbps is five times more pixels than a phone can show
            and was taking most of a mobile connection before the first frame.
            Desktop source stays first so a browser that ignores `media` on
            <source> falls back to exactly the previous behaviour. */}
        <source src="/intro.mp4" type="video/mp4" media="(min-width: 769px)" />
        <source src="/intro-mobile.mp4" type="video/mp4" />
      </video>
      <video
        ref={c2Ref}
        className="absolute inset-0 h-full w-full object-cover object-center"
        style={{ opacity: !reduce && phase === "c2" ? 1 : 0 }}
        poster="/intro2-poster.jpg"
        autoPlay={mobile && phase === "c2"}
        muted
        playsInline
        preload="none"
        tabIndex={-1}
        aria-hidden
      >
        <source src="/intro2.mp4" type="video/mp4" media="(min-width: 769px)" />
        <source src="/intro2-mobile.mp4" type="video/mp4" />
      </video>
      <video
        ref={loopRef}
        className="absolute inset-0 h-full w-full object-cover object-center"
        style={{ opacity: !reduce && phase === "loop" ? 1 : 0 }}
        poster="/loop-poster.jpg"
        autoPlay={mobile && phase === "loop"}
        muted
        loop
        playsInline
        preload="none"
        tabIndex={-1}
        aria-hidden
      >
        <source src="/loop.mp4" type="video/mp4" media="(min-width: 769px)" />
        <source src="/loop-mobile.mp4" type="video/mp4" />
      </video>

      {/* legibility scrim — strongest once the CTA is up */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-700"
        style={{
          opacity: ctaVisible ? 1 : 0.4,
          background:
            "radial-gradient(ellipse at 50% 64%, rgba(5,5,10,0.08) 0%, rgba(5,5,10,0.5) 66%, rgba(5,5,10,0.86) 100%)",
        }}
        aria-hidden
      />

      {playbackBlocked && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 justify-center px-4">
          <button
            type="button"
            data-testid="hero-video-play"
            onClick={playFilm}
            className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-white/25 bg-black/60 px-5 py-2.5 text-sm font-medium text-white shadow-xl backdrop-blur-xl transition hover:border-accent-300/60 hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-300"
            aria-label="Play the landing page film"
          >
            <span aria-hidden="true" className="text-accent-300">▶</span>
            Play the film
          </button>
        </div>
      )}

      {/* ── minimal gear callouts (desktop) ── */}
      <svg
        data-testid="hero-gear-callouts"
        className="hero-gear-callouts pointer-events-none absolute inset-0 hidden h-full w-full transition-opacity duration-[900ms] min-[1024px]:block"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        style={{ opacity: gearVisible ? 1 : 0, zIndex: 6, color: "var(--color-accent-400)" }}
        aria-hidden
      >
        <defs>
          <filter id="hudShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor="#000" floodOpacity="0.95" />
          </filter>
        </defs>
        {CALLOUTS.map((c, i) => {
          const count = countBy.get(c.cat) ?? 0;
          const delay = `${i * 0.13}s`;
          const [lx, ly] = c.label;
          return (
            <g key={c.cat}>
              <line
                x1={c.from[0]}
                y1={c.from[1]}
                x2={c.dot[0]}
                y2={c.dot[1]}
                stroke="currentColor"
                strokeWidth={1.25}
                strokeOpacity={0.65}
                pathLength={1}
                strokeDasharray={1}
                style={{
                  strokeDashoffset: gearVisible ? 0 : 1,
                  transition: "stroke-dashoffset .75s cubic-bezier(0.16,1,0.3,1)",
                  transitionDelay: delay,
                }}
              />
              <circle cx={c.dot[0]} cy={c.dot[1]} r={3.5} fill="currentColor" />
              <circle
                cx={c.dot[0]}
                cy={c.dot[1]}
                r={8}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.25}
                strokeOpacity={0.45}
              />
              <g
                filter="url(#hudShadow)"
                style={{
                  opacity: gearVisible ? 1 : 0,
                  transform: gearVisible ? "translateY(0)" : "translateY(9px)",
                  transition:
                    "opacity .65s cubic-bezier(0.16,1,0.3,1), transform .65s cubic-bezier(0.16,1,0.3,1)",
                  transitionDelay: `calc(${delay} + .16s)`,
                }}
              >
                {/* slim accent tick */}
                <rect x={lx - 12} y={ly - 4} width={2} height={42} fill="currentColor" opacity={0.8} />
                <text
                  x={lx}
                  y={ly + 12}
                  fill="#ffffff"
                  fontSize={21}
                  fontWeight={600}
                  letterSpacing={2.5}
                  style={{ fontFamily: "var(--font-display, sans-serif)" }}
                >
                  {c.cat.toUpperCase()}
                </text>
                <text
                  x={lx}
                  y={ly + 33}
                  fill="currentColor"
                  fontSize={14}
                  letterSpacing={1}
                  style={{ fontFamily: "var(--font-mono, monospace)" }}
                >
                  {count}+ {c.unit}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      {/* ── catchphrase + CTA (fades in under the logo) ── */}
      <h1 className="sr-only">
        Camera Hire in London — rent cinema cameras, lenses, lighting, audio and drones from Db Cinema Rentals
      </h1>
      <div
        className="absolute inset-x-0 bottom-[4%] z-20 flex flex-col items-center px-3 text-center sm:bottom-[5%] sm:px-6"
        style={{ pointerEvents: ctaVisible ? "auto" : "none" }}
      >
        <p
          className="serif-accent text-[clamp(1.05rem,5vw,1.5rem)] text-white/90 lg:text-5xl"
          style={{
            opacity: ctaVisible ? 1 : 0,
            transform: ctaVisible ? "translateY(0)" : "translateY(26px)",
            transition: ctaTransition,
          }}
        >
          the gear that <span className="gradient-text">makes the shot.</span>
        </p>
        <div
          className="mt-3 grid w-full max-w-[28rem] grid-cols-[1.15fr_1fr] items-center justify-items-stretch gap-2 sm:mt-4 sm:flex sm:w-auto sm:max-w-none sm:justify-center sm:gap-2.5 lg:mt-6 lg:gap-3"
          style={{
            opacity: ctaVisible ? 1 : 0,
            transform: ctaVisible ? "translateY(0)" : "translateY(26px)",
            transition: ctaTransition,
            transitionDelay: mobile ? "0.1s" : "0.24s",
          }}
        >
          {/* all three are the same frosted material, and none of them move:
              no magnetic lean over the footage, just light and colour */}
          <Link href="/gear" className="btn-glass btn-glass-accent min-h-11 w-full justify-center whitespace-nowrap px-2 py-2 text-xs sm:w-auto sm:px-5 sm:py-2.5 sm:text-sm lg:px-8 lg:py-3 lg:text-base">
            Book rental gear
            <IconArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/how-it-works" className="btn-glass min-h-11 w-full justify-center whitespace-nowrap px-2 py-2 text-xs sm:w-auto sm:px-5 sm:py-2.5 sm:text-sm lg:px-8 lg:py-3 lg:text-base">
            How it works
          </Link>
          {/* straight into a live voice call with Gaffer */}
          <GafferCall
            variant="glass"
            label="Call us"
            className="col-span-2 min-h-11 justify-self-center !min-h-11 !px-4 !py-2 !text-xs !font-medium sm:!px-5 sm:!py-2.5 sm:!text-sm lg:!px-8 lg:!py-3 lg:!text-base"
          />
        </div>
        {rating && (
          <div
            className="max-w-full"
            style={{
              opacity: ctaVisible ? 1 : 0,
              transition: `opacity ${mobile ? ".7s" : "1s"} cubic-bezier(0.16,1,0.3,1)`,
              transitionDelay: mobile ? "0.2s" : "0.48s",
            }}
          >
            {/* the rating is the proof — make it go to the proof. A plain hash
                link, so the browser does the smooth scroll (html already sets
                scroll-behavior: smooth, and drops it under prefers-reduced-motion). */}
            <a
              href="#reviews"
              aria-label={`Rated ${rating.ratingValue.toFixed(2)} out of 5 from ${rating.reviewCountLabel} renter reviews; read all reviews`}
              className="group mt-3 inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-black/30 px-2.5 py-1.5 text-xs text-white/70 shadow-lg backdrop-blur-md transition-colors hover:border-accent-400/40 hover:bg-black/45 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-400/70 sm:gap-3 sm:px-4 sm:py-2 sm:text-sm lg:mt-5"
            >
              <span aria-hidden="true" className="flex text-accent-400">
                {Array.from({ length: 5 }).map((_, i) => (
                  <IconStar key={i} className="h-3 w-3 sm:h-4 sm:w-4" />
                ))}
              </span>
              <span className="font-mono font-semibold text-white">{rating.ratingValue.toFixed(2)}</span>
              <span className="text-white/40">/ 5</span>
              <span className="text-white/35">·</span>
              <span className="font-medium underline decoration-white/30 decoration-dotted underline-offset-4 transition-colors group-hover:decoration-accent-400/70">
                {rating.reviewCountLabel} reviews
              </span>
            </a>
          </div>
        )}
      </div>
    </>
  );
}
