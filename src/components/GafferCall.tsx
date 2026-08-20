"use client";

import { useRef, useState } from "react";

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

/** In-browser voice call to Gaffer. A bespoke, cinematic control (no floating widget) so it can
 * sit inside the bot and the footer: breathing glow + hover light-sweep when idle, a connecting
 * spinner, and a live audio-equalizer that dances while Gaffer is speaking. */
export function GafferCall({ className = "", label = "Talk to Gaffer" }: { className?: string; label?: string }) {
  const [state, setState] = useState<"idle" | "connecting" | "live">("idle");
  const [speaking, setSpeaking] = useState(false);
  const conv = useRef<any>(null);

  async function toggle() {
    if (state === "live" || state === "connecting") return end();
    setState("connecting");
    try {
      const { Conversation } = await import("@elevenlabs/client");
      await navigator.mediaDevices.getUserMedia({ audio: true });
      conv.current = await Conversation.startSession({
        agentId: AGENT_ID,
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

  const live = state === "live";
  const connecting = state === "connecting";

  const base =
    "gaffer-call group relative inline-flex select-none items-center gap-2.5 overflow-hidden rounded-full px-4 py-2 text-sm font-semibold text-white transition-all duration-300";
  const tone = live
    ? "bg-gradient-to-br from-rose-500 to-rec-600 shadow-[0_6px_24px_-6px_rgba(244,63,94,0.55)]"
    : connecting
      ? "bg-accent-500/70"
      : "press bg-gradient-to-br from-accent-400 to-accent-600 shadow-[0_6px_22px_-6px_rgba(224,153,47,0.6)] hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-8px_rgba(224,153,47,0.78)]";

  return (
    <button
      onClick={toggle}
      data-state={state}
      aria-label={live ? "End voice call with Gaffer" : "Start a voice call with Gaffer"}
      className={`${base} ${tone} ${className}`}
    >
      {/* breathing glow invites a call (idle) */}
      {!live && !connecting && <span className="gc-glow pointer-events-none absolute inset-0 rounded-full bg-accent-400/45 blur-md" aria-hidden />}
      {/* expanding ring while live */}
      {live && <span className="gc-ring pointer-events-none absolute inset-0 rounded-full border border-rose-200/70" aria-hidden />}
      {/* hover light-sweep (idle) */}
      {!live && !connecting && <span className="gc-sheen pointer-events-none absolute inset-0 rounded-full" aria-hidden />}

      <span className="relative z-10 flex h-4 w-4 items-center justify-center">
        {live ? (
          <span className="flex h-3.5 items-end gap-[2.5px]" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`gc-bar w-[2.5px] rounded-full bg-current ${speaking ? "" : "gc-bar-idle"}`} />
            ))}
          </span>
        ) : connecting ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : (
          <Headset />
        )}
      </span>

      <span className="relative z-10">
        {live ? (speaking ? "Gaffer speaking…" : "End call") : connecting ? "Connecting…" : label}
      </span>
    </button>
  );
}
