"use client";

import { useEffect, useRef, useState } from "react";
import { useGafferSession } from "@/components/gaffer/GafferSession";

/**
 * The end-call panel.
 *
 * It used to carry its own floating pill, which sat at bottom-5 right-5 —
 * exactly on top of the chat launcher. Two round buttons in one corner, one of
 * which only exists during a call, is a worse answer than making the launcher
 * itself say "you're on a call". So the launcher is now the call indicator (see
 * BotBubble) and this is only the panel that opens above it.
 *
 * It opens on its own for three seconds once Gaffer finishes its first
 * question, because hanging up is the one thing a first-time caller has no way
 * to guess, and the moment they've just been asked something is the moment
 * they're looking at the screen.
 */
function clock(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Must outlast the fade-out in globals.css, or the panel vanishes mid-fade. */
const EXIT_MS = 420;

export function GafferDock() {
  const { state, speaking, secs, end, dockOpen, setDockOpen } = useGafferSession();
  const ref = useRef<HTMLDivElement>(null);

  const live = state === "live";
  const connecting = state === "connecting";
  const shown = live || connecting;

  /**
   * Stay mounted through the fade-out.
   *
   * The panel shows itself and then hides itself a few seconds later, so an
   * instant unmount is very visible — it blinks out of existence mid-call. This
   * keeps it in the tree until the exit animation has finished.
   */
  const [rendered, setRendered] = useState(dockOpen);
  const visible = dockOpen && shown;
  useEffect(() => {
    if (visible) {
      setRendered(true);
      return;
    }
    const t = setTimeout(() => setRendered(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [visible]);

  // Click-away and Escape — a floating panel that traps the page is worse than
  // no panel at all.
  useEffect(() => {
    if (!dockOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setDockOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDockOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [dockOpen, setDockOpen]);

  if (!rendered) return null;

  return (
    <div
      ref={ref}
      // sits directly above the launcher, which is h-14 at bottom-5
      className="gaffer-dock gd-menu fixed bottom-24 right-5 z-[60] w-56 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/95 text-white shadow-2xl backdrop-blur"
      data-speaking={live && speaking ? "true" : "false"}
      data-visible={visible ? "true" : "false"}
      aria-hidden={!visible}
      role="dialog"
      aria-label="Call with Gaffer"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="gd-pulse h-2 w-2 rounded-full bg-rose-400" aria-hidden />
        <span className="text-sm font-semibold">
          {connecting ? "Connecting" : speaking ? "Gaffer speaking" : "Listening"}
        </span>
        <span className="ml-auto tabular-nums text-xs text-white/60">{clock(secs)}</span>
      </div>
      <p className="px-4 py-2 text-xs leading-relaxed text-white/60">
        Gaffer can show gear and fill your basket while you talk.
      </p>
      <button
        onClick={() => { void end(); }}
        className="flex w-full items-center gap-2 border-t border-white/10 px-4 py-3 text-left text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M3 9a13 13 0 0 1 18 0v3.5l-4.5-1V9a9 9 0 0 0-9 0v2.5L3 12.5Z" />
        </svg>
        End call
      </button>
    </div>
  );
}
