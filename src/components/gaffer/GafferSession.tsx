"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useGafferTools } from "@/components/gaffer/useGafferTools";
import { isSignOff, pageBrief } from "@/components/gaffer/callContext";
import { createHintController } from "@/components/gaffer/hintTiming";
import { micState, requestMic } from "@/components/gaffer/micPermission";

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
  /**
   * Whether the end-call panel is showing.
   *
   * Lives here rather than in either component because two of them drive it:
   * the chat launcher opens it on click, and the provider opens it by itself
   * once — three seconds after Gaffer's first question — so a first-time caller
   * is shown how to hang up instead of having to work it out.
   */
  dockOpen: boolean;
  setDockOpen: (open: boolean) => void;
  /** Set while our own mic explainer is up. Null the rest of the time. */
  micPrompt: MicPrompt;
  /** Fires the real browser prompt, then starts the call if it's allowed. */
  allowMic: () => Promise<void>;
  dismissMicPrompt: () => void;
};

export type MicPrompt = { status: "ask" | "denied" | "error"; topic?: string } | null;

/** How long the "here's how to hang up" hint stays up on its own. */
const HINT_MS = 3_000;

/**
 * Which agent takes the call.
 *
 * Support and sales are genuinely different jobs — one is walking someone
 * through balancing a gimbal, the other is closing a booking — and the cleanest
 * way to give them different openings and different instructions is a second
 * ElevenLabs agent, configured for support in the dashboard. Point
 * NEXT_PUBLIC_GAFFER_SUPPORT_AGENT_ID at one and calls from the guides and the
 * FAQ route to it automatically. Without it everything falls back to the single
 * agent, which is the behaviour we already had.
 */
const SALES_AGENT_ID =
  process.env.NEXT_PUBLIC_GAFFER_AGENT_ID || "agent_4601kvk2pfznfrws6ah700jnxvfv";
const SUPPORT_AGENT_ID = process.env.NEXT_PUBLIC_GAFFER_SUPPORT_AGENT_ID || SALES_AGENT_ID;

/**
 * Remember, across page loads, that this agent refuses firstMessage overrides.
 *
 * Probing costs a whole connect-reject-reconnect cycle, and doing that on every
 * call is exactly the delay it introduced. Probe once, remember the answer for a
 * day, so enabling the setting still takes effect on its own without making
 * every caller wait in the meantime.
 */
// v2: bumped when first_message overrides were enabled on the agent, so
// browsers holding a cached "blocked" answer re-probe immediately instead of
// waiting out the day-long TTL and getting the generic greeting until then.
const OVERRIDE_MEMO_KEY = "dbc_gaffer_overrides_blocked_at_v2";
const OVERRIDE_RECHECK_MS = 24 * 60 * 60 * 1000;

function overridesRecentlyBlocked(): boolean {
  try {
    const at = Number(localStorage.getItem(OVERRIDE_MEMO_KEY) ?? 0);
    return at > 0 && Date.now() - at < OVERRIDE_RECHECK_MS;
  } catch {
    return false;
  }
}

function rememberOverridesBlocked() {
  try {
    localStorage.setItem(OVERRIDE_MEMO_KEY, String(Date.now()));
  } catch {
    /* private mode — we just probe again next time */
  }
}

/** Hang up after this much dead air from the caller. Time the agent spends
 *  talking doesn't count — only silence where a reply was expected. */
const SILENCE_MS = 20_000;
/**
 * Backstop only. After a sign-off we wait for Gaffer to stop speaking rather
 * than counting seconds — a fixed window clipped any goodbye that ran long.
 * This just catches a goodbye that never comes.
 */
const FAREWELL_MAX_MS = 14_000;
/** Beat after the last word, so the audio tail isn't chopped. */
const GOODBYE_TAIL_MS = 900;
/**
 * Rope before the caller has said anything at all.
 *
 * They may still be listening to the greeting, reading the page, or have been
 * held up by the browser's microphone prompt. Treating that as "gone quiet"
 * hung up on people who had not yet had a turn.
 */
const OPENING_SILENCE_MS = 60_000;
/**
 * A call that dies inside this window, with an override set and nobody having
 * hung up, is the agent refusing the override rather than a real disconnect.
 */
const OVERRIDE_PROBE_MS = 5_000;

/**
 * Whether this agent accepts a firstMessage override, learned at runtime.
 *
 * Module scope so it survives re-renders and is shared by every call button on
 * the page: once we know overrides are off, later calls skip straight to the
 * plain start instead of flickering through a rejected attempt each time.
 */
