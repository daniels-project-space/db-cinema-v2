"use client";

import { useEffect, useRef, useState } from "react";
import { useGafferTools } from "@/components/gaffer/useGafferTools";

// The Db Cinema "Gaffer" ElevenLabs Conversational-AI agent (British female voice,
// wired to the live catalogue + booking/inquiry tools). Public agent → agentId is enough.
const AGENT_ID = "agent_4601kvk2pfznfrws6ah700jnxvfv";

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
 * Layout stability is the whole design brief here: the button must never twitch when Gaffer
 * starts or stops speaking. So every label that can appear *during a call* is stacked in the
 * same grid cell (the cell sizes to the widest, the words cross-fade inside it), and the only
 * width change in the component's life is the deliberate idle→live expansion, which is animated
 * via `grid-template-columns: 0fr → 1fr`. Speaking state is expressed purely through things that
 * cost no layout: equaliser amplitude (`--gc-amp`, eased), halo intensity and shadow. */
export function GafferCall({
  className = "",
  label = "Talk to Gaffer",
  variant = "solid",
  compact = false,
}: {
  className?: string;
  label?: string;
  /** `glass` sits on imagery (hero) without competing with the primary amber CTA. */
  variant?: "solid" | "glass";
  /** Drop the spoken-state wording during a call — for tight spots like the bot header. */
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "connecting" | "live">("idle");
  const [speaking, setSpeaking] = useState(false);
  const [secs, setSecs] = useState(0);
  const conv = useRef<any>(null);
  // Lets Gaffer drive the page (open gear, fill the basket) and know who it's
  // talking to — see useGafferTools.
  const { clientTools, dynamicVariables } = useGafferTools();

  const live = state === "live";
  const connecting = state === "connecting";

  // call timer — only ticks while connected
  useEffect(() => {
    if (!live) {
      setSecs(0);
      return;
    }
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [live]);

  // never leave a session open behind an unmount (route change with the footer on screen)
  useEffect(() => {
    return () => {
      void conv.current?.endSession?.().catch?.(() => {});
      conv.current = null;
    };
  }, []);

  async function toggle() {
    if (state === "live" || state === "connecting") return end();
    setState("connecting");
    try {
      const { Conversation } = await import("@elevenlabs/client");
      await navigator.mediaDevices.getUserMedia({ audio: true });
      conv.current = await Conversation.startSession({
        agentId: AGENT_ID,
        clientTools,
        dynamicVariables,
        onConnect: () => setState("live"),
        onDisconnect: () => { setState("idle"); setSpeaking(false); conv.current = null; },
        onError: (err: unknown) => {
          console.error("[GafferCall] session error", err);
          setState("idle"); setSpeaking(false); conv.current = null;
        },
        onModeChange: (m: any) => setSpeaking(m?.mode === "speaking"),
      });
    } catch (err) {
      // Never swallow this silently: a blocked mic (Permissions-Policy), a
      // denied prompt and an SDK failure all land here and are otherwise
      // indistinguishable from "the button does nothing".
      console.error("[GafferCall] failed to start session", err);
      setState("idle");
      conv.current = null;
    }
  }
  async function end() {
    try { await conv.current?.endSession(); } catch {}
    conv.current = null;
    setState("idle");
    setSpeaking(false);
  }

  return (
    <button
      onClick={toggle}
      data-state={state}
      data-variant={variant}
      data-speaking={live && speaking ? "true" : "false"}
      aria-label={live ? "End voice call with Gaffer" : "Start a voice call with Gaffer"}
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
              <span data-on={state === "idle"}>{label}</span>
              <span data-on={connecting}>Connecting…</span>
            </span>
          </span>
        </span>

        <span className="gc-seg" data-open={live}>
          <span className="gc-seg-in">
            {!compact && (
              <span className="gc-stack">
                <span data-on={speaking}>Gaffer speaking…</span>
                <span data-on={!speaking}>Listening…</span>
              </span>
            )}
            <span className="gc-timer">{clock(secs)}</span>
          </span>
        </span>
      </span>

      {/* the only thing screen readers should hear about the call's state */}
      <span className="sr-only" aria-live="polite">
        {live ? (speaking ? "Gaffer is speaking" : "Gaffer is listening") : connecting ? "Connecting" : ""}
      </span>
    </button>
  );
}
