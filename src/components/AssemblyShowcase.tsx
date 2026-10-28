"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { IconArrowRight, IconCamera, IconSliders } from "@/components/icons";
import { SmartImage } from "@/components/SmartImage";
import type { GearListing } from "@/components/GearCard";
import { automaticRecommendation, automaticLens, alreadySupplied, rentableCandidate, type RecommendationItem } from "../../shared/recommendationPolicy";
import { isCameraSet } from "@/lib/kitRank";
import styles from "./AssemblyShowcase.module.css";

type PreviewListing = GearListing & Omit<RecommendationItem, "_id" | "title" | "displayOnly">;
const phases = ["The brief", "Fine-tune", "Your kit"];
const currency = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);

export function AssemblyShowcase({ listings }: { listings: PreviewListing[] }) {
  const root = useRef<HTMLElement>(null);
  const sequence = useRef(0);
  const [phase, setPhase] = useState(0);
  const [budget, setBudget] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => { setReducedMotion(media.matches); setPlaying(!media.matches); };
    const visibility = () => setPageVisible(!document.hidden);
    preference(); visibility();
    media.addEventListener("change", preference);
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); media.removeEventListener("change", preference); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  useEffect(() => {
    if (!playing || reducedMotion || !visible || !pageVisible) return;
    let tick = sequence.current;
    const timer = window.setInterval(() => {
      tick += 1;
      sequence.current = tick;
      setPhase(tick % 3);
      if (tick % 3 === 1) setBudget([120, 240, 360][Math.floor(tick / 3) % 3]);
    }, 4800);
    return () => window.clearInterval(timer);
  }, [playing, reducedMotion, visible, pageVisible]);

  const kit = useMemo(() => {
    const normalized = listings.map(x => ({ ...x, displayOnly: !!x.displayOnly }));
    const pool = [...new Map(normalized.filter(x => rentableCandidate(x) && x.pricing.daily > 0).map(x => [x._id, x])).values()];
    const picked: (PreviewListing & { displayOnly: boolean })[] = [];
    for (const [type, share] of [["camera-body", 0.6], ["lens", 0.25], ["wireless-mic", 0.15]] as const) {
      let candidates = pool.filter(x => x.itemType === type && !alreadySupplied(x, picked) && automaticRecommendation(x, picked) && (type !== "lens" || automaticLens(x, picked)));
      if (type === "camera-body") {
        const bodies = candidates.filter(x => !isCameraSet(x.title));
        if (bodies.length) candidates = bodies;
      }
      candidates.sort((a, b) => Math.abs(a.pricing.daily - budget * share) - Math.abs(b.pricing.daily - budget * share));
      const availableBudget = budget - picked.reduce((sum, x) => sum + x.pricing.daily, 0);
      const match = candidates.find(x => x.pricing.daily <= availableBudget);
      if (match) picked.push(match);
    }
    return picked;
  }, [listings, budget]);
  const total = kit.reduce((sum, item) => sum + item.pricing.daily, 0);
  const pause = (next: number) => { sequence.current = next; setPlaying(false); setPhase(next); };
  const moving = playing && !reducedMotion && visible && pageVisible;

  return (
    <section ref={root} aria-labelledby="assembly-showcase-title" className={styles.root} data-moving={moving} data-phase={phase}>
      <div className={styles.grain} aria-hidden />
      <div className={styles.intro}>
        <div className={styles.eyebrow}><span className={styles.mark}><IconSliders /></span> AI ITEM ASSEMBLY <span className={styles.new}>MADE FOR YOUR SHOOT</span></div>
        <h2 id="assembly-showcase-title">The brief goes in.<br /><span>Your kit comes together.</span></h2>
        <p>A camera, the right glass, sound that lands. Shape a kit around your shoot, your dates and your budget.</p>
        <Link href="/assemble" className={styles.cta}>Build my kit <IconArrowRight className="h-4 w-4" /></Link>
        <span className={styles.caption}>Your choices. Gaffer’s eye for the details.</span>
      </div>

      <div className={styles.studio}>
        <div className={styles.studioTop}><span><i /> ASSEMBLY STUDIO</span><button type="button" aria-label={playing ? "Pause assembly preview" : "Play assembly preview"} onClick={() => setPlaying(!playing)} disabled={reducedMotion}>{playing ? "Ⅱ Pause" : "▷ Play"}</button></div>
        <div className={styles.canvas}>
          <svg className={styles.wiring} viewBox="0 0 600 220" fill="none" aria-hidden>
            <path d="M30 110H140Q165 110 165 85V55Q165 35 185 35H420Q440 35 440 55V165Q440 185 460 185H580" />
            <path d="M30 110H140Q165 110 165 135V165Q165 185 185 185H390Q410 185 410 165V55Q410 35 430 35H580" />
            <path className={styles.signal} d="M30 110H140Q165 110 165 85V55Q165 35 185 35H420Q440 35 440 55V165Q440 185 460 185H580" />
            {[30, 165, 300, 440, 580].map((x, i) => <circle key={x} cx={x} cy={i % 2 ? 35 : 110} r="3" />)}
          </svg>

          <div className={`${styles.scene} ${styles.brief}`} aria-hidden={phase !== 0} inert={phase !== 0} data-active={phase === 0}>
            <div className={styles.briefSheet}><div className={styles.sheetTop}><span>01 / YOUR VISION</span><IconCamera className="h-5 w-5" /></div><strong>A two-person interview.<br />Beautiful light. Clean sound.</strong><div className={styles.briefTags}><span>Small crew</span><span>London</span><span>One great story</span></div><div className={styles.scan} /></div>
            <div className={styles.flowNode}><div className={styles.orbit}><IconSliders /></div><span>Reading the brief</span><small>Camera · glass · audio</small></div>
          </div>

          <div className={`${styles.scene} ${styles.tune}`} aria-hidden={phase !== 1} inert={phase !== 1} data-active={phase === 1}>
            <div className={styles.dial} style={{ "--turn": `${-110 + (budget - 60) / 440 * 220}deg` } as CSSProperties}><svg viewBox="0 0 160 160" fill="none" aria-hidden><circle cx="80" cy="80" r="68" /><circle cx="80" cy="80" r="56" /><path d="M80 9V19M80 141V151M9 80H19M141 80H151M30 30L37 37M123 123L130 130M30 130L37 123M123 37L130 30" /></svg><i /><div><IconSliders /><strong>{currency(budget)}</strong><span>DAY-RATE BUDGET</span></div></div>
            <div className={styles.tuneControls}><span className={styles.micro}>02 / FIND THE BALANCE</span><strong>A little more room.<br />A different kind of kit.</strong><label htmlFor="assembly-preview-budget">Try a budget <span>{currency(budget)} / day</span></label><input id="assembly-preview-budget" type="range" min="60" max="500" step="20" value={budget} style={{ "--fill": `${(budget - 60) / 440 * 100}%` } as CSSProperties} onChange={event => { setPlaying(false); setBudget(Number(event.target.value)); }} /><div className={styles.scale}><span>Lean & nimble</span><span>Room to create</span></div><button type="button" onClick={() => pause(2)}>See this example kit <IconArrowRight className="h-3 w-3" /></button></div>
          </div>

          <div className={`${styles.scene} ${styles.result}`} aria-hidden={phase !== 2} inert={phase !== 2} data-active={phase === 2}>
            <div className={styles.resultTop}><span className={styles.micro}>03 / PIECES FALL INTO PLACE</span><span>EXAMPLE KIT</span></div>
            <div className={styles.cards}>{kit.length ? kit.map((item, index) => <Link className={styles.card} href={`/gear/${item.slug}`} key={item._id} style={{ "--order": index } as CSSProperties}><span className={styles.itemImage}><SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className="h-full w-full !bg-transparent" /><span>0{index + 1}</span></span><span className={styles.itemType}>{item.itemType === "camera-body" ? "THE CAMERA" : item.itemType === "lens" ? "THE GLASS" : "THE SOUND"}</span><strong>{item.title}</strong><span className={styles.itemPrice}>{currency(item.pricing.daily)}<small> / day</small></span></Link>) : <div className={styles.loading}>Your next kit starts with a good brief.<span>Open the builder to explore the catalogue.</span></div>}</div>
            <div className={styles.resultBottom}><span>Example day rates · choose dates to check stock</span>{kit.length > 0 && <strong>{currency(total)}<small> / day</small></strong>}</div>
          </div>
        </div>

        <div className={styles.steps} role="group" aria-label="Assembly preview stages">{phases.map((name, index) => <button key={name} type="button" aria-pressed={phase === index} onClick={() => pause(index)}><span>0{index + 1}</span>{name}<i /></button>)}</div>
      </div>
    </section>
  );
}
