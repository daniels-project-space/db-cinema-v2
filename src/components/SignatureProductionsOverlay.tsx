"use client";

import { useEffect, useRef, useState } from "react";
import { IconArrowRight, IconX } from "@/components/icons";
import { FormSevenCarousel } from "@/components/FormSevenCarousel";

const FORM_SEVEN_URL = process.env.NEXT_PUBLIC_FORM_SEVEN_URL || "https://form-seven-studio.rrxbrxtrqb.chatgpt.site";
const FORM_SEVEN_SAMPLE_URL = `${FORM_SEVEN_URL.replace(/\/$/, "")}/?samplePlan=Free%20six-second%20sample#free-video`;

const FORM_SEVEN_POINTS = [
  ["01", "Creative direction", "A clear world before the first frame."],
  ["02", "AI-native ad films", "Cinematic motion, made with intent."],
  ["03", "Formats & social", "A system for every screen and scroll."],
] as const;

type Phase = "closed" | "opening" | "open" | "closing";

/** The rotating header coin remains untouched; this is only its partner overlay. */
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

  if (phase === "closed") return null;

  const shown = phase === "open";
  const openPartner = () => window.open(FORM_SEVEN_URL, "_blank", "noopener,noreferrer");
  const openSampleBrief = () => window.open(FORM_SEVEN_SAMPLE_URL, "_blank", "noopener,noreferrer");

  return (
    <div className="fixed inset-0 z-[130]" role="dialog" aria-modal="true" aria-label="FORM / SEVEN creative studio" aria-describedby="form-seven-overlay-description">
      <div onClick={onClose} className={`absolute inset-0 bg-[#02070b]/66 backdrop-blur-xl transition-opacity duration-500 ${shown ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
      <div className="fs-overlay-light fs-overlay-light-one" aria-hidden="true" />
      <div className="fs-overlay-light fs-overlay-light-two" aria-hidden="true" />

      <div className={`fs-overlay-panel absolute left-1/2 top-1/2 flex max-h-[89svh] w-[min(920px,94vw)] -translate-x-1/2 flex-col overflow-y-auto rounded-[26px] border border-white/[0.13] px-5 py-4 shadow-[0_34px_110px_rgba(0,0,0,0.52)] transition-[opacity,transform] duration-500 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] sm:px-7 sm:py-5 ${shown ? "-translate-y-1/2 scale-100 opacity-100" : "-translate-y-[47%] scale-[0.975] opacity-0"}`}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden="true">
          <rect x="0.45" y="0.45" width="99.1" height="99.1" rx="3" fill="none" stroke="rgba(105, 190, 255, 0.72)" strokeWidth="0.19" pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: shown ? 0 : 1, transition: "stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1)", transitionDelay: "100ms" }} />
        </svg>

        <header className="relative z-10 flex min-h-[82px] justify-center">
          <div className="fs-collab-lockup">
            <div className="fs-collab-cards">
              <div className="fs-collab-card fs-collab-card-db"><img src="/brand/collab/db-cinema-aperture.png" alt="DB Cinema aperture mark" /></div>
              <div className="fs-collab-card fs-collab-card-seven"><img src="/brand/form-seven-mark.png" alt="FORM / SEVEN mark" /></div>
            </div>
            <p>DB CINEMA × FORM / SEVEN</p>
            <span>Creative collaboration</span>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="fs-close-button absolute right-0 top-0" aria-label="Close FORM / SEVEN overlay"><IconX className="h-4 w-4" /></button>
        </header>

        <div className="relative z-10 mt-3 text-center">
          <h2 className="font-display text-[clamp(2rem,5vw,3.8rem)] font-bold leading-[0.9] tracking-[-0.06em] text-white">FORM / SEVEN</h2>
          <p id="form-seven-overlay-description" className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/55">Original ad worlds, made to move.</p>
        </div>

        <ul className="fs-offer-points relative z-10" aria-label="What FORM / SEVEN does">
          {FORM_SEVEN_POINTS.map(([number, title, detail]) => (
            <li key={number}><span>{number}</span><div><strong>{title}</strong><small>{detail}</small></div></li>
          ))}
        </ul>

        <div className="relative z-10 mt-4"><FormSevenCarousel /></div>

        <footer className="relative z-10 mt-4">
          <div className="mb-3 flex items-center justify-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-white/42"><span className="fs-live-pip" aria-hidden="true" /> Film / format / follow-through</div>
          <div className="fs-cta-row">
            <button type="button" onClick={openPartner} className="fs-visit-button">Visit FORM / SEVEN <IconArrowRight className="h-4 w-4" /></button>
            <button type="button" onClick={openSampleBrief} className="fs-sample-button"><span className="fs-sample-thumb" aria-hidden="true" /><span><b className="fs-sample-full">Free 21:9 ad sample</b><b className="fs-sample-compact">21:9 sample</b><small>Brief it on Form Seven</small></span><IconArrowRight className="h-4 w-4 shrink-0" /></button>
          </div>
        </footer>
      </div>
    </div>
  );
}
