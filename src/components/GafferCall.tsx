"use client";

import { useRef, useState } from "react";

// The Db Cinema "Gaffer" ElevenLabs Conversational-AI agent (British female voice,
// wired to the live catalogue + booking/inquiry tools). Public agent → agentId is enough.
const AGENT_ID = "agent_4601kvk2pfznfrws6ah700jnxvfv";

/** In-browser voice call to Gaffer. Our own button (no floating widget) so it can sit
 * inside the bot and the footer without clashing with the chat launcher. */
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
        onError: () => { setState("idle"); setSpeaking(false); conv.current = null; },
        onModeChange: (m: any) => setSpeaking(m?.mode === "speaking"),
      });
    } catch {
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
  return (
    <button
      onClick={toggle}
      aria-label={live ? "End voice call with Gaffer" : "Start a voice call with Gaffer"}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
        live ? "bg-rec-500 text-white hover:bg-rec-600" : state === "connecting" ? "bg-accent-500/70 text-white" : "bg-accent-500 text-white hover:bg-accent-600"
      } ${className}`}
    >
      <span className={`inline-flex h-2.5 w-2.5 rounded-full bg-current ${live ? (speaking ? "animate-ping" : "opacity-90") : ""}`} aria-hidden />
      {state === "idle" ? `📞 ${label}` : state === "connecting" ? "Connecting…" : speaking ? "Gaffer speaking…" : "End call"}
    </button>
  );
}
