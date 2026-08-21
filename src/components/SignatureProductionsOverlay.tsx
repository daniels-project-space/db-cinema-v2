"use client";

import { useEffect, useState } from "react";
import { IconArrowRight, IconCamera, IconCheck, IconSpark, IconX } from "@/components/icons";

const FORM_SEVEN_URL = process.env.NEXT_PUBLIC_FORM_SEVEN_URL || "";

const BULLETS = [
  "DB Cinema supplies the physical gear — FORM / SEVEN supplies AI-native production.",
  "Single UGC ad, or multi-cut “Momentum” / “Growth” ad packages.",
  "Instagram management retainer for creators and brands.",
  "Original, concept-driven creative direction from idea to edit.",
];

/**
 * Full-screen frosted-glass overlay promoting FORM / SEVEN, Daniel's AI-native
 * video production studio (a cross-link partner site, not a DB Cinema page).
 * Phase-driven like GearTurnOverlay/CheckoutTurnOverlay so the border-trace
 * animation plays once on open rather than looping. Closes on backdrop click,
 * Escape, or the explicit close button.
 */
type Phase = "closed" | "opening" | "open" | "closing";

export function SignatureProductionsOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("closed");

  useEffect(() => {
    if (open) {
      setPhase("opening");
      const raf = requestAnimationFrame(() => setPhase("open"));
      return () => cancelAnimationFrame(raf);
    }
    setPhase((p) => (p === "closed" ? "closed" : "closing"));
    const id = setTimeout(() => setPhase("closed"), 420);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const mounted = phase !== "closed";
  if (!mounted) return null;

  const shown = phase === "open";
  const hasUrl = FORM_SEVEN_URL.length > 0;

  const openPartner = () => {
    if (hasUrl) window.open(FORM_SEVEN_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="fixed inset-0 z-[130]" role="dialog" aria-modal="true" aria-label="Signature Productions — FORM / SEVEN">
      {/* frosted backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity duration-500 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden
      />

      {/* panel */}
      <div
        className={`absolute left-1/2 top-1/2 max-h-[90vh] w-[min(960px,94vw)] -translate-x-1/2 overflow-y-auto rounded-3xl border border-white/10 bg-charcoal-900/90 p-6 shadow-2xl shadow-black/70 backdrop-blur-xl transition-[opacity,transform] duration-500 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] sm:p-8 ${
          shown ? "-translate-y-1/2 scale-100 opacity-100" : "-translate-y-[47%] scale-[0.97] opacity-0"
        }`}
      >
        {/* animated tracing border — same stroke-dashoffset technique as HeroCinematic's callout lines */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden>
          <rect
            x={0.4}
            y={0.4}
            width={99.2}
            height={99.2}
            rx={4}
            fill="none"
            stroke="var(--color-accent-400)"
            strokeWidth={0.35}
            strokeOpacity={0.8}
            pathLength={1}
            strokeDasharray={1}
            style={{
              strokeDashoffset: shown ? 0 : 1,
              transition: "stroke-dashoffset 1.1s cubic-bezier(0.16,1,0.3,1)",
              transitionDelay: "150ms",
            }}
          />
        </svg>

        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Close"
        >
          <IconX className="h-4 w-4" />
        </button>

        <div className="grid gap-8 pt-2 md:grid-cols-[1.25fr_1fr] md:pt-0">
          <div>
            <div className="hud-label mb-3 flex items-center gap-2 text-accent-400">
              <IconSpark className="h-3.5 w-3.5" /> Signature Productions
            </div>
            <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">FORM / SEVEN</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">
              Daniel&apos;s AI-native video production studio and creative partner — where DB Cinema&apos;s
              gear meets end-to-end, AI-enabled production.
            </p>

            <div className="relative mt-6 overflow-hidden rounded-2xl border border-white/10 bg-charcoal-800 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
              <div className="flex items-center gap-1.5 border-b border-white/5 bg-white/[0.03] px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="ml-2 truncate rounded-full bg-white/[0.04] px-3 py-0.5 font-mono text-[10px] text-white/30">
                  {hasUrl ? FORM_SEVEN_URL.replace(/^https?:\/\//, "") : "formseven.studio"}
                </span>
              </div>
              <div className="relative aspect-video w-full bg-charcoal-900">
                {hasUrl ? (
                  <>
                    <iframe
                      src={FORM_SEVEN_URL}
                      className="pointer-events-none h-full w-full"
                      title="FORM / SEVEN preview"
                      tabIndex={-1}
                    />
                    <button
                      onClick={openPartner}
                      className="absolute inset-0 flex items-center justify-center bg-black/0 text-transparent transition-colors hover:bg-black/30 hover:text-white"
                      aria-label="Open FORM / SEVEN in a new tab"
                    >
                      <span className="rounded-full border border-white/20 bg-black/60 px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider backdrop-blur">
                        Open in new tab ↗
                      </span>
                    </button>
                  </>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/25">
                    <IconCamera className="h-6 w-6" />
                    <span className="font-mono text-[11px] uppercase tracking-widest">Preview coming soon</span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 text-xs text-white/40">
              <IconArrowRight className="h-4 w-4 shrink-0 -rotate-90 text-accent-400" />
              Check out our page and partner company
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <ul className="flex flex-col gap-2.5 text-sm text-white/65">
              {BULLETS.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-400" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>

            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent-400/30 bg-accent-400/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-accent-300">
              Mention DBCINEMA10 for 10% off
            </div>

            {hasUrl && (
              <button onClick={openPartner} className="btn-primary w-fit">
                Visit FORM / SEVEN
                <IconArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
