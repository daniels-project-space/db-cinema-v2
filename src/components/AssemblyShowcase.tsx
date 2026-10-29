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
  unrequestedCameraExtras,
  type RecommendationItem,
} from "../../shared/recommendationPolicy";
import styles from "./AssemblyShowcase.module.css";

type PreviewListing = GearListing & Omit<RecommendationItem, "_id" | "title" | "displayOnly">;
type PreviewItem = PreviewListing & { displayOnly: boolean };
type ExampleKit = { items: PreviewItem[]; total: number };
type PreferenceKind = "lens" | "lighting" | "audio" | "stabilisation";
type ShowcaseBrief = {
  id: "interview" | "commercial" | "documentary";
  label: string;
  crew: "solo" | "small" | "large";
  crewLabel: string;
  cameraCount: number;
  notes: string[];
  preferences: PreferenceKind[];
  description: string;
};
type ShowcaseScenario = { brief: ShowcaseBrief; low: ExampleKit; high: ExampleKit };

const stages = ["Brief", "Needs", "Budget", "Updated kit"];
const showcaseStageMs = 3600;
const showcaseBriefs: ShowcaseBrief[] = [
  {
    id: "interview",
    label: "Interview",
    crew: "small",
    crewLabel: "Small crew",
    cameraCount: 1,
    notes: ["LOW LIGHT", "HANDHELD"],
    preferences: ["lens", "audio"],
    description: "small-crew low-light handheld interview with one camera and a zoom lens",
  },
  {
    id: "commercial",
    label: "Studio commercial",
    crew: "large",
    crewLabel: "Large production",
    cameraCount: 1,
    notes: ["STUDIO", "CONTROLLED LIGHT"],
    preferences: ["lighting", "audio"],
    description: "studio commercial with one camera, dedicated lighting and wireless audio",
  },
  {
    id: "documentary",
    label: "Field documentary",
    crew: "solo",
    crewLabel: "Solo",
    cameraCount: 1,
    notes: ["AVAILABLE LIGHT", "MOBILE AUDIO"],
    preferences: ["lens", "stabilisation", "audio"],
    description: "solo field documentary with one camera, a zoom lens and wireless audio",
  },
];
const preferenceItemTypes: Record<PreferenceKind, readonly string[]> = {
  lens: ["lens"],
  lighting: ["light"],
  audio: ["wireless-mic", "boom-mic", "recorder"],
  stabilisation: ["gimbal", "tripod", "slider"],
};
const currency = (value: number) => new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
}).format(value);

function matchesPreference(item: PreviewItem, preference: PreferenceKind): boolean {
  if (preference === "lens" && item.itemType === "camera-body") {
    return item.specs?.includesLens === true || /\blens\b/i.test(item.title);
  }
  return preferenceItemTypes[preference].includes(item.itemType ?? "");
}

function supportsPreference(kit: ExampleKit, preference: PreferenceKind): boolean {
  return kit.items.some((item) => matchesPreference(item, preference));
}

function gearKind(item: PreviewItem): string {
  if (item.itemType === "camera-body") return "CAMERA";
  if (item.itemType === "lens") return "LENS";
  if (preferenceItemTypes.audio.includes(item.itemType ?? "")) return "AUDIO";
  if (item.itemType === "light") return "LIGHTING";
  if (preferenceItemTypes.stabilisation.includes(item.itemType ?? "")) return "STABILISATION";
  return "KIT PIECE";
}

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

