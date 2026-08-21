"use client";

import { useEffect, useState } from "react";

// timings (ms) for the periodic spin + idle shine cycle — kept in sync with
// the fs-mark-spin / fs-shine-sweep keyframe durations in globals.css.
// SPIN_DURATION covers three revolutions: two brisk, the third easing to a stop.
const CYCLE_EVERY = 7500;
const SPIN_DURATION = 2600;
const SHINE_DELAY_AFTER_SPIN = 1400;
const SHINE_DURATION = 900;

/** Drives the periodic coin turn + idle shine sweep. Call once and share the
 * result across every mounted coin so they stay in sync and don't run
 * duplicate timers. */
export function useSpinAndShine() {
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

/**
 * The whole rounded-rect "coin" — badge frame + glow ring + mark all turn
 * together as one unit. A duplicate of the mark sits on the back face
 * (`backface-visibility: hidden` on both), so at every point in the turn one
 * of the two is facing the camera — the mark stays persistently visible
 * through the whole spin instead of fading through the edge-on moment.
 */
export function FormSevenCoin({ spinning, shining }: { spinning: boolean; shining: boolean }) {
  return (
    <span className="fs-coin-stage inline-flex shrink-0">
      <span className={`fs-badge relative flex h-12 aspect-[9/16] items-center justify-center rounded-lg ${spinning ? "fs-spin" : ""}`}>
        <span className="fs-face fs-face-front">
          <FormSevenMark shining={shining} />
        </span>
        <span className="fs-face fs-face-back">
          <FormSevenMark shining={shining} />
        </span>
      </span>
    </span>
  );
}

/**
 * Mobile hamburger-sheet entry point — coin + "FORM 7" label. Tapping opens
 * the Signature Productions overlay, same as clicking the coin in the desktop
 * header (there's no hover state on touch, so the desktop takeover effect
 * doesn't apply here — this is just a plain tap target).
 */
export function FormSevenMobileTrigger({
  spinning,
  shining,
  onOpen,
}: {
  spinning: boolean;
  shining: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="mt-2 flex w-full items-center gap-3 border-t border-white/[0.06] py-4 text-left"
    >
      <FormSevenCoin spinning={spinning} shining={shining} />
      {/* names the relationship, not just the partner — this sits in a list of
          our own pages, where a bare brand name reads as another section of
          this site */}
      <span className="font-display text-lg font-semibold text-white/85">FORM 7 collaboration</span>
    </button>
  );
}
