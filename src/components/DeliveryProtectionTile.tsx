"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BadgeShield, BadgeTruck } from "@/components/AnimatedIcons";
import styles from "./DeliveryProtectionTile.module.css";

function DeliverySlide({ protection, outgoing = false, incoming = false }: { protection: boolean; outgoing?: boolean; incoming?: boolean }) {
  return <>
    <Image src={protection ? "/images/home/cancellation-protection-20261103.webp" : "/images/home/london-delivery-20261028.webp"} alt="" fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" className="trust-card-image object-cover transition-transform duration-700 ease-out group-hover:scale-[1.045]" />
    <div className="absolute inset-0 bg-gradient-to-t from-[#070709] via-[#070709]/55 to-black/5" aria-hidden />
    <div className="absolute inset-0 bg-gradient-to-r from-black/25 via-transparent to-transparent" aria-hidden />
    <div data-testid="delivery-slide-copy" className={`absolute inset-0 ${incoming ? styles.copyEntering : outgoing ? styles.copyExiting : ""}`}>
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-1 p-2 min-[360px]:p-3 sm:p-6">
        <span className="inline-flex rounded-full border border-white/20 bg-black/65 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-white/85 shadow-lg backdrop-blur-sm min-[360px]:px-3 min-[360px]:text-[9px] min-[360px]:tracking-[0.17em]">{protection ? "Included free" : "Delivery"}</span>
        <span className={`trust-symbol ci-host shrink-0 rounded-xl border border-accent-300/25 bg-[#160d11]/85 p-1 text-accent-300 min-[360px]:p-1.5 sm:p-2 ${styles.glyph}`} aria-hidden>{protection ? <BadgeShield className="h-5 w-5 min-[360px]:h-6 min-[360px]:w-6 sm:h-8 sm:w-8" /> : <BadgeTruck className="h-5 w-5 min-[360px]:h-6 min-[360px]:w-6 sm:h-8 sm:w-8" />}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-2 min-[360px]:p-3 sm:p-6">
        <h2 className="mt-1 max-w-[17rem] font-display text-[12px] font-semibold leading-tight text-white min-[360px]:text-sm sm:mt-4 sm:text-2xl">{protection ? "Cancellation protection for free" : "Delivered across London"}</h2>
        {protection ? <p className="mt-1 line-clamp-2 max-w-[18rem] text-[9px] leading-[1.25] text-white/75 min-[360px]:text-[10px] sm:mt-2 sm:line-clamp-3 sm:text-sm sm:leading-relaxed">If kit is unavailable before pickup, all accounts can get a full refund. Accounts not rejected or restricted for a terms violation may choose 130% rental credit. <Link className="underline underline-offset-2" href="/legal/cancellation" tabIndex={outgoing ? -1 : undefined}>See terms</Link></p> : <p className="mt-1 line-clamp-2 max-w-[18rem] text-[9px] leading-[1.25] text-white/75 min-[360px]:text-[10px] sm:mt-2 sm:text-sm sm:leading-relaxed">Reliable delivery and collection, straight to your set.</p>}
      </div>
    </div>
  </>;
}

export function DeliveryProtectionTile() {
  const [protection, setProtection] = useState(false);
  const [transition, setTransition] = useState<{ from: boolean; to: boolean; id: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const card = useRef<HTMLElement>(null);
  const activeSlide = useRef(false);
  const transitionId = useRef(0);
  const transitionTimer = useRef<number | undefined>(undefined);

  const transitionTo = useCallback((next: boolean) => {
    if (activeSlide.current === next) return;
    window.clearTimeout(transitionTimer.current);
    const from = activeSlide.current;
    activeSlide.current = next;
    setProtection(next);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTransition(null);
      return;
    }
    const id = ++transitionId.current;
    setTransition({ from, to: next, id });
    transitionTimer.current = window.setTimeout(() => setTransition(current => current?.id === id ? null : current), 2600);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(transitionTimer.current);
  }, []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    const updateTimer = () => {
      window.clearInterval(timer);
      if (!focused && !motion.matches) timer = window.setInterval(() => {
        if (!card.current?.contains(document.activeElement)) transitionTo(!activeSlide.current);
      }, 5000);
    };
    updateTimer();
    motion.addEventListener("change", updateTimer);
    return () => {
      window.clearInterval(timer);
      motion.removeEventListener("change", updateTimer);
    };
  }, [focused, transitionTo]);

  return <article data-testid="delivery-protection-tile" ref={card} className="trust-card group relative isolate h-[148px] overflow-hidden rounded-2xl border border-white/10 bg-[#101013] shadow-[0_20px_60px_-32px_rgba(0,0,0,.9)] max-[359px]:h-[140px] min-[420px]:h-[188px] sm:h-[304px]" onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {([false, true] as const).map(slideProtection => {
      const isActive = protection === slideProtection;
      const isIncoming = transition?.to === slideProtection;
      const isOutgoing = transition?.from === slideProtection;
      const testId = isIncoming ? "delivery-slide-incoming" : isOutgoing ? "delivery-slide-outgoing" : isActive ? "delivery-slide" : undefined;
      return <div key={slideProtection ? "protection" : "delivery"} data-testid={testId} aria-hidden={!isActive} inert={!isActive} className={`absolute inset-0 ${styles.layer} ${isIncoming ? styles.entering : isOutgoing ? styles.exiting : isActive ? styles.visible : styles.hidden}`}>
        <DeliverySlide protection={slideProtection} outgoing={isOutgoing} incoming={isIncoming} />
      </div>;
    })}
  </article>;
}
