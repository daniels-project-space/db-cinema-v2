"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { useGafferTools } from "@/components/gaffer/useGafferTools";

/**
 * Owns the live Gaffer voice session, above the page tree.
 *
 * It used to live inside the button. That was fine while Gaffer could only
 * talk — but now it can navigate, and a route change unmounts whichever button
 * started the call, whose cleanup ends the session. Gaffer would hang up on
 * itself the moment it showed you something. Held here (in the root layout) the
 * call survives navigation, and any number of buttons can drive the same call.
 */

export type CallState = "idle" | "connecting" | "live";

type Ctx = {
  state: CallState;
  speaking: boolean;
  secs: number;
  /** Last failure, so the UI can say why instead of silently resetting. */
  error: string | null;
  toggle: () => void;
  end: () => void;
};

const AGENT_ID = "agent_4601kvk2pfznfrws6ah700jnxvfv";
const GafferCtx = createContext<Ctx | null>(null);

export function GafferSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CallState>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const conv = useRef<any>(null);
  const { clientTools, dynamicVariables } = useGafferTools();

  // Keep the tools fresh without restarting the call: the basket and page
  // change mid-conversation, and the SDK captured whatever we passed at start.
  const toolsRef = useRef(clientTools);
  useEffect(() => { toolsRef.current = clientTools; }, [clientTools]);

  const live = state === "live";
  useEffect(() => {
    if (!live) { setSecs(0); return; }
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [live]);

  const end = useCallback(async () => {
    try { await conv.current?.endSession?.(); } catch { /* already gone */ }
    conv.current = null;
    setState("idle");
    setSpeaking(false);
  }, []);

  const toggle = useCallback(async () => {
    if (state === "live" || state === "connecting") { void end(); return; }
    setState("connecting");
    setError(null);
    try {
      const { Conversation } = await import("@elevenlabs/client");
      await navigator.mediaDevices.getUserMedia({ audio: true });
      // Proxy every tool through the ref so mid-call basket changes are visible.
      const tools = Object.fromEntries(
        Object.keys(toolsRef.current).map((k) => [
          k,
          (args: any) => (toolsRef.current as any)[k](args),
        ]),
      );
      conv.current = await Conversation.startSession({
        agentId: AGENT_ID,
        clientTools: tools,
        dynamicVariables,
        onConnect: () => setState("live"),
        onDisconnect: () => { setState("idle"); setSpeaking(false); conv.current = null; },
        onError: (err: unknown) => {
          console.error("[Gaffer] session error", err);
          setError("The call dropped — try again?");
          setState("idle"); setSpeaking(false); conv.current = null;
        },
        onModeChange: (m: any) => setSpeaking(m?.mode === "speaking"),
      });
    } catch (err: any) {
      // Never swallow: a blocked mic, a denied prompt and an SDK fault all land
      // here and otherwise look identical to a dead button.
      console.error("[Gaffer] failed to start session", err);
      const name = String(err?.name ?? "");
      setError(
        name === "NotAllowedError"
          ? "Microphone blocked — allow mic access to talk to Gaffer."
          : name === "NotFoundError"
            ? "No microphone found on this device."
            : "Couldn't start the call — please try again.",
      );
      setState("idle");
      conv.current = null;
    }
  }, [state, end, dynamicVariables]);

  // Belt and braces: don't leave a session running if the whole app unmounts.
  useEffect(() => () => { void conv.current?.endSession?.().catch?.(() => {}); }, []);

  const value = useMemo(
    () => ({ state, speaking, secs, error, toggle, end }),
    [state, speaking, secs, error, toggle, end],
  );
  return <GafferCtx.Provider value={value}>{children}</GafferCtx.Provider>;
}

export function useGafferSession() {
  const c = useContext(GafferCtx);
  if (!c) throw new Error("useGafferSession must be used inside GafferSessionProvider");
  return c;
}