function CrewGlyph({ size }: { size: "solo" | "small" | "large" }) {
  if (size === "solo") return (
    <svg viewBox="0 0 64 36" fill="none" aria-hidden="true">
      <circle cx="20" cy="9" r="5" />
      <path d="M9 32c.7-7.5 4.4-12 11-12s10.3 4.5 11 12M20 20v7M16 27h8" />
      <path d="M39 13h14a2 2 0 0 1 2 2v11H39zM55 17l6-3v13l-6-3M43 13l2-4h6l2 4" />
      <circle cx="47" cy="18.5" r="3" />
    </svg>
  );
  if (size === "small") return (
    <svg viewBox="0 0 64 36" fill="none" aria-hidden="true">
      <circle cx="12" cy="10" r="4" /><circle cx="31" cy="7" r="5" /><circle cx="51" cy="10" r="4" />
      <path d="M4 31c.5-6 3.2-10 8-10s7.5 4 8 10M21 31c.6-8 4-13 10-13s9.4 5 10 13M44 31c.5-6 3.2-10 8-10s7.5 4 8 10" />
      <path d="M25 20h12M31 18v-4M28 14h6" />
    </svg>
  );
  return (
    <svg viewBox="0 0 64 36" fill="none" aria-hidden="true">
      <circle cx="8" cy="10" r="3.5" /><circle cx="23" cy="7" r="4.5" /><circle cx="40" cy="7" r="4.5" /><circle cx="56" cy="10" r="3.5" />
      <path d="M1 31c.4-5 2.8-8 7-8s6.6 3 7 8M15 31c.5-7 3.2-11 8-11s7.5 4 8 11M33 31c.5-7 2.2-11 7-11s7.5 4 8 11M49 31c.4-5 2.8-8 7-8s6.6 3 7 8" />
      <path d="M22 20h9v6h-9zM25 26l-3 6M28 26l3 6M51 19v12M47 31h8M49 20h5l-1-4h-3z" />
    </svg>
  );
}

function PreferenceGlyph({ kind }: { kind: PreferenceKind }) {
  if (kind === "lens") return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="10.5" /><circle cx="14" cy="14" r="7.3" />
      <g className={styles.opticRotor}>
        <path d="M14 7.6c3.5 0 6.4 2.9 6.4 6.4S17.5 20.4 14 20.4 7.6 17.5 7.6 14 10.5 7.6 14 7.6Z" />
        <path d="m12.3 9.2 3.7 1.4 1.5 3.8-2.1 3.1-4-.1-2.3-3.2 1.2-3.8z" />
      </g>
      <circle cx="14" cy="14" r="2.1" />
      <path d="M14 1v3M14 24v3M1 14h3M24 14h3M4.8 4.8 7 7M21 21l2.2 2.2M23.2 4.8 21 7M7 21l-2.2 2.2" />
    </svg>
  );
  if (kind === "lighting") return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <g className={styles.lightRays}><path d="M14 1v2.5M14 22.5V26M2 13h2.5M23.5 13H26M5.5 4.5l1.8 1.8M20.7 19.7l1.8 1.8M22.5 4.5l-1.8 1.8M7.3 19.7l-1.8 1.8" /></g>
      <path d="M14 6.2c3.7 0 6.4 2.8 6.4 6.3 0 2-1.1 3.6-2.5 4.8-.9.7-1.3 1.6-1.3 2.7h-5.2c0-1.1-.4-2-1.3-2.7-1.4-1.2-2.5-2.8-2.5-4.8 0-3.5 2.7-6.3 6.4-6.3Z" />
      <path d="M11 22h6M11.8 24h4.4" />
    </svg>
  );
  if (kind === "audio") return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path className={styles.audioWave} d="M2 15h3l2-6 3 12 3-17 3 20 3-13 2 7h5" />
      <path d="M4 4.5h20M4 23.5h20" opacity=".35" />
      <circle cx="7" cy="9" r="1.4" /><circle cx="21" cy="20" r="1.4" />
    </svg>
  );
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <g className={styles.gimbalMotion}>
        <path d="M5 22V9l9-5 9 5v13M2 23h24M9 22v-7h10v7M14 4v5M7 11l3 2M21 11l-3 2" />
        <circle cx="14" cy="12" r="2" />
        <path d="M11.5 15h5M7.5 18.5h1M19.5 18.5h1" />
      </g>
    </svg>
  );
}

