"use client";

import { useEffect, useState } from "react";

// FORM / SEVEN — Daniel's AI-native ad agency and cross-link partner. Wired
// via env so a follow-up step can set the real URL without touching this
// file. Shares the same "coming soon" fallback pattern as the rest of the
// header (see SiteHeader.tsx / SignatureProductionsOverlay.tsx) — plus the
// mark image at /public/brand/form-seven-mark.png, which Daniel will drop in
// later. Both are expected-pending, not bugs, until then.
const FORM_SEVEN_URL = process.env.NEXT_PUBLIC_FORM_SEVEN_URL || "";
const hasFormSeven = FORM_SEVEN_URL.startsWith("http");

// timings (ms) for the periodic eased spin + idle shine cycle — kept in sync
// with the fs-mark-spin / fs-shine-sweep keyframe durations in globals.css
const CYCLE_EVERY = 7000;
const SPIN_DURATION = 1800;
const SHINE_DELAY_AFTER_SPIN = 1400;
const SHINE_DURATION = 900;

function useSpinAndShine() {
  const [spinning, setSpinning] = useState(false);
  const [shining, setShining] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const runCycle = () => {
      setSpinning(true);
      timers.push(
        setTimeout(() => {
          setSpinning(false);
          timers.push(
            setTimeout(() => {
              setShining(true);
              timers.push(setTimeout(() => setShining(false), SHINE_DURATION));
            }, SHINE_DELAY_AFTER_SPIN)
          );
        }, SPIN_DURATION)
      );
    };

    runCycle();
    const interval = setInterval(runCycle, CYCLE_EVERY);
    return () => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, []);

  return { spinning, shining };
}

function FormSevenMark({ spinning, shining }: { spinning: boolean; shining: boolean }) {
  const [imgOk, setImgOk] = useState(true);

  return (
    <span className="fs-badge relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
      <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl bg-[#0a1f14]">
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/brand/form-seven-mark.png"
            alt="FORM / SEVEN"
            onError={() => setImgOk(false)}
            className={`fs-mark h-full w-full object-contain p-1.5 ${spinning ? "fs-spin" : ""}`}
          />
        ) : (
          <span className="font-display text-lg font-semibold text-emerald-400/40">7</span>
        )}
        <span aria-hidden className={`fs-shine ${shining ? "fs-shine-on" : ""}`} />
      </span>
    </span>
  );
}

/**
 * FORM / SEVEN brand badge — replaces the old plain "Media Engine" text link.
 * Desktop: a glowing rounded-rect badge with a continuously orbiting edge
 * glow, a periodic eased rotation of the mark itself, an idle shine sweep,
 * and a hover reveal ("FORM 7 ad agency"). Mobile: the same mark + a static
 * "FORM 7" label, no hover interaction (touch has no hover state).
 * All motion is hand-rolled CSS keyframes in globals.css, gated behind
 * prefers-reduced-motion — same convention as SiteHeader's gear-turn click.
 */
export function FormSevenBadge({ mobile = false }: { mobile?: boolean }) {
  const { spinning, shining } = useSpinAndShine();
  const mark = <FormSevenMark spinning={spinning} shining={shining} />;

  if (mobile) {
    const content = (
      <>
        {mark}
        <span className="font-display text-lg font-semibold text-white/85">FORM 7</span>
      </>
    );
    return hasFormSeven ? (
      <a
        href={FORM_SEVEN_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 flex items-center gap-3 border-t border-white/[0.06] py-4"
      >
        {content}
      </a>
    ) : (
      <div className="mt-2 flex items-center gap-3 border-t border-white/[0.06] py-4 opacity-40" title="Coming soon">
        {content}
      </div>
    );
  }

  return (
    <a
      href={hasFormSeven ? FORM_SEVEN_URL : "#"}
      target={hasFormSeven ? "_blank" : undefined}
      rel={hasFormSeven ? "noopener noreferrer" : undefined}
      onClick={(e) => {
        if (!hasFormSeven) e.preventDefault();
      }}
      aria-label="FORM / SEVEN — AI-native ad agency"
      title={hasFormSeven ? undefined : "Coming soon"}
      className={`fs-link flex h-11 items-center ${hasFormSeven ? "" : "pointer-events-none opacity-40"}`}
    >
      <span className="fs-mark-wrap">{mark}</span>
      <span className="fs-reveal">
        <span className="whitespace-nowrap pl-3 font-mono text-[11px] uppercase tracking-wider text-white/70">
          FORM 7 ad agency
        </span>
      </span>
    </a>
  );
}
