"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Magnetic } from "@/components/Magnetic";
import { IconArrowRight, IconStar } from "@/components/icons";

type Rating = { ratingValue: number; reviewCount: number } | null;
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
  const [dur, setDur] = useState(0);
  const [reduce, setReduce] = useState(false);
  const [mobile, setMobile] = useState(false); // mobile: show the overlaid CTA immediately

  useEffect(() => {
    const c1 = c1Ref.current;
    const c2 = c2Ref.current;
    const loopV = loopRef.current;
    if (!c1 || !c2 || !loopV) return;
    // React's `muted` JSX prop is unreliable for autoplay — set it on the element.
    c1.muted = c2.muted = loopV.muted = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduce(true);
      return;
    }

    // keep the initial load light: don't touch clip 2 / loop until needed.
    // clip 2 starts buffering ~40% into clip 1; the loop lazy-loads only once
    // clip 2 is playing.
    let c2Queued = false;
    let loopQueued = false;
    let durSet = false;
    const onTime = () => {
      setT(c1.currentTime);
      const d = c1.duration || 15;
      if (!durSet && c1.duration) {
        durSet = true;
        setDur(c1.duration);
      }
      if (!c2Queued && c1.currentTime > d * 0.4) {
        c2Queued = true;
        c2.preload = "auto";
        c2.load();
      }
    };
    const toC2 = () => {
      setPhase("c2");
      void c2.play().catch(() => {});
      if (!loopQueued) {
        loopQueued = true;
        loopV.preload = "auto";
        loopV.load();
      }
    };
    const toLoop = () => {
      setPhase("loop");
      void loopV.play().catch(() => {});
    };
    c1.addEventListener("timeupdate", onTime);
    c1.addEventListener("ended", toC2);
    c2.addEventListener("ended", toLoop);
    void c1.play().catch(() => setReduce(true)); // autoplay blocked -> static + CTA
    return () => {
      c1.removeEventListener("timeupdate", onTime);
      c1.removeEventListener("ended", toC2);
      c2.removeEventListener("ended", toLoop);
    };
  }, []);

  // mobile → the CTA overlays a shorter hero, so show it immediately
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const set = () => setMobile(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  const gearVisible = !reduce && phase === "c1" && t > 0.5 && t < 4.6;
  // UI comes in 1s before clip 2 starts (i.e. 1s before clip 1 ends); on mobile
  // the CTA overlays a shorter hero so it's shown right away.
  const ctaVisible = mobile || reduce || phase !== "c1" || (dur > 1 ? t > dur - 1 : t > 12.3);
  const countBy = new Map(categories.map((c) => [c.name, c.count]));

  return (
    <>
      {/* three stacked clips, instant hard-cut hand-off (clip 2 + loop preload while clip 1 plays) */}
      <video
        ref={c1Ref}
        className="absolute inset-0 h-full w-full object-cover object-center"
        // the clip1->clip2 anamorphic match is now baked into intro.mp4 itself
        // (scaleX 1.0325 scaleY 1.0125), so no CSS transform — alignment is in
        // the pixels and immune to window size / sub-pixel rendering.
        style={{ opacity: reduce || phase === "c1" ? 1 : 0 }}
        src="/intro.mp4"
        poster="/intro-poster.jpg"
        muted
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-hidden
      />
      <video
        ref={c2Ref}
        className="absolute inset-0 h-full w-full object-cover object-center"
        style={{ opacity: !reduce && phase === "c2" ? 1 : 0 }}
        src="/intro2.mp4"
        poster="/intro2-poster.jpg"
        muted
        playsInline
        preload="none"
        tabIndex={-1}
        aria-hidden
      />
      <video
        ref={loopRef}
        className="absolute inset-0 h-full w-full object-cover object-center"
        style={{ opacity: !reduce && phase === "loop" ? 1 : 0 }}
        src="/loop.mp4"
        poster="/loop-poster.jpg"
        muted
        loop
        playsInline
        preload="none"
        tabIndex={-1}
        aria-hidden
      />

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

      {/* ── minimal gear callouts (desktop) ── */}
      <svg
        className="pointer-events-none absolute inset-0 hidden h-full w-full transition-opacity duration-[900ms] md:block"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        style={{ opacity: gearVisible ? 1 : 0, zIndex: 6 }}
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
                stroke="#38bdf8"
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
              <circle cx={c.dot[0]} cy={c.dot[1]} r={3.5} fill="#38bdf8" />
              <circle
                cx={c.dot[0]}
                cy={c.dot[1]}
                r={8}
                fill="none"
                stroke="#38bdf8"
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
                <rect x={lx - 12} y={ly - 4} width={2} height={42} fill="#38bdf8" opacity={0.8} />
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
                  fill="#38bdf8"
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
        DB Cinema Rentals — professional camera, lens, lighting and audio rental in London
      </h1>
      <div
        className="absolute inset-x-0 bottom-[5%] z-20 flex flex-col items-center px-6 text-center"
        style={{ pointerEvents: ctaVisible ? "auto" : "none" }}
      >
        <p
          className="serif-accent text-3xl text-white/90 sm:text-5xl"
          style={{
            opacity: ctaVisible ? 1 : 0,
            transform: ctaVisible ? "translateY(0)" : "translateY(26px)",
            transition:
              "opacity 1s cubic-bezier(0.16,1,0.3,1), transform 1s cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          the gear that <span className="gradient-text">makes the shot.</span>
        </p>
        <div
          className="mt-6 flex flex-wrap items-center justify-center gap-3"
          style={{
            opacity: ctaVisible ? 1 : 0,
            transform: ctaVisible ? "translateY(0)" : "translateY(26px)",
            transition:
              "opacity 1s cubic-bezier(0.16,1,0.3,1), transform 1s cubic-bezier(0.16,1,0.3,1)",
            transitionDelay: "0.24s",
          }}
        >
          <Magnetic>
            <Link href="/gear" className="btn-primary px-8 py-3">
              Browse the kit
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </Magnetic>
          <Magnetic>
            <Link href="/how-it-works" className="btn-ghost px-8 py-3">
              How it works
            </Link>
          </Magnetic>
        </div>
        {rating && (
          <div
            className="mt-5 flex items-center gap-2.5 text-sm text-white/55"
            style={{
              opacity: ctaVisible ? 1 : 0,
              transition: "opacity 1s cubic-bezier(0.16,1,0.3,1)",
              transitionDelay: "0.48s",
            }}
          >
            <span className="flex text-accent-400">
              {Array.from({ length: 5 }).map((_, i) => (
                <IconStar key={i} className="h-3.5 w-3.5" />
              ))}
            </span>
            <span className="font-mono text-white/80">{rating.ratingValue.toFixed(2)}</span>
            <span className="text-white/25">·</span>
            <span>{rating.reviewCount}+ verified reviews</span>
          </div>
        )}
      </div>
    </>
  );
}
