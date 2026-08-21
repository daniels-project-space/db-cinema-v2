"use client";

import { useEffect, useRef, useState } from "react";
import { useGafferSession } from "@/components/gaffer/GafferSession";

/**
 * Floating call control, shown only while a call is live.
 *
 * Once Gaffer can navigate, the button the customer started from is often
 * somewhere else entirely — a footer button while they're now on a product
 * page. Hanging up must never require hunting for the control that started it,
 * so the call gets a persistent handle: a compact pill that follows the
 * customer, opening into a menu with the timer and a clear way to end.
 */
function clock(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function GafferDock() {
  const { state, speaking, secs, end } = useGafferSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const live = state === "live";
  const connecting = state === "connecting";
  const shown = live || connecting;

  // Collapse the menu when the call ends, so it can't linger over the page.
  useEffect(() => { if (!shown) setOpen(false); }, [shown]);

  // Click-away and Escape — a floating panel that traps the page is worse than
  // no panel at all.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!shown) return null;

  return (
    <div
      ref={ref}
      className="gaffer-dock fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-2"
      data-speaking={live && speaking ? "true" : "false"}
    >
      {open && (
        <div
          role="menu"
          aria-label="Call with Gaffer"
          className="gd-menu w-56 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/95 text-white shadow-2xl backdrop-blur"
        >
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <span className="gd-pulse h-2 w-2 rounded-full bg-rose-400" aria-hidden />
            <span className="text-sm font-semibold">
              {speaking ? "Gaffer speaking" : "Listening"}
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
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close call menu" : "Open call menu"}
        className="gd-pill flex items-center gap-2 rounded-full bg-gradient-to-br from-rose-500 to-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-8px_rgba(244,63,94,0.7)] transition hover:-translate-y-0.5"
      >
        <span className="flex h-4 items-end gap-[2.5px]" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="gd-bar w-[2.5px] rounded-full bg-current" />
          ))}
        </span>
        <span className="tabular-nums">{connecting ? "Connecting…" : clock(secs)}</span>
      </button>
    </div>
  );
}
