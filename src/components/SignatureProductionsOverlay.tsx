"use client";

import { useEffect, useRef, useState } from "react";
import { IconArrowRight, IconX } from "@/components/icons";
import { FormSevenCarousel } from "@/components/FormSevenCarousel";

const FORM_SEVEN_URL = process.env.NEXT_PUBLIC_FORM_SEVEN_URL || "https://formseven.com";

type Phase = "closed" | "opening" | "open" | "closing";

function ApertureGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="1" opacity=".45" />
      <path d="m32 8 14.6 24.8L32 56 17.4 32.8 32 8Z" stroke="currentColor" strokeWidth="1" />
      <path d="m10.3 20.2 29.2 6.1L53.7 44 24.5 37.9 10.3 20.2Z" stroke="currentColor" strokeWidth="1" opacity=".7" />
      <circle cx="32" cy="32" r="5.6" fill="currentColor" />
    </svg>
  );
}

function SignalGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <path d="M12 44c6-16 12-24 20-24 8.7 0 13.7 8.6 20 24" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M12 32c6-9.3 12-14 20-14 8.2 0 14.2 4.7 20 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".62" />
      <path d="M16 50h32" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".42" />
      <circle cx="32" cy="32" r="3.5" fill="currentColor" />
    </svg>
  );
}

/**
 * The FORM / SEVEN partner interstitial. It intentionally leaves the header
 * coin alone; that trigger simply opens this cinematic, glassy bridge between
 * DB Cinema's physical production world and FORM / SEVEN's ad work.
 */
export function SignatureProductionsOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("closed");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPhase("opening");
      const raf = requestAnimationFrame(() => setPhase("open"));
      const focus = window.setTimeout(() => closeButtonRef.current?.focus(), 180);
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(focus);
      };
    }

    setPhase((current) => (current === "closed" ? "closed" : "closing"));
    const id = window.setTimeout(() => {
      setPhase("closed");
      previouslyFocusedRef.current?.focus();
    }, 480);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const mounted = phase !== "closed";
  if (!mounted) return null;

  const shown = phase === "open";
  const openPartner = () => window.open(FORM_SEVEN_URL, "_blank", "noopener,noreferrer");

  return (
    <div className="fixed inset-0 z-[130]" role="dialog" aria-modal="true" aria-label="FORM / SEVEN creative studio" aria-describedby="form-seven-overlay-description">
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-[#030604]/70 backdrop-blur-xl transition-opacity duration-500 ${shown ? "opacity-100" : "opacity-0"}`}
        aria-hidden="true"
      />
      <div className="fs-overlay-light fs-overlay-light-one" aria-hidden="true" />
      <div className="fs-overlay-light fs-overlay-light-two" aria-hidden="true" />

      <div
        className={`fs-overlay-panel absolute left-1/2 top-1/2 flex max-h-[94svh] w-[min(1180px,96vw)] -translate-x-1/2 flex-col overflow-y-auto rounded-[30px] border border-white/[0.16] px-5 py-5 shadow-[0_40px_130px_rgba(0,0,0,0.62)] transition-[opacity,transform] duration-500 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] sm:px-7 sm:py-6 ${shown ? "-translate-y-1/2 scale-100 opacity-100" : "-translate-y-[47%] scale-[0.975] opacity-0"}`}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden="true">
          <rect x="0.45" y="0.45" width="99.1" height="99.1" rx="3.2" fill="none" stroke="var(--color-accent-400)" strokeWidth="0.22" strokeOpacity="0.75" pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: shown ? 0 : 1, transition: "stroke-dashoffset 1.35s cubic-bezier(0.16,1,0.3,1)", transitionDelay: "100ms" }} />
        </svg>

        <header className="relative z-10 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="fs-mark-chip"><SignalGlyph className="h-6 w-6" /></div>
            <div>
              <div className="hud-label text-accent-300">DB CINEMA / FORM SEVEN</div>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">A moving-image connection</p>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="fs-close-button" aria-label="Close FORM / SEVEN overlay">
            <IconX className="h-4 w-4" />
          </button>
        </header>

        <div className="relative z-10 mt-8 text-center sm:mt-10">
          <div className="flex items-center justify-center gap-3 text-accent-300">
            <span className="h-px w-8 bg-current/50" />
            <span className="font-mono text-[10px] uppercase tracking-[0.28em]">Creative studio</span>
            <span className="h-px w-8 bg-current/50" />
          </div>
          <h2 className="mt-3 font-display text-[clamp(2.25rem,6vw,5rem)] font-bold leading-[0.86] tracking-[-0.065em] text-white">FORM / SEVEN</h2>
          <p id="form-seven-overlay-description" className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-white/55 sm:text-base">Shot on cinema gear. Made to travel.</p>
        </div>

        <div className="relative z-10 my-6 grid items-center gap-5 lg:my-7 lg:grid-cols-[150px_minmax(0,1fr)_150px]">
          <aside className="fs-signal-note fs-signal-note-left hidden lg:flex">
            <ApertureGlyph className="h-10 w-10 text-accent-300" />
            <span>Lens / light / motion</span>
            <small>DB CINEMA</small>
          </aside>

          <FormSevenCarousel />

          <aside className="fs-signal-note fs-signal-note-right hidden lg:flex">
            <SignalGlyph className="h-10 w-10 text-accent-300" />
            <span>Ideas into signal</span>
            <small>FORM / SEVEN</small>
          </aside>
        </div>

        <footer className="relative z-10 flex flex-col items-center justify-between gap-4 border-t border-white/[0.1] pt-4 sm:flex-row">
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-white/38">
            <span className="fs-live-pip" aria-hidden="true" />
            AI-native campaigns · direction → delivery
          </div>
          <button type="button" onClick={openPartner} className="fs-enter-button">
            Enter the studio <IconArrowRight className="h-4 w-4" />
          </button>
        </footer>
      </div>
    </div>
  );
}
