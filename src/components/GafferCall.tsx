"use client";

import Link from "next/link";
import { useGafferSession } from "@/components/gaffer/GafferSession";

function Headset() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="2.5" y="12.3" width="4" height="6.7" rx="1.6" />
      <rect x="17.5" y="12.3" width="4" height="6.7" rx="1.6" />
      <path d="M19.5 19v.6a3 3 0 0 1-3 3H13" />
    </svg>
  );
}

function clock(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** In-browser voice call to Gaffer. A bespoke, cinematic control (no floating widget) so it can
 * sit inside the bot, the hero and the footer.
 *
 * Only the current call state is rendered in the label rail, so crawlers and
 * assistive technology never receive idle, connecting and live states together.
 * The rail still cross-fades state changes, and the deliberate idle→live width
 * expansion is animated via `grid-template-columns: 0fr → 1fr`. */
export function GafferCall({
  className = "",
  label = "Talk to Gaffer",
  variant = "solid",
  compact = false,
  topic,
}: {
  className?: string;
  label?: string;
  /** `glass` sits on imagery (hero) without competing with the primary amber CTA. */
  variant?: "solid" | "glass";
  /** Drop the spoken-state wording during a call — for tight spots like the bot header. */
  compact?: boolean;
  /** What the caller was reading, when the page alone doesn't say — a guide's
   *  title, say. Passed to Gaffer as context at connect. */
  topic?: string;
}) {
  // The session itself lives in GafferSessionProvider (root layout) so a call
  // survives Gaffer navigating between pages. This is now purely the control.
  const { state, speaking, secs, error, toggle } = useGafferSession();

  const live = state === "live";
  const connecting = state === "connecting";

  return (
    <>
    <button
      type="button"
      onClick={() => toggle(topic)}
      data-state={state}
      data-variant={variant}
      data-speaking={live && speaking ? "true" : "false"}
      aria-busy={connecting}
      aria-label={live ? "End voice call with Gaffer" : connecting ? "Cancel connection to Gaffer" : error ? "Retry voice call with Gaffer" : "Start a voice call with Gaffer"}
      title={error ?? undefined}
      className={`gaffer-call relative inline-flex select-none items-center rounded-full px-4 py-2 text-sm font-semibold text-white ${className}`}
    >
      {/* colour plates — cross-fade amber→rose instead of swapping gradients */}
      <span className="gc-fill gc-fill-idle" aria-hidden />
      <span className="gc-fill gc-fill-live" aria-hidden />
      {/* halo: breathes when idle, swells while Gaffer talks (opacity only — no layout) */}
      <span className="gc-halo gc-halo-idle" aria-hidden />
      <span className="gc-halo gc-halo-live" aria-hidden />
      {/* live sonar rings — constant cadence, so speaking/listening never restarts them */}
      <span className="gc-ring" aria-hidden />
      <span className="gc-ring gc-ring-2" aria-hidden />
      {/* hover light-sweep (idle only) */}
      <span className="gc-sheen" aria-hidden />

      {/* icon slot — fixed 1rem square, the three icons cross-fade in place */}
      <span className="gc-icon relative z-10">
        <span className="gc-icon-layer" data-on={state === "idle"} aria-hidden={state !== "idle"}>
          <Headset />
        </span>
        <span className="gc-icon-layer" data-on={connecting} aria-hidden={!connecting}>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        </span>
        <span className="gc-icon-layer" data-on={live} aria-hidden={!live}>
          <span className="flex h-3.5 items-end gap-[2.5px]">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="gc-bar w-[2.5px] rounded-full bg-current" />
            ))}
          </span>
        </span>
      </span>

      {/* label rail — two segments, each collapses to zero width with an eased grid track */}
      <span className="gc-rail relative z-10">
        <span className="gc-seg" data-open={!live}>
          <span className="gc-seg-in">
            <span className="gc-stack">
              {state === "idle" && <span className="gc-status" data-on="true" aria-hidden="true">{label}</span>}
              {connecting && <span className="gc-status" data-on="true" aria-hidden="true">Connecting…</span>}
            </span>
          </span>
        </span>

        <span className="gc-seg" data-open={live}>
          <span className="gc-seg-in">
            {live && !compact && (
              <span className="gc-stack">
                <span className="gc-status" data-on="true" aria-hidden="true">
                  {speaking ? "Gaffer speaking…" : "Listening…"}
                </span>
              </span>
            )}
            {live && <span className="gc-timer">{clock(secs)}</span>}
          </span>
        </span>
      </span>

      {/* the only thing screen readers should hear about the call's state.
          A failed start is announced here and surfaced as the button's tooltip,
          so "nothing happened" always has a stated reason — without disturbing
          the layout the rest of this component works hard to keep stable. */}
      <span className="sr-only" aria-live="polite">
        {error
          ? error
          : live
            ? (speaking ? "Gaffer is speaking" : "Gaffer is listening")
            : connecting
              ? "Connecting"
              : ""}
      </span>
    </button>
    {error && !live && !connecting && (
      <span role="alert" className="ml-2 inline-flex flex-wrap items-center gap-1 text-xs text-rose-200/85">
        Voice call unavailable. <Link href="/contact" className="underline underline-offset-2">Contact us</Link>
      </span>
    )}
    </>
  );
}
