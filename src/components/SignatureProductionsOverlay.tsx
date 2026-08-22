"use client";

import { useEffect, useRef, useState } from "react";
import { IconArrowRight, IconX } from "@/components/icons";
import { FormSevenCarousel } from "@/components/FormSevenCarousel";

// The FORM / SEVEN site, on its own Cloudflare custom domain (the worker
// media-engine-showcase serves form7.net and www.form7.net). This replaces the
// temporary *.chatgpt.site preview host the overlay shipped against; that host
// still answers, so nothing broke visibly and the stale link could sit here
// unnoticed. Verified this domain carries the samplePlan query through.
const FORM_SEVEN_URL = "https://form7.net";
const FORM_SEVEN_SAMPLE_URL = `${FORM_SEVEN_URL.replace(/\/$/, "")}/?samplePlan=Free%20six-second%20sample`;

/**
 * Three of them, because the grid is a hand-tuned three across with per-card
 * radii — a fourth orphans onto its own row.
 *
 * Each now carries something checkable: the real entry price, the free sample,
 * and the monthly social option. The previous set led with "Ads from £20" when
 * the cheapest ad is £29, then followed it with two lines — "one idea,
 * composed for every format" and "distinctive worlds from a simple brief" —
 * that any agency could say about anything.
 */
const FORM_SEVEN_POINTS = [
  ["Ads from £29", "One ready-to-post film, cut for every aspect ratio you need."],
  ["Free sample first", "A six-second cut of your product before you spend a penny."],
  ["Social managed too", "Optional £500/month — calendar, captions, publishing, replies."],
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
  return (
    <div className="fixed inset-0 z-[130]" role="dialog" aria-modal="true" aria-label="FORM / SEVEN creative studio" aria-describedby="form-seven-overlay-description">
      <div onClick={onClose} className={`absolute inset-0 bg-[#02070b]/66 backdrop-blur-xl transition-opacity duration-500 ${shown ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
      <div className="fs-overlay-atmosphere" aria-hidden="true" />
      <div className="fs-overlay-light fs-overlay-light-one" aria-hidden="true" />
      <div className="fs-overlay-light fs-overlay-light-two" aria-hidden="true" />

      <div className={`fs-overlay-panel absolute left-1/2 top-1/2 flex w-[min(820px,94vw)] -translate-x-1/2 flex-col rounded-[22px] border px-5 py-4 transition-[opacity,transform] duration-500 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] sm:px-7 sm:py-5 ${shown ? "-translate-y-1/2 scale-100 opacity-100" : "-translate-y-[47%] scale-[0.975] opacity-0"}`}>
        <header className="relative z-10 flex min-h-[66px] justify-center">
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

        <div className="fs-overlay-intro relative z-10 text-center">
          <h2 className="font-display text-[clamp(1.85rem,4.2vw,3.25rem)] font-bold leading-[0.9] tracking-[-0.06em] text-white">Ads that move.</h2>
          <p id="form-seven-overlay-description" className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/55">FORM / SEVEN makes cinematic, AI-native advertising.</p>
        </div>

        <ul className="fs-offer-points relative z-10" aria-label="What FORM / SEVEN does">
          {FORM_SEVEN_POINTS.map(([title, detail]) => (
            <li key={title}><span aria-hidden="true" /><div><strong>{title}</strong><small>{detail}</small></div></li>
          ))}
        </ul>

        <div className="fs-carousel-wrap relative z-10"><FormSevenCarousel /></div>

        <footer className="relative z-10">
          <div className="fs-cta-row">
            <a href={FORM_SEVEN_URL} target="_blank" rel="noreferrer" className="fs-visit-button"><span className="fs-explore-copy"><small>FORM / SEVEN</small><b>EXPLORE</b></span><IconArrowRight className="h-4 w-4" /></a>
            <a href={FORM_SEVEN_SAMPLE_URL} target="_blank" rel="noreferrer" className="fs-sample-button"><span className="fs-sample-copy"><small>GET A FREE</small><b>CUSTOM AD SAMPLE</b></span><IconArrowRight className="h-4 w-4 shrink-0" /></a>
          </div>
        </footer>
      </div>
    </div>
  );
}