let overridesAllowed: boolean | null = null;
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
  // Date.now(), never 0 — a zero here reads as "silent since 1970", which fired
  // the dead-air watchdog on the very first tick of a brand-new call.
  const lastActivity = useRef(Date.now());
  /** Has the caller taken a turn yet? Until they have, dead air isn't dead air. */
  const hasSpoken = useRef(false);
  const agentTalking = useRef(false);
  /**
   * How many client tools are mid-flight.
   *
   * A tool call is the one stretch of a call where nobody is speaking and yet
   * nothing is wrong: the caller has asked for something and is waiting for it.
   * The watchdog only knew about `agentTalking`, which covers speech and not
   * work, so a multi-item request — which fans out into a chain of lookups —
   * looked exactly like a caller who had walked away.
   */
  const toolsInFlight = useRef(0);
  /** The caller has spoken and is still waiting for a reply. Their silence is earned. */
  const awaitingAgent = useRef(false);
  const signingOff = useRef(false);
  const farewell = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped per connection attempt; stale sessions' callbacks check it and bail. */
  const generation = useRef(0);
  /** True when we hung up on purpose, so a retry isn't mistaken for a rejection. */
  const endedDeliberately = useRef(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [micPrompt, setMicPrompt] = useState<MicPrompt>(null);
  /** Only gate on the mic once per page — after that the browser has an answer. */
  const micAsked = useRef(false);
  /** Shows the hang-up panel once per call, in the first gap. See hintTiming. */
  const hint = useRef(
    createHintController({
      show: () => setDockOpen(true),
      hide: () => setDockOpen(false),
      ms: HINT_MS,
    }),
  );

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
    // Mark before tearing down: the disconnect this causes must not be read as
    // the agent rejecting an override and trigger a reconnect.
    endedDeliberately.current = true;
    generation.current++;
    hint.current.reset();
    setDockOpen(false);
    hasSpoken.current = false;
    lastActivity.current = Date.now();
    signingOff.current = false;
    agentTalking.current = false;
    awaitingAgent.current = false;
    toolsInFlight.current = 0;
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
      /**
       * None of this is the caller going quiet:
       *   - Gaffer is mid-sentence
       *   - a lookup is running because they asked for something
       *   - they've spoken and Gaffer hasn't answered yet
       * The last one matters most. A three-item request fans out into a chain
       * of lookups, each needing its own model round-trip, and the caller sits
       * through all of it in silence — thirty-six seconds of it in the call
       * that prompted this. Hanging up there punishes them for the agent's
       * latency. Dead air is only dead air once Gaffer has had its say.
       */
      if (agentTalking.current || signingOff.current || toolsInFlight.current > 0 || awaitingAgent.current) {
        lastActivity.current = Date.now();
        return;
      }
      /**
       * Nobody has spoken yet.
       *
       * Before the first user turn there is no "gone quiet" to detect — they
       * are listening to the greeting, or reading the page, or were held up by
       * the microphone prompt. Firing here told a caller who had said nothing
       * that they had gone quiet, and worse, latched signingOff for the rest of
       * the call. They get a much longer rope until they have spoken once.
       */
      const grace = hasSpoken.current ? SILENCE_MS : OPENING_SILENCE_MS;
      if (Date.now() - lastActivity.current < grace) return;
      // Out of patience — but let Gaffer land the sentence it's on. Marking it
      // as signing off routes the hang-up through the same
      // wait-for-the-last-word path a spoken goodbye uses, instead of cutting
      // mid-word.
      signingOff.current = true;
      try {
        conv.current?.sendContextualUpdate?.(
          "[Context] The caller has gone quiet and hasn't answered. Finish your sentence, say a " +
            "brief goodbye, and stop.",
        );
      } catch { /* non-fatal */ }
      if (farewell.current) clearTimeout(farewell.current);
      farewell.current = setTimeout(() => void end(), FAREWELL_MAX_MS);
    }, 1000);
    return () => clearInterval(id);
  }, [state, end]);

  const toggle = useCallback(async (topic?: string) => {
    if (state === "live" || state === "connecting") { void end(); return; }

    // Explain before the browser asks. An unexplained mic prompt on a rental
    // site is the kind of thing people refuse on reflex, and a refusal is
    // sticky — Chrome won't ask twice.
    if (!micAsked.current) {
      const perm = await micState();
      if (perm !== "granted") {
        micAsked.current = true;
        setMicPrompt({ status: perm === "denied" ? "denied" : "ask", topic });
        return;
      }
    }

    setState("connecting");
    setError(null);
    signingOff.current = false;
    hasSpoken.current = false;
    awaitingAgent.current = false;
    toolsInFlight.current = 0;
    lastActivity.current = Date.now();
    const { intent, mode, brief, opening } = pageBrief(pathname ?? "/", topic);
    const agentId = mode === "support" ? SUPPORT_AGENT_ID : SALES_AGENT_ID;

    let Conversation: any;
    try {
      ({ Conversation } = await import("@elevenlabs/client"));
      await navigator.mediaDevices.getUserMedia({ audio: true });
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
      return;
    }

    /**
     * One attempt. `withOverrides` is retried without on an instant drop.
     *
     * Every callback checks it still belongs to the current attempt: a rejected
     * session's `onDisconnect` arrives *after* the retry has already connected,
     * and without this guard it sets the UI back to idle and nulls `conv`,
     * orphaning a live call. That is what made the call appear to hang up the
     * moment it started.
     */
    const start = async (withOverrides: boolean): Promise<void> => {
      const myGen = ++generation.current;
      const mine = () => generation.current === myGen;
      const startedAt = Date.now();
      endedDeliberately.current = false;

      // Proxy every tool through the ref so mid-call basket changes are visible.
      const tools = Object.fromEntries(
        Object.keys(toolsRef.current).map((k) => [
          k,
          async (args: any) => {
            // Work counts as activity, at both ends: the caller is owed the
            // full silence window from when the answer lands, not from before
            // they asked for it.
            toolsInFlight.current += 1;
            lastActivity.current = Date.now();
            try {
              return await (toolsRef.current as any)[k](args);
            } finally {
              toolsInFlight.current = Math.max(0, toolsInFlight.current - 1);
              lastActivity.current = Date.now();
            }
          },
        ]),
      );
      const cfg: any = {
        agentId,
        clientTools: tools,
        dynamicVariables: {
          ...dynamicVariables,
          call_intent: intent,
          call_mode: mode,
          // Third route to a page-specific greeting, and the one that needs no
          // special permission: put {{opening_line}} in the agent's First
          // Message field and this fills it in. Harmless if unused.
          opening_line: opening,
        },
        onConnect: () => {
          if (!mine()) return;
          setState("live");
          lastActivity.current = Date.now();
          // Connecting proves nothing — a refused override connects first and is
          // closed a moment later. Only a call still alive past the probe window
          // tells us overrides are genuinely on.
          if (withOverrides) {
            setTimeout(() => {
              if (!mine()) return;
              overridesAllowed = true;
              try { localStorage.removeItem(OVERRIDE_MEMO_KEY); } catch { /* fine */ }
            }, OVERRIDE_PROBE_MS + 500);
          }
          // The brief is sent just after startSession resolves — see below for
          // why it cannot be sent from here.
        },
        onDisconnect: () => {
          if (!mine()) return;
          // An override the agent doesn't allow is not a thrown error: ElevenLabs
          // accepts the socket, then closes the conversation. startSession has
          // already resolved by then, so the only place this is visible is an
          // instant disconnect the customer didn't ask for.
          if (withOverrides && !endedDeliberately.current && Date.now() - startedAt < OVERRIDE_PROBE_MS) {
            overridesAllowed = false;
            rememberOverridesBlocked();
            console.warn(
              "[Gaffer] the call dropped immediately with a firstMessage override — enable " +
                "overrides for 'first message' in the agent's security settings to get " +
                "page-specific greetings. Reconnecting without it.",
            );
            void start(false);
            return;
          }
          setState("idle");
          setSpeaking(false);
          conv.current = null;
        },
        onMessage: ({ message, source }: { message: string; source: "user" | "ai" }) => {
          if (!mine()) return;
          // Gaffer has answered, so the caller owns the silence again from here.
          if (source === "ai") {
            awaitingAgent.current = false;
            lastActivity.current = Date.now();
            return;
          }
          // Only the *caller* speaking counts as activity. Resetting on Gaffer's
          // own messages meant a chatty agent kept the dead-air timer alive
          // forever, so a caller who walked away was never hung up on.
          if (source !== "user") return;
          lastActivity.current = Date.now();
          hasSpoken.current = true;
          // They've asked for something; the clock is on Gaffer until it replies.
          awaitingAgent.current = true;

          /**
           * They're back. Cancel any wind-down in progress.
           *
           * Without this a sign-off — real or, worse, one the dead-air watchdog
           * decided on its own — was permanent: this handler returned early on
           * signingOff and never cleared it, so the next time the agent stopped
           * speaking the farewell timer hung up on a caller who was mid-order.
           */
          if (signingOff.current) {
            signingOff.current = false;
            if (farewell.current) { clearTimeout(farewell.current); farewell.current = null; }
          }
          if (!isSignOff(message)) return;
          // Let Gaffer say goodbye properly rather than cutting it dead.
          signingOff.current = true;
          try {
            conv.current?.sendContextualUpdate?.(
              "[Context] The caller has signalled they're finished. Say one short, warm goodbye " +
                "and stop — do not ask another question or offer anything else.",
            );
          } catch { /* non-fatal */ }
          // Don't hang up on a timer — that cut Gaffer off mid-goodbye whenever
          // the farewell ran past the window. Wait for it to actually stop
          // speaking (see onModeChange); this is only the backstop for a
          // goodbye that never arrives.
          farewell.current = setTimeout(() => void end(), FAREWELL_MAX_MS);
        },
        onError: (err: unknown) => {
          if (!mine()) return;
          console.error("[Gaffer] session error", err);
          setError("The call dropped — try again?");
          setState("idle"); setSpeaking(false); conv.current = null;
        },
        onModeChange: (m: any) => {
          if (!mine()) return;
          const talking = m?.mode === "speaking";

          // Signing off: hang up when the goodbye is actually finished, not on a
          // fixed timer. A short beat after the last word so the audio tail
          // isn't clipped.
          if (signingOff.current && agentTalking.current && !talking) {
            if (farewell.current) clearTimeout(farewell.current);
            farewell.current = setTimeout(() => void end(), GOODBYE_TAIL_MS);
          }

          // Gaffer has just finished its opening question — the first natural
          // gap in the call, and the moment to show how to hang up.
          hint.current.noteTalking(talking);
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
        const session = withOverrides
          ? await Conversation.startSession({ ...cfg, overrides: { agent: { firstMessage: opening } } })
          : await Conversation.startSession(cfg);

        // Hung up while this was still connecting.
        //
        // `end()` can only close what it can see, and until this line there is
        // nothing in `conv.current` to close — so a quick cancel left a fully
        // live session with a hot mic that the UI showed as idle and no button
        // could reach. Close it here instead of adopting it.
        if (!mine()) {
          try { await session.endSession(); } catch { /* already gone */ }
          return;
        }
        conv.current = session;

        // Send the page brief now, not in onConnect: that fires *inside*
        // startSession, before this assignment, so `conv.current` was still
        // null there and the update went nowhere.
        try { session.sendContextualUpdate?.(brief); } catch { /* non-fatal */ }
      } catch (err: any) {
        if (!mine()) return;
        // Some rejections do throw. Same fallback, so either shape recovers.
        if (withOverrides) {
          overridesAllowed = false;
          console.warn("[Gaffer] firstMessage override rejected outright — retrying without it.", err);
          void start(false);
          return;
        }
        console.error("[Gaffer] failed to start session", err);
        setError("Couldn't start the call — please try again.");
        setState("idle");
        conv.current = null;
      }
    };

    // Skip the doomed first attempt once we've learned overrides are off — in
    // this session, or on a previous visit. Probing every call is what made
    // connecting slow.
    if (overridesAllowed === null && overridesRecentlyBlocked()) overridesAllowed = false;
    await start(overridesAllowed !== false);
  }, [state, end, dynamicVariables, pathname]);

  // Belt and braces: don't leave a session running if the whole app unmounts.
  useEffect(() => () => {
    if (farewell.current) clearTimeout(farewell.current);
    hint.current.reset();
    void conv.current?.endSession?.().catch?.(() => {});
  }, []);

  /** Triggered from the explainer, so the browser prompt follows a real click. */
  const allowMic = useCallback(async () => {
    const topic = micPrompt?.topic;
    const res = await requestMic();
    if (!res.ok) {
      setMicPrompt({ status: res.reason === "denied" ? "denied" : "error", topic });
      return;
    }
    setMicPrompt(null);
    void toggle(topic);
  }, [micPrompt, toggle]);

  const dismissMicPrompt = useCallback(() => setMicPrompt(null), []);

  const value = useMemo(
    () => ({
      state, speaking, secs, error, toggle, end, dockOpen, setDockOpen,
      micPrompt, allowMic, dismissMicPrompt,
    }),
    [state, speaking, secs, error, toggle, end, dockOpen, micPrompt, allowMic, dismissMicPrompt],
  );
  return <GafferCtx.Provider value={value}>{children}</GafferCtx.Provider>;
}

export function useGafferSession() {
  const c = useContext(GafferCtx);
  if (!c) throw new Error("useGafferSession must be used inside GafferSessionProvider");
  return c;
}
