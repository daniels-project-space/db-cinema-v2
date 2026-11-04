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
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-5 sm:p-6">
        <span className="inline-flex rounded-full border border-white/20 bg-black/65 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.17em] text-white/85 shadow-lg backdrop-blur-sm">{protection ? "Included free" : "Delivery"}</span>
        <span className={`trust-symbol ci-host rounded-xl border border-accent-300/25 bg-[#160d11]/85 p-2 text-accent-300 ${styles.glyph}`} aria-hidden>{protection ? <BadgeShield className="h-8 w-8" /> : <BadgeTruck className="h-8 w-8" />}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
        <h2 className="mt-4 max-w-[17rem] font-display text-xl font-semibold leading-tight text-white sm:text-2xl">{protection ? "Cancellation protection for free" : "Delivered across London"}</h2>
        {protection ? <p className="mt-2 max-w-[18rem] text-sm leading-relaxed text-white/75">If kit is unavailable before pickup, all accounts can get a full refund. Non-blocked accounts may choose 130% rental credit. <Link className="underline underline-offset-2" href="/legal/cancellation" tabIndex={outgoing ? -1 : undefined}>See terms</Link></p> : <p className="mt-2 max-w-[18rem] text-sm leading-relaxed text-white/75">Reliable delivery and collection, straight to your set.</p>}
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

  useEffect(() => {
    for (const src of ["/images/home/london-delivery-20261028.webp", "/images/home/cancellation-protection-20261103.webp"]) {
      const preload = new window.Image();
      preload.decoding = "async";
      preload.src = src;
    }
  }, []);

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
      }, 7000);
    };
    updateTimer();
    motion.addEventListener("change", updateTimer);
    return () => {
      window.clearInterval(timer);
      motion.removeEventListener("change", updateTimer);
    };
  }, [focused, transitionTo]);

  return <article data-testid="delivery-protection-tile" ref={card} className="trust-card group relative isolate h-[280px] overflow-hidden rounded-2xl border border-white/10 bg-[#101013] shadow-[0_20px_60px_-32px_rgba(0,0,0,.9)] sm:h-[304px]" onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div data-testid="delivery-slide" aria-hidden={Boolean(transition)} inert={Boolean(transition)} className={`absolute inset-0 ${styles.layer} ${transition ? styles.exiting : styles.visible}`}>
      <DeliverySlide protection={transition ? transition.from : protection} outgoing={Boolean(transition)} />
    </div>
    {transition && <div data-testid="delivery-slide-incoming" aria-hidden="true" inert className={`absolute inset-0 ${styles.layer} ${styles.entering}`}><DeliverySlide protection={transition.to} incoming /></div>}
    <button type="button" onClick={() => transitionTo(!activeSlide.current)} aria-label={protection ? "Show London delivery" : "Show cancellation protection"} className="absolute bottom-3 right-4 z-10 rounded-full border border-white/30 bg-black/70 px-2 py-1 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">↻</button>
  </article>;
}
