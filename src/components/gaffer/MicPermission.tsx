"use client";

import { useEffect, useRef, useState } from "react";
import { useGafferSession } from "@/components/gaffer/GafferSession";

/**
 * Our own panel in front of the browser's microphone prompt.
 *
 * The prompt itself is Chrome's and cannot be restyled — that's deliberate on
 * the browser's part, and no site can change it. What it can't do is explain
 * itself, and an unexplained mic request on a camera-hire site is the kind of
 * thing people refuse on reflex. A refusal is close to permanent: Chrome won't
 * ask again, and every later call fails with nothing on screen to say why.
 *
 * So: say what the mic is for, put the real prompt behind a button, and when
 * someone has already refused, show them where the switch is instead of
 * failing silently.
 */

const EXIT_MS = 320;

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="h-6 w-6">
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
    </svg>
  );
}

export function MicPermission() {
  const { micPrompt, allowMic, dismissMicPrompt } = useGafferSession();
  const [busy, setBusy] = useState(false);
  const [rendered, setRendered] = useState(false);
  const allowRef = useRef<HTMLButtonElement>(null);

  const visible = micPrompt !== null;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      setBusy(false);
      return;
    }
    const t = setTimeout(() => setRendered(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [visible]);

  // Escape closes, and focus lands on the action — this is a modal over the page.
  useEffect(() => {
    if (!visible) return;
    allowRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismissMicPrompt(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, dismissMicPrompt]);

  if (!rendered || !micPrompt) return null;

  const denied = micPrompt.status === "denied";
  const errored = micPrompt.status === "error";

  return (
    <div
      className="mic-ask fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center"
      data-visible={visible ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mic-ask-title"
    >
      <button
        className="mic-ask-scrim absolute inset-0 cursor-default"
        onClick={dismissMicPrompt}
        aria-label="Cancel"
        tabIndex={-1}
      />

      <div className="mic-ask-card relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-charcoal-900/95 p-6 text-center shadow-2xl backdrop-blur-xl">
        <span
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
            denied || errored ? "bg-rose-500/15 text-rose-300" : "bg-accent-500/15 text-accent-300"
          }`}
          aria-hidden
        >
          <MicIcon />
        </span>

        <h2 id="mic-ask-title" className="mt-4 font-display text-lg font-bold text-white/90">
          {denied ? "Microphone is blocked" : errored ? "No microphone found" : "Gaffer needs your mic"}
        </h2>

        <p className="mt-2 text-sm leading-relaxed text-white/55">
          {denied ? (
            <>
              Your browser is blocking the mic for this site. Click the icon at the left of the
              address bar, set Microphone to <b className="text-white/80">Allow</b>, then start the
              call again.
            </>
          ) : errored ? (
            <>We couldn&apos;t find a microphone on this device. Plug one in, or use the chat instead.</>
          ) : (
            <>
              It&apos;s a real conversation — Gaffer listens and talks back, and can pull gear up on
              screen while you speak. Nothing is recorded when the call ends.
            </>
          )}
        </p>

        {!denied && !errored && (
          <button
            ref={allowRef}
            onClick={async () => { setBusy(true); await allowMic(); setBusy(false); }}
            disabled={busy}
            className="btn-primary mt-5 w-full px-6 py-3 text-sm disabled:opacity-60"
          >
            {busy ? "Waiting for your browser…" : "Allow microphone"}
          </button>
        )}

        <button
          onClick={dismissMicPrompt}
          className="mt-2 w-full rounded-full px-6 py-2.5 text-xs font-medium text-white/45 transition hover:text-white/80"
        >
          {denied || errored ? "Close" : "Not now"}
        </button>

        {!denied && !errored && (
          <p className="mt-3 text-[11px] leading-relaxed text-white/30">
            Your browser will ask next — that prompt is Chrome&apos;s, not ours.
          </p>
        )}
      </div>
    </div>
  );
}
