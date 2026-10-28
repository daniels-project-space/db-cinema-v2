"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { IconArrowRight } from "@/components/icons";
import { SmartImage } from "@/components/SmartImage";
import type { GearListing } from "@/components/GearCard";
import {
  alreadySupplied,
  automaticLens,
  automaticRecommendation,
  rentableCandidate,
  type RecommendationItem,
} from "../../shared/recommendationPolicy";
import styles from "./AssemblyShowcase.module.css";

type PreviewListing = GearListing & Omit<RecommendationItem, "_id" | "title" | "displayOnly">;
type PreviewItem = PreviewListing & { displayOnly: boolean };
type ExampleKit = { items: PreviewItem[]; total: number };

const stages = ["Brief", "Needs", "Budget", "Updated kit"];
const currency = (value: number) => new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
}).format(value);

function isMultiCameraListing(item: PreviewItem): boolean {
  const evidence = [item.title, ...(item.rentalContents?.included ?? [])];
  const multipleCameras = /(?:\b(?:[2-9]|\d{2,})\s*[x×]\s*(?:[a-z0-9.+-]+\s+){0,5}(?:camera|cameras|body|bodies)\b|\b(?:two|three|four|five|six)\s+(?:[a-z0-9.+-]+\s+){0,4}(?:camera|cameras|body|bodies)\b)/i;
  return evidence.some((line) => multipleCameras.test(line));
}

function ApertureMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 160" fill="none" aria-hidden="true">
      <circle cx="80" cy="80" r="75" />
      <circle cx="80" cy="80" r="68" />
      <circle cx="80" cy="80" r="61" />
      <g className={styles.apertureTicks}>
        {Array.from({ length: 48 }, (_, index) => (
          <path key={index} d="M80 8V15" transform={`rotate(${index * 7.5} 80 80)`} />
        ))}
      </g>
      <g className={styles.apertureBlades}>
        {Array.from({ length: 7 }, (_, index) => (
          <path key={index} d="M75 35C91 33 107 41 116 54L87 76L68 57C68 47 70 40 75 35Z" transform={`rotate(${index * (360 / 7)} 80 80)`} />
        ))}
      </g>
      <circle cx="80" cy="80" r="24" />
      <circle cx="80" cy="80" r="13" />
      <circle className={styles.apertureCore} cx="80" cy="80" r="5" />
    </svg>
  );
}

function CrewGlyph() {
  return (
    <svg viewBox="0 0 86 38" fill="none" aria-hidden="true">
      <path d="M7 35c.5-7 4-11 10-11s9.5 4 10 11M33 35c.5-9 4.5-14 10-14s9.5 5 10 14M59 35c.5-7 4-11 10-11s9.5 4 10 11" />
      <circle cx="17" cy="14" r="6" /><circle cx="43" cy="9" r="7" /><circle cx="69" cy="14" r="6" />
      <path d="M37 21h12M43 2v3" />
    </svg>
  );
}

function PreferenceGlyph({ kind }: { kind: "lens" | "lighting" | "audio" | "stabilisation" }) {
  if (kind === "lens") return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="10.5" /><circle cx="14" cy="14" r="7.3" /><circle cx="14" cy="14" r="3.5" />
      <path d="M14 1v3M14 24v3M1 14h3M24 14h3M4.8 4.8 7 7M21 21l2.2 2.2M23.2 4.8 21 7M7 21l-2.2 2.2" />
    </svg>
  );
  if (kind === "lighting") return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="13" r="5.5" /><path d="M14 1v3M14 22v4M2 13h3M23 13h3M5.5 4.5l2.1 2.1M20.4 19.4l2.1 2.1M22.5 4.5l-2.1 2.1M7.6 19.4l-2.1 2.1M11 20v3h6v-3" />
    </svg>
  );
  if (kind === "audio") return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M2 15h3l2-6 3 12 3-17 3 20 3-13 2 7h5" />
      <circle cx="7" cy="9" r="1.4" /><circle cx="21" cy="20" r="1.4" />
    </svg>
  );
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M5 22V9l9-5 9 5v13M2 23h24M9 22v-7h10v7M14 4v5M7 11l3 2M21 11l-3 2" />
      <circle cx="14" cy="12" r="2" />
    </svg>
  );
}

