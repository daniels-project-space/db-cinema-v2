"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Magnetic } from "@/components/Magnetic";
import { IconArrowRight, IconStar } from "@/components/icons";

type Rating = { ratingValue: number; reviewCount: number } | null;
type Cat = { name: string; count: number };

/**
 * Gear callouts, mapped to where the kit sits in the opening room frame.
 * Coordinates are in the video's 1600x900 space; the SVG uses
 * preserveAspectRatio="xMidYMid slice" so the lines/dots track the same crop
 * the <video object-cover> applies. label = real category + live stock count.
 */
const CALLOUTS: {
  cat: string;
  unit: string;
  dot: [number, number];
  box: [number, number]; // top-left of label
  from: [number, number]; // line start (on the label edge)
}[] = [
  { cat: "Cameras", unit: "bodies", dot: [520, 330], box: [120, 120], from: [300, 175] },
  { cat: "Lenses", unit: "lenses", dot: [330, 530], box: [80, 612], from: [240, 612] },
  { cat: "Lighting", unit: "fixtures", dot: [1150, 395], box: [1200, 140], from: [1300, 226] },
  { cat: "Audio", unit: "kits", dot: [1185, 575], box: [1210, 640], from: [1300, 640] },
];

const BOX_W = 290;
const BOX_H = 86;

export function HeroCinematic({ rating, categories }: { rating: Rating; categories: Cat[] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [loop, setLoop] = useState(false);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduce(true);
      return;
    }
    let swapped = false;
    const onTime = () => setT(v.currentTime);
    const onEnded = () => {
      if (swapped) return;
      swapped = true;
      v.src = "/loop.mp4";
      v.loop = true;
      v.load();
      void v.play().catch(() => {});
      setLoop(true);
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnded);
    void v.play().catch(() => setReduce(true)); // autoplay blocked → just show the CTA
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onEnded);
    };
  }, []);

  const gearVisible = !reduce && !loop && t > 0.5 && t < 4.6;
  const ctaVisible = reduce || loop || t > 12.3;

  const countBy = new Map(categories.map((c) => [c.name, c.count]));

  return (
    <>
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover object-center"
        src="/intro.mp4"
        poster="/hero-backwall.jpg"
        muted
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-hidden
      />

      {/* legibility scrim — only really needed once the CTA is up */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-700"
        style={{
          opacity: ctaVisible ? 1 : 0.45,
          background:
            "radial-gradient(ellipse at 50% 64%, rgba(5,5,10,0.10) 0%, rgba(5,5,10,0.5) 66%, rgba(5,5,10,0.85) 100%)",
        }}
        aria-hidden
      />

      {/* ── gear callouts (desktop) ── */}
      <svg
        className="pointer-events-none absolute inset-0 hidden h-full w-full transition-opacity duration-[900ms] md:block"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        style={{ opacity: gearVisible ? 1 : 0, zIndex: 6 }}
        aria-hidden
      >
        {CALLOUTS.map((c, i) => {
          const count = countBy.get(c.cat) ?? 0;
          const delay = `${i * 0.1}s`;
          const [bx, by] = c.box;
          return (
            <g key={c.cat}>
              <line
                x1={c.from[0]}
                y1={c.from[1]}
                x2={c.dot[0]}
                y2={c.dot[1]}
                stroke="#38bdf8"
                strokeWidth={1.5}
                strokeOpacity={0.7}
                pathLength={1}
                strokeDasharray={1}
                style={{
                  strokeDashoffset: gearVisible ? 0 : 1,
                  transition: "stroke-dashoffset .6s ease",
                  transitionDelay: delay,
                }}
              />
              <circle cx={c.dot[0]} cy={c.dot[1]} r={5} fill="#38bdf8" />
              <circle
                cx={c.dot[0]}
                cy={c.dot[1]}
                r={11}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={1.5}
                strokeOpacity={0.5}
              />
              <g
                style={{
                  opacity: gearVisible ? 1 : 0,
                  transform: gearVisible ? "translateY(0)" : "translateY(6px)",
                  transition: "opacity .5s ease, transform .5s ease",
                  transitionDelay: `calc(${delay} + .15s)`,
                }}
              >
                <rect
                  x={bx}
                  y={by}
                  width={BOX_W}
                  height={BOX_H}
                  rx={8}
                  fill="rgba(5,5,10,0.62)"
                  stroke="#38bdf8"
                  strokeOpacity={0.35}
                  strokeWidth={1}
                />
                <text
                  x={bx + 20}
                  y={by + 36}
                  fill="#ffffff"
                  fontSize={30}
                  fontWeight={700}
                  letterSpacing={2}
                  style={{ fontFamily: "var(--font-display, sans-serif)" }}
                >
                  {c.cat.toUpperCase()}
                </text>
                <text
                  x={bx + 20}
                  y={by + 66}
                  fill="#38bdf8"
                  fontSize={21}
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
        className="absolute inset-x-0 bottom-[15%] z-10 flex flex-col items-center px-6 text-center"
        style={{ pointerEvents: ctaVisible ? "auto" : "none" }}
      >
        <p
          className="serif-accent text-3xl text-white/90 sm:text-5xl"
          style={{
            opacity: ctaVisible ? 1 : 0,
            transform: ctaVisible ? "translateY(0)" : "translateY(18px)",
            transition: "opacity .9s ease, transform .9s ease",
          }}
        >
          the gear that <span className="gradient-text">makes the shot.</span>
        </p>
        <div
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
          style={{
            opacity: ctaVisible ? 1 : 0,
            transform: ctaVisible ? "translateY(0)" : "translateY(18px)",
            transition: "opacity .9s ease, transform .9s ease",
            transitionDelay: "0.18s",
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
            className="mt-7 flex items-center gap-2.5 text-sm text-white/55"
            style={{
              opacity: ctaVisible ? 1 : 0,
              transition: "opacity .9s ease",
              transitionDelay: "0.36s",
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
