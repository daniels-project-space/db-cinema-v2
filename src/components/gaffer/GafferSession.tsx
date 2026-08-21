"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useGafferTools } from "@/components/gaffer/useGafferTools";
import { isSignOff, pageBrief } from "@/components/gaffer/callContext";

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
  /** `topic` names what the caller was looking at, for buttons that know more
   *  than the URL does (a guide's title, a listing's name). */
  toggle: (topic?: string) => void;
  end: () => void;
};

const AGENT_ID = "agent_4601kvk2pfznfrws6ah700jnxvfv";

/** Hang up after this much dead air from the caller. Time the agent spends
 *  talking doesn't count — only silence where a reply was expected. */
const SILENCE_MS = 20_000;
/** Grace after a sign-off, so Gaffer's goodbye actually plays before we cut. */
const FAREWELL_MS = 6_000;
const GafferCtx = createContext<Ctx | null>(null);

export function GafferSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CallState>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const conv = useRef<any>(null);
  const { clientTools, dynamicVariables } = useGafferTools();
  const pathname = usePathname();

  // Auto-hangup bookkeeping. Refs, not state: these are read inside SDK
  // callbacks and a 1s watchdog, none of which should trigger a render.
  const lastActivity = useRef(0);
  const agentTalking = useRef(false);
  const signingOff = useRef(false);
  const farewell = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (farewell.current) { clearTimeout(farewell.current); farewell.current = null; }
    signingOff.current = false;
    agentTalking.current = false;
    try { await conv.current?.endSession?.(); } catch { /* already gone */ }
    conv.current = null;
    setState("idle");
    setSpeaking(false);
  }, []);

  // Dead-air watchdog. Only runs while connected, and only counts silence the
  // caller owns — if Gaffer is mid-sentence, the caller isn't being rude.
  useEffect(() => {
    if (state !== "live") return;
    const id = setInterval(() => {
      if (agentTalking.current || signingOff.current) {
        lastActivity.current = Date.now();
        return;
      }
      if (Date.now() - lastActivity.current >= SILENCE_MS) void end();
    }, 1000);
    return () => clearInterval(id);
  }, [state, end]);

  const toggle = useCallback(async (topic?: string) => {
    if (state === "live" || state === "connecting") { void end(); return; }
    setState("connecting");
    setError(null);
    signingOff.current = false;
    lastActivity.current = Date.now();
    const { intent, brief, opening } = pageBrief(pathname ?? "/", topic);
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
      const cfg: any = {
        agentId: AGENT_ID,
        clientTools: tools,
        dynamicVariables: { ...dynamicVariables, call_intent: intent },
        onConnect: () => {
          setState("live");
          lastActivity.current = Date.now();
          // Tell Gaffer where the call came from before it opens its mouth.
          // A contextual update is injected as context, not spoken, and needs
          // nothing configured on the agent — unlike dynamic variables, which
          // are inert unless the agent prompt interpolates them.
          try { conv.current?.sendContextualUpdate?.(brief); } catch { /* non-fatal */ }
        },
        onDisconnect: () => { setState("idle"); setSpeaking(false); conv.current = null; },
        onMessage: ({ message, source }: { message: string; source: "user" | "ai" }) => {
          lastActivity.current = Date.now();
          if (source !== "user" || signingOff.current) return;
          if (!isSignOff(message)) return;
          // Let Gaffer say goodbye properly rather than cutting it dead.
          signingOff.current = true;
          try {
            conv.current?.sendContextualUpdate?.(
              "[Context] The caller has signalled they're finished. Say one short, warm goodbye " +
                "and stop — do not ask another question or offer anything else.",
            );
          } catch { /* non-fatal */ }
          farewell.current = setTimeout(() => void end(), FAREWELL_MS);
        },
        onError: (err: unknown) => {
          console.error("[Gaffer] session error", err);
          setError("The call dropped — try again?");
          setState("idle"); setSpeaking(false); conv.current = null;
        },
        onModeChange: (m: any) => {
          const talking = m?.mode === "speaking";
          agentTalking.current = talking;
          setSpeaking(talking);
        },
      };

      /**
       * Override only the *first message*, and only that.
       *
       * The agent greets the instant the socket opens, before any contextual
       * update can land — which is why every call used to open with the same
       * line no matter which page it came from. Overriding firstMessage is the
       * only way to make the opening itself page-specific.
       *
       * Deliberately NOT overriding `prompt`: that replaces the agent's whole
       * system prompt, throwing away its persona, catalogue knowledge and tool
       * instructions. The page brief goes in as a contextual update instead,
       * which adds to the prompt rather than replacing it.
       *
       * Overrides have to be allowed in the agent's security settings. If they
       * aren't, ElevenLabs rejects the session — so fall back to a plain start
       * rather than handing the customer a dead button.
       */
      try {
        conv.current = await Conversation.startSession({
          ...cfg,
          overrides: { agent: { firstMessage: opening } },
        });
      } catch (overrideErr) {
        console.warn(
          "[Gaffer] first-message override rejected — enable 'first message' overrides in the " +
            "agent's security settings for page-specific greetings. Falling back.",
          overrideErr,
        );
        conv.current = await Conversation.startSession(cfg);
      }
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
  }, [state, end, dynamicVariables, pathname]);

  // Belt and braces: don't leave a session running if the whole app unmounts.
  useEffect(() => () => {
    if (farewell.current) clearTimeout(farewell.current);
    void conv.current?.endSession?.().catch?.(() => {});
  }, []);

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