function useAnimatedBudgetTotal(total: number, animateChanges: boolean) {
  const [displayTotal, setDisplayTotal] = useState(total);
  const currentTotal = useRef(total);

  useEffect(() => {
    if (!animateChanges || Math.abs(currentTotal.current - total) < 0.01) {
      currentTotal.current = total;
      setDisplayTotal(total);
      return;
    }

    const from = currentTotal.current;
    const startedAt = window.performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 900);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + (total - from) * eased;
      currentTotal.current = next;
      setDisplayTotal(next);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [total, animateChanges]);

  return displayTotal;
}

function BudgetDial({ total, position, loading, animateChanges }: { total: number; position: number; loading: boolean; animateChanges: boolean }) {
  const angle = -132 + position * 2.64;
  const displayTotal = useAnimatedBudgetTotal(total, animateChanges);
  return (
    <div className={styles.dial} style={{ "--needle-turn": `${angle}deg` } as CSSProperties} aria-label={loading ? "Matching live catalogue gear" : `Example kit ${currency(total)} per day`}>
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
        <span>{loading ? "LIVE MATCH" : "EXAMPLE KIT"}</span>
        <strong>{loading ? "···" : total > 0 ? currency(displayTotal) : "—"}</strong>
        <small>{loading ? "CHECKING" : "PER DAY"}</small>
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
        {gearKind(item)}
      </span>
      <strong>{item.title}</strong>
      <span className={styles.gearRate}>{currency(item.pricing.daily)}<small> / day</small></span>
    </div>
  );
}

function LoadingMiniListing({ order }: { order: number }) {
  return (
    <div className={`${styles.gearCard} ${styles.loadingGearCard}`} style={{ "--order": order } as CSSProperties} aria-hidden="true">
      <span className={styles.loadingImage} />
      <span className={styles.loadingKind} />
      <span className={styles.loadingTitle} />
      <span className={styles.loadingRate} />
    </div>
  );
}

function KitPanel({ kit, position, variant, loading, dailyChange = 0, cameraCount, preferences, animateBudgetChanges }: { kit: ExampleKit; position: number; variant: "entry" | "upgrade" | "alternate" | "same"; loading: boolean; dailyChange?: number; cameraCount: number; preferences: PreferenceKind[]; animateBudgetChanges: boolean }) {
  const camera = kit.items.find((item) => item.itemType === "camera-body");
  const preferredAccessory = preferences
    .map((preference) => kit.items.find((item) => item !== camera && matchesPreference(item, preference)))
    .find((item): item is PreviewItem => !!item);
  const fallbackAccessory = kit.items.find((item) => item !== camera);
  const featured = [camera, preferredAccessory ?? fallbackAccessory].filter((item): item is PreviewItem => !!item);
  const additional = kit.items.filter((item) => !featured.some((shown) => shown._id === item._id));

  return (
    <>
      <div className={styles.budgetArea}>
        <BudgetDial total={kit.total} position={position} loading={loading} animateChanges={animateBudgetChanges} />
        <div className={styles.budgetScale}>
          <div className={styles.budgetSummary}>
            <span>{loading ? "MATCHING LIVE LISTINGS" : variant === "upgrade" ? "BUDGET INCREASE" : variant === "alternate" ? "ALTERNATE FIT" : variant === "same" ? "SAME DAILY RATE" : "STARTING BUDGET"}</span>
            <strong>{loading ? "Finding the right gear." : variant === "upgrade" && dailyChange > 0 ? `+${currency(dailyChange)} per day` : variant === "alternate" ? "Another compatible kit." : variant === "same" ? "Same kit, same total." : `${cameraCount} camera · same brief`}</strong>
          </div>
          <div className={styles.sliderTrack} style={{ "--budget-position": `${position}%` } as CSSProperties} aria-hidden="true">
            <i />
            <span />
          </div>
          <div className={styles.sliderTicks} aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>
        </div>
      </div>
      <div className={styles.kitCards}>
        {loading ? [0, 1].map((index) => <LoadingMiniListing key={index} order={index} />) : featured.length ? featured.map((item, index) => <MiniListing key={item._id} item={item} order={index} />) : (
          <div className={styles.emptyKit}><ApertureMark /><span>No matching catalogue items for this preview</span></div>
        )}
        {!loading && variant === "upgrade" && dailyChange > 0 && <span className={styles.upgradeArrow} aria-hidden="true"><svg viewBox="0 0 32 22" fill="none"><path d="M2 17c5-11 11-13 17-9l5 4M19 7l6 5-7 2" /></svg></span>}
      </div>
      {!loading && additional.length > 0 && <div className={styles.kitFoot}><span>Also includes {additional.map((item) => item.itemType === "lens" ? "a lens" : item.itemType === "wireless-mic" ? "audio" : "another piece").join(" · ")}</span></div>}
    </>
  );
}