function BudgetDial({ total, position }: { total: number; position: number }) {
  const angle = -132 + position * 2.64;
  return (
    <div className={styles.dial} style={{ "--needle-turn": `${angle}deg` } as CSSProperties} aria-label={`Example kit ${currency(total)} per day`}>
      <svg viewBox="0 0 160 160" fill="none" aria-hidden="true">
        <circle className={styles.dialOuter} cx="80" cy="80" r="70" />
        <circle className={styles.dialInner} cx="80" cy="80" r="61" />
        <path className={styles.dialArc} d="M27 117a67 67 0 1 1 106 0" />
        <g className={styles.dialTicks}>
          {Array.from({ length: 31 }, (_, index) => (
            <path key={index} d={index % 5 === 0 ? "M80 10v8" : "M80 12v4"} transform={`rotate(${index * 8.5 - 127.5} 80 80)`} />
          ))}
        </g>
      </svg>
      <i />
      <div className={styles.dialReadout}>
        <span>EXAMPLE KIT</span>
        <strong>{total > 0 ? currency(total) : "—"}</strong>
        <small>PER DAY</small>
      </div>
    </div>
  );
}

function MiniListing({ item, order }: { item: PreviewItem; order: number }) {
  return (
    <div className={styles.gearCard} style={{ "--order": order } as CSSProperties}>
      <span className={styles.gearImage}>
        <SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className="h-full w-full !bg-transparent" />
      </span>
      <span className={styles.gearKind}>
        {item.itemType === "camera-body" ? "CAMERA" : item.itemType === "lens" ? "LENS" : item.itemType === "wireless-mic" ? "AUDIO" : "KIT PIECE"}
      </span>
      <strong>{item.title}</strong>
      <span className={styles.gearRate}>{currency(item.pricing.daily)}<small> / day</small></span>
    </div>
  );
}

function KitPanel({ kit, position, variant }: { kit: ExampleKit; position: number; variant: "entry" | "upgrade" | "alternate" | "same" }) {
  const camera = kit.items.find((item) => item.itemType === "camera-body");
  const audio = kit.items.find((item) => item.itemType === "wireless-mic");
  const lens = kit.items.find((item) => item.itemType === "lens");
  const featured = [camera, audio ?? lens].filter((item): item is PreviewItem => !!item);
  const additional = kit.items.filter((item) => !featured.some((shown) => shown._id === item._id));

  return (
    <>
      <div className={styles.budgetArea}>
        <BudgetDial total={kit.total} position={position} />
        <div className={styles.budgetScale}>
          <div className={styles.budgetSummary}>
            <span>{variant === "upgrade" ? "MORE ROOM TO CREATE" : variant === "alternate" ? "ALTERNATE FIT" : variant === "same" ? "ONE MATCHING KIT" : "LEAN STARTING POINT"}</span>
            <strong>{variant === "upgrade" ? "A higher-spec camera." : variant === "alternate" ? "Another compatible choice." : variant === "same" ? "Same kit, same daily total." : "A capable, lighter kit."}</strong>
            <small>Same interview brief · one camera</small>
          </div>
          <div className={styles.sliderTrack} aria-hidden="true">
            <i style={{ "--budget-position": `${position}%` } as CSSProperties} />
            <span style={{ left: `${position}%` }} />
          </div>
          <div className={styles.sliderTicks} aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>
        </div>
      </div>
      <div className={styles.kitCards}>
        {featured.length ? featured.map((item, index) => <MiniListing key={item._id} item={item} order={index} />) : (
          <div className={styles.emptyKit}><ApertureMark /><span>Live catalogue examples appear here</span></div>
        )}
      </div>
      <div className={styles.kitFoot}>
        <span>{additional.length ? `Also includes ${additional.map((item) => item.itemType === "lens" ? "a lens" : item.itemType === "wireless-mic" ? "audio" : "another piece").join(" · ")}` : "Example day rates · choose dates to check availability"}</span>
        {kit.total > 0 && <strong>{currency(kit.total)}<small> / day</small></strong>}
      </div>
    </>
  );
}

