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

function FormSevenMark({ shining }: { shining: boolean }) {
  const [imgOk, setImgOk] = useState(true);

  return (
    <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg bg-[#0a1f14]">
      {imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/brand/form-seven-mark.png"
          alt="FORM / SEVEN"
          onError={() => setImgOk(false)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="font-display text-lg font-semibold text-emerald-400/40">7</span>
      )}
      <span aria-hidden className={`fs-shine ${shining ? "fs-shine-on" : ""}`} />
    </span>
  );
}

/** The whole rounded-rect "coin" — badge frame + glow ring + mark all turn together as one unit. */
function FormSevenCoin({ spinning, shining }: { spinning: boolean; shining: boolean }) {
  return (
    <span className="fs-coin-stage inline-flex shrink-0">
      <span className={`fs-badge relative flex h-12 aspect-[9/16] items-center justify-center rounded-lg ${spinning ? "fs-spin" : ""}`}>
        <FormSevenMark shining={shining} />
      </span>
    </span>
  );
}

/**
 * FORM / SEVEN brand badge — replaces the old plain "Media Engine" text link.
 * Desktop: a glowing rounded-rect badge (edge glow ring + mark turn together as
 * one "coin") with a continuously orbiting edge glow, a periodic eased
 * revolving-door turn, an idle shine sweep, and a hover reveal ("FORM 7 ad
 * agency") that fades in beside the badge without reflowing the nav. Mobile:
 * the same coin + a static "FORM 7" label, no hover interaction (touch has no
 * hover state). All motion is hand-rolled CSS keyframes in globals.css, gated
 * behind prefers-reduced-motion — same convention as SiteHeader's gear-turn click.
 */
export function FormSevenBadge({ mobile = false }: { mobile?: boolean }) {
  const { spinning, shining } = useSpinAndShine();
  const mark = <FormSevenCoin spinning={spinning} shining={shining} />;

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
      className={`fs-link relative flex h-12 items-center ${hasFormSeven ? "" : "pointer-events-none opacity-40"}`}
    >
      <span className="fs-mark-wrap relative z-10">{mark}</span>
      <span className="fs-reveal-text absolute left-full top-1/2 ml-3 whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-white/70">
        FORM 7 ad agency
      </span>
    </a>
  );
}