export function AssemblyShowcase({ listings, loading = false }: { listings: PreviewListing[]; loading?: boolean }) {
  const root = useRef<HTMLElement>(null);
  const [flow, setFlow] = useState({ scene: 0, stage: 0 });
  const flowRef = useRef(flow);
  const sceneTransitionTimer = useRef<number | null>(null);
  const [sceneChanging, setSceneChanging] = useState(false);
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

  const scenarios = useMemo<ShowcaseScenario[]>(() => {
    const pool = [...new Map(
      listings
        .map((item) => ({ ...item, displayOnly: !!item.displayOnly }))
        .filter((item) => rentableCandidate(item) && !item.inventoryFacts?.reviewRequired && item.pricing.daily > 0)
        .map((item) => [item._id, item]),
    ).values()];
    const titleHasFocalRange = (title: string, first: number, second: number) =>
      title.toLowerCase().replace(/[^a-z0-9]/g, "").includes(`${first}${second}`);
    const singleZoomLens = (item: PreviewItem) =>
      (/(?:\d{2,3}\s*[–-]\s*\d{2,3}\s*mm|\bzoom\b)/i.test(item.title)) &&
      !/anamorph|\bprime\b|\bremus\b|\btrio\b|\bpair\b|(?:^|\s)[2-9]\s*x\b/i.test(item.title);
    const interviewAudio = pool.find((item) => item.itemType === "wireless-mic" &&
      item.inventoryFacts?.owned === true && /r[øo]de/i.test(item.title) && /wireless\s*pro/i.test(item.title));

    const makeScenario = (brief: ShowcaseBrief): ShowcaseScenario => {
      const cameras = pool
        .filter((item) => item.itemType === "camera-body" && !isMultiCameraListing(item))
        .filter((item) => unrequestedCameraExtras(item, brief.description) === 0)
        .sort((a, b) => a.pricing.daily - b.pricing.daily || a.title.localeCompare(b.title));
      const interviewEntry = brief.id === "interview" ? cameras
        .filter((item) =>
          item.inventoryFacts?.owned === true && /\b(?:a7\s*iii|alpha\s*7\s*iii)\b/i.test(item.title) &&
          item.specs?.includesLens === true &&
          (titleHasFocalRange(item.title, 28, 70) || titleHasFocalRange(item.title, 24, 70)) &&
          !/gimbal|stabili[sz]er|tripod|rig|microphone|\baudio\b/i.test(item.title),
        )
        .sort((a, b) => {
          const focalPreference = (item: PreviewItem) => titleHasFocalRange(item.title, 28, 70) ? 0 : 1;
          return focalPreference(a) - focalPreference(b) || a.pricing.daily - b.pricing.daily || a.title.localeCompare(b.title);
        })[0] : undefined;
      const interviewUpgrade = brief.id === "interview" ? cameras.find((item) =>
        item.inventoryFacts?.owned === true && /\bfx\s*3\b/i.test(item.title) &&
        /g\s*master/i.test(item.title) && titleHasFocalRange(item.title, 24, 70) &&
        !/gimbal|stabili[sz]er|tripod|rig|microphone|\baudio\b|ninja|16\s*[–-]\s*35/i.test(item.title),
      ) : undefined;

      const makeKit = (camera: PreviewItem | undefined, tier: "low" | "high", lowIds = new Set<string>()): ExampleKit => {
        if (!camera) return { items: [], total: 0 };
        const items: PreviewItem[] = [camera];
        for (const preference of brief.preferences) {
          const cameraAlreadyIncludesZoom = preference === "lens" && items.some((item) =>
            item.itemType === "camera-body" && item.specs?.includesLens === true &&
            (/^\d{2,3}\s*[-–]\s*\d{2,3}$/.test(item.specs.lensFocal ?? "") || /\bzoom\b/i.test(item.title)),
          );
          if (cameraAlreadyIncludesZoom) continue;
          const candidates = pool
            .filter((item) => matchesPreference(item, preference))
            .filter((item) => !alreadySupplied(item, items) && automaticRecommendation(item, items, pool))
            .filter((item) => preference !== "lens" || (singleZoomLens(item) && automaticLens(item, items)))
            .sort((a, b) => a.pricing.daily - b.pricing.daily || a.title.localeCompare(b.title));
          if (!candidates.length) continue;
          // Keep the verified reference microphone steady while its camera budget changes.
          if (brief.id === "interview" && preference === "audio" && interviewAudio && candidates.some((item) => item._id === interviewAudio._id)) {
            items.push(interviewAudio);
            continue;
          }
          if (tier === "low") {
            items.push(candidates[0]);
            continue;
          }
          const alternatives = candidates.filter((item) => !lowIds.has(item._id));
          items.push(alternatives.length ? alternatives[alternatives.length - 1] : candidates[0]);
        }
        return { items, total: items.reduce((sum, item) => sum + item.pricing.daily, 0) };
      };

      // Keep the reference camera pair when those exact owner-verified offers
      // remain eligible; other briefs use the live catalogue's actual price range.
      const entryCamera = interviewEntry ?? cameras[0];
      const low = makeKit(entryCamera, "low");
      const lowIds = new Set(low.items.map((item) => item._id));
      const cameraUpgrades = cameras
        .filter((camera) => camera._id !== entryCamera?._id)
        .map((camera) => makeKit(camera, "low"))
        .filter((kit) => kit.total > low.total && kit.items.some((item) => !lowIds.has(item._id)))
        .sort((a, b) => a.total - b.total);
      const samePriceCamera = cameras
        .filter((camera) => camera._id !== entryCamera?._id)
        .map((camera) => makeKit(camera, "low"))
        .find((kit) => kit.total === low.total && kit.items.some((item) => !lowIds.has(item._id)));
      const preferredUpgrade = interviewUpgrade ? makeKit(interviewUpgrade, "high", lowIds) : undefined;
      const high = preferredUpgrade && preferredUpgrade.total > low.total
        ? preferredUpgrade
        : cameraUpgrades[cameraUpgrades.length - 1] ?? samePriceCamera ?? makeKit(cameras[0], "high", lowIds);
      return { brief, low, high };
    };

    return showcaseBriefs.map(makeScenario).filter((scenario, index) =>
      index === 0 || scenario.brief.preferences.some((preference) =>
        preference !== "audio" && supportsPreference(scenario.low, preference) && supportsPreference(scenario.high, preference),
      ),
    );
  }, [listings]);

  const hasExampleGear = scenarios.some((scenario) => scenario.low.items.length > 0 && scenario.high.items.length > 0);

  useEffect(() => {
    if (!loading) {
      const initialFlow = { scene: 0, stage: 0 };
      flowRef.current = initialFlow;
      setFlow(initialFlow);
    }
  }, [loading]);

  useEffect(() => {
    if (reducedMotion || !visible || !pageVisible || (!loading && !hasExampleGear)) return;
    const timer = window.setInterval(() => {
      const current = flowRef.current;
      if (current.stage + 1 < stages.length) {
        const next = { ...current, stage: current.stage + 1 };
        flowRef.current = next;
        setFlow(next);
        return;
      }

      setSceneChanging(true);
      if (sceneTransitionTimer.current !== null) window.clearTimeout(sceneTransitionTimer.current);
      sceneTransitionTimer.current = window.setTimeout(() => {
        const next = { scene: (flowRef.current.scene + 1) % Math.max(1, scenarios.length), stage: 0 };
        flowRef.current = next;
        setFlow(next);
        sceneTransitionTimer.current = null;
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => setSceneChanging(false)));
      }, 520);
    }, showcaseStageMs);
    return () => {
      window.clearInterval(timer);
      if (sceneTransitionTimer.current !== null) {
        window.clearTimeout(sceneTransitionTimer.current);
        sceneTransitionTimer.current = null;
        setSceneChanging(false);
      }
    };
  }, [reducedMotion, visible, pageVisible, loading, hasExampleGear, scenarios.length]);

  useEffect(() => () => {
    if (sceneTransitionTimer.current !== null) window.clearTimeout(sceneTransitionTimer.current);
  }, []);

  const stage = flow.stage;
  const activeScenario: ShowcaseScenario = scenarios.length ? scenarios[flow.scene % scenarios.length] : {
    brief: showcaseBriefs[0], low: { items: [], total: 0 }, high: { items: [], total: 0 },
  };
  const showcaseBrief = activeScenario.brief;
  const examples = activeScenario;
  const moving = !reducedMotion && visible && pageVisible && (loading || hasExampleGear);
  const selectedPreferences = new Set<PreferenceKind>(showcaseBrief.preferences.filter((preference) =>
    supportsPreference(examples.low, preference) && supportsPreference(examples.high, preference),
  ));
  const budgetGap = examples.high.total - examples.low.total;
  const highPosition = budgetGap > 0 ? 88 : 58;
  const lowPosition = budgetGap > 0 && examples.high.total > 0
    ? Math.max(18, Math.min(78, highPosition * examples.low.total / examples.high.total))
    : 58;
  const hasHigherKit = budgetGap > 0;
  const hasAlternativeGear = examples.high.items.length !== examples.low.items.length || examples.high.items.some((item, index) => item._id !== examples.low.items[index]?._id);

  return (
    <section ref={root} aria-labelledby="assembly-showcase-title" className={styles.root} data-moving={moving} data-loading={loading} data-stage={stage} data-scene={showcaseBrief.id} data-changing={sceneChanging}>
      <div className={styles.ambientAperture} aria-hidden="true"><ApertureMark /></div>

      <div className={styles.stageRail} aria-hidden="true">
        {stages.map((name, index) => (
          <div key={name} className={styles.stageLabel} data-active={stage === index} data-complete={stage > index}>
            <span>{index + 1}.</span> {name}<i />
          </div>
        ))}
      </div>

      <div className={styles.panels}>
        <article className={`${styles.panel} ${styles.briefPanel}`} data-active={stage === 0} aria-current={stage === 0 ? "step" : undefined}>
          <span className={styles.rec}><i /> REC</span>
          <ApertureMark className={styles.briefAperture} />
          <div className={styles.briefContent}>
            <div className={styles.brandLockup}><b>DB</b><span>CINEMA<br />RENTALS</span></div>
            <h2 id="assembly-showcase-title" className={styles.assemblyName}><span>AI</span> ASSEMBLY</h2>
            <div className={styles.briefChoice}><span className={styles.cameraOutline}><svg viewBox="0 0 26 21" fill="none" aria-hidden="true"><path d="M2 5h14a2 2 0 0 1 2 2v10H2zM18 9l6-3v11l-6-3M6 5l2-3h5l2 3" /><circle cx="10" cy="11" r="3" /></svg></span><span>{showcaseBrief.label}</span><span className={styles.chevronMark}>⌄</span></div>
            <div className={styles.crewOptions} role="img" aria-label={`${showcaseBrief.crewLabel} selected. Solo, small crew, or large production.`}>
              {([
                ["solo", "Solo"],
                ["small", "Small crew"],
                ["large", "Large production"],
              ] as const).map(([size, label]) => (
                <div key={size} className={styles.crewOption} data-selected={showcaseBrief.crew === size} aria-hidden="true">
                  <CrewGlyph size={size} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <div className={styles.crewMeta}><span>CAMERA COUNT</span><strong>{String(showcaseBrief.cameraCount).padStart(2, "0")}</strong><span>CAMERA</span></div>
            <div className={styles.briefNote}>{showcaseBrief.notes.map((note, index) => <span key={note}>{index > 0 && <i />}{note}</span>)}</div>
          </div>
          <div className={styles.signalPoint} aria-hidden="true" />
        </article>

        <article className={`${styles.panel} ${styles.needsPanel}`} data-active={stage === 1} aria-current={stage === 1 ? "step" : undefined}>
          <div className={styles.needsContent}>
            <h3>Gear preferences</h3>
            <div className={styles.preferenceGrid}>
              {([
                ["lens", "Lenses", selectedPreferences.has("lens")],
                ["lighting", "Lighting", selectedPreferences.has("lighting")],
                ["audio", "Audio", selectedPreferences.has("audio")],
                ["stabilisation", "Stabilisation", selectedPreferences.has("stabilisation")],
              ] as const).map(([kind, label, selected]) => (
                <div key={kind} className={styles.preference} data-selected={selected}>
                  <PreferenceGlyph kind={kind} /><span>{label}</span><i />
                </div>
              ))}
            </div>
            <div className={styles.needsFooter}>
              <div className={styles.cameraCount}><span>CAMERA COUNT</span><div><i>−</i><b>{showcaseBrief.cameraCount}</b><i>+</i></div></div>
              <div className={styles.noteField}><span>ADDITIONAL NOTES</span><strong>{showcaseBrief.notes.map((note) => note.toLowerCase()).join(" · ")}</strong><i>✎</i></div>
            </div>
          </div>
          <div className={styles.needsOrbit} aria-hidden="true"><ApertureMark /></div>
        </article>

        <article className={`${styles.panel} ${styles.budgetPanel}`} data-active={stage === 2} aria-current={stage === 2 ? "step" : undefined}>
          <KitPanel kit={examples.low} position={lowPosition} variant="entry" loading={loading} cameraCount={showcaseBrief.cameraCount} preferences={showcaseBrief.preferences} animateBudgetChanges={moving && !loading && !reducedMotion} />
          <div className={styles.signalPoint} aria-hidden="true" />
        </article>

        <article className={`${styles.panel} ${styles.updatedPanel}`} data-active={stage === 3} aria-current={stage === 3 ? "step" : undefined}>
          <KitPanel kit={examples.high} position={highPosition} variant={hasHigherKit ? "upgrade" : hasAlternativeGear ? "alternate" : "same"} loading={loading} dailyChange={Math.max(0, budgetGap)} cameraCount={showcaseBrief.cameraCount} preferences={showcaseBrief.preferences} animateBudgetChanges={moving && !loading && !reducedMotion} />
        </article>
      </div>
      <div className={styles.footer}>
        <p className={styles.disclaimer}>Live catalogue examples · rates shown per day · choose rental dates in the builder to check availability.</p>
        <Link href="/assemble" className={styles.cta}>Build your kit <IconArrowRight className="h-4 w-4" /></Link>
      </div>
    </section>
  );
}