export function AssemblyShowcase({ listings }: { listings: PreviewListing[] }) {
  const root = useRef<HTMLElement>(null);
  const [stage, setStage] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => setReducedMotion(media.matches);
    const visibility = () => setPageVisible(!document.hidden);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 });
    preference();
    visibility();
    if (root.current) observer.observe(root.current);
    media.addEventListener("change", preference);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", preference);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  const examples = useMemo(() => {
    const pool = [...new Map(
      listings
        .map((item) => ({ ...item, displayOnly: !!item.displayOnly }))
        .filter((item) => rentableCandidate(item) && !item.inventoryFacts?.reviewRequired && item.pricing.daily > 0)
        .map((item) => [item._id, item]),
    ).values()];
    const cameras = pool
      .filter((item) => item.itemType === "camera-body" && !isMultiCameraListing(item))
      .sort((a, b) => a.pricing.daily - b.pricing.daily || a.title.localeCompare(b.title));

    const makeKit = (camera: PreviewItem | undefined, tier: "low" | "high", lowIds = new Set<string>()): ExampleKit => {
      if (!camera) return { items: [], total: 0 };
      const items: PreviewItem[] = camera ? [camera] : [];
      const add = (type: "lens" | "wireless-mic", isLens = false) => {
        const candidates = pool
          .filter((item) => item.itemType === type)
          .filter((item) => !alreadySupplied(item, items) && automaticRecommendation(item, items))
          .filter((item) => !isLens || automaticLens(item, items))
          .sort((a, b) => a.pricing.daily - b.pricing.daily || a.title.localeCompare(b.title));
        if (!candidates.length) return;
        if (tier === "low") {
          items.push(candidates[0]);
          return;
        }
        const alternatives = candidates.filter((item) => !lowIds.has(item._id));
        items.push(alternatives.length ? alternatives[alternatives.length - 1] : candidates[0]);
      };
      add("lens", true);
      add("wireless-mic");
      return { items, total: items.reduce((sum, item) => sum + item.pricing.daily, 0) };
    };

    const low = makeKit(cameras[0], "low");
    const lowIds = new Set(low.items.map((item) => item._id));
    const cameraUpgrades = cameras.slice(1)
      .map((camera) => makeKit(camera, "low"))
      .filter((kit) => kit.total > low.total && kit.items.some((item) => !lowIds.has(item._id)))
      .sort((a, b) => a.total - b.total);
    const samePriceCamera = cameras.slice(1)
      .map((camera) => makeKit(camera, "low"))
      .find((kit) => kit.total === low.total && kit.items.some((item) => !lowIds.has(item._id)));

    // If a higher-priced camera is not available in the current catalogue,
    // use a real compatible lens or microphone alternative when one exists.
    const high = cameraUpgrades[cameraUpgrades.length - 1] ?? samePriceCamera ?? makeKit(cameras[0], "high", lowIds);
    return { low, high };
  }, [listings]);

  useEffect(() => {
    if (reducedMotion || !visible || !pageVisible) return;
    const timer = window.setInterval(() => setStage((current) => (current + 1) % stages.length), 5000);
    return () => window.clearInterval(timer);
  }, [reducedMotion, visible, pageVisible]);

  const moving = !reducedMotion && visible && pageVisible;
  const hasLens = [examples.low, examples.high].every((kit) => kit.items.some((item) => item.itemType === "lens" || (item.itemType === "camera-body" && /\blens\b/i.test(item.title))));
  const hasAudio = [examples.low, examples.high].every((kit) => kit.items.some((item) => item.itemType === "wireless-mic"));
  const budgetGap = examples.high.total - examples.low.total;
  const lowPosition = budgetGap > 0 ? 38 : 58;
  const highPosition = budgetGap > 0 ? 88 : 58;
  const hasHigherKit = budgetGap > 0;
  const hasAlternativeGear = examples.high.items.length !== examples.low.items.length || examples.high.items.some((item, index) => item._id !== examples.low.items[index]?._id);

  return (
    <section ref={root} aria-labelledby="assembly-showcase-title" className={styles.root} data-moving={moving}>
      <div className={styles.ambientAperture} aria-hidden="true"><ApertureMark /></div>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.brandMark}><ApertureMark /></span>
          <div>
            <h2 id="assembly-showcase-title">AI ASSEMBLY</h2>
            <span>One brief. A considered kit.</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.loopStatus}><i /> AUTO PREVIEW</span>
          <Link href="/assemble" className={styles.cta}>Build your kit <IconArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>

      <div className={styles.stageRail} aria-hidden="true">
        {stages.map((name, index) => (
          <div key={name} className={styles.stageLabel} data-active={stage === index}>
            <span>{index + 1}.</span> {name}<i />
          </div>
        ))}
      </div>

      <div className={styles.panels}>
        <article className={`${styles.panel} ${styles.briefPanel}`} data-active={stage === 0} aria-current={stage === 0 ? "step" : undefined}>
          <div className={styles.panelTop}><span>01 / BRIEF</span><span className={styles.rec}><i /> REC</span></div>
          <ApertureMark className={styles.briefAperture} />
          <div className={styles.briefContent}>
            <div className={styles.brandLockup}><b>DB</b><span>CINEMA<br />RENTALS</span></div>
            <p className={styles.briefType}>Interview</p>
            <div className={styles.briefChoice}><span className={styles.cameraOutline}><svg viewBox="0 0 26 21" fill="none" aria-hidden="true"><path d="M2 5h14a2 2 0 0 1 2 2v10H2zM18 9l6-3v11l-6-3M6 5l2-3h5l2 3" /><circle cx="10" cy="11" r="3" /></svg></span><span>Small crew</span><span className={styles.chevronMark}>⌄</span></div>
            <div className={styles.crewRow}><CrewGlyph /><span>Small crew</span><span className={styles.crewDivider} /><strong>01</strong><span>camera</span></div>
            <div className={styles.briefNote}><span>LOW LIGHT</span><i /> <span>HANDHELD</span></div>
          </div>
          <div className={styles.signalPoint} aria-hidden="true" />
        </article>

        <article className={`${styles.panel} ${styles.needsPanel}`} data-active={stage === 1} aria-current={stage === 1 ? "step" : undefined}>
          <div className={styles.panelTop}><span>02 / NEEDS</span><span className={styles.panelHint}>THE SHOT, IN FOCUS</span></div>
          <div className={styles.needsContent}>
            <h3>Gear preferences</h3>
            <div className={styles.preferenceGrid}>
              {([
                ["lens", "Lenses", hasLens],
                ["lighting", "Lighting", false],
                ["audio", "Audio", hasAudio],
                ["stabilisation", "Stabilisation", false],
              ] as const).map(([kind, label, selected]) => (
                <div key={kind} className={styles.preference} data-selected={selected}>
                  <PreferenceGlyph kind={kind} /><span>{label}</span><i />
                </div>
              ))}
            </div>
            <div className={styles.needsFooter}>
              <div className={styles.cameraCount}><span>CAMERA COUNT</span><div><i>−</i><b>1</b><i>+</i></div></div>
              <div className={styles.noteField}><span>ADDITIONAL NOTES</span><strong>low light · handheld</strong><i>✎</i></div>
            </div>
          </div>
          <div className={styles.needsOrbit} aria-hidden="true"><ApertureMark /></div>
        </article>

        <article className={`${styles.panel} ${styles.budgetPanel}`} data-active={stage === 2} aria-current={stage === 2 ? "step" : undefined}>
          <div className={styles.panelTop}><span>03 / BUDGET</span><span className={styles.panelHint}>LEAN START</span></div>
          <KitPanel kit={examples.low} position={lowPosition} variant="entry" />
          <div className={styles.signalPoint} aria-hidden="true" />
        </article>

        <article className={`${styles.panel} ${styles.updatedPanel}`} data-active={stage === 3} aria-current={stage === 3 ? "step" : undefined}>
          <div className={styles.panelTop}><span>04 / UPDATED KIT</span><span className={styles.panelHint}>{hasHigherKit ? "MORE HEADROOM" : hasAlternativeGear ? "ALTERNATE FIT" : "NO PRICE CHANGE"}</span></div>
          <KitPanel kit={examples.high} position={highPosition} variant={hasHigherKit ? "upgrade" : hasAlternativeGear ? "alternate" : "same"} />
        </article>
      </div>
      <p className={styles.disclaimer}>Live catalogue examples · displayed rates are per day · choose rental dates in the builder to check availability.</p>
    </section>
  );
}
