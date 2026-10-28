"use client";

import { useEffect, useMemo, useRef, useState, useId } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SmartImage } from "@/components/SmartImage";
import { IconArrowRight, IconSearch } from "@/components/icons";
import { GearCard, type GearListing } from "@/components/GearCard";
import { money } from "@/lib/pricing";

type Category = { name: string; count: number };

const categoryHints: { pattern: RegExp; category: RegExp }[] = [
  { pattern: /\b(camera|cameras|camcorder|body|bodies|red|arri|sony|canon|fx3|fx6|fx9|venice|komodo|v-raptor|blackmagic)\b/i, category: /camera|cinema|video/i },
  { pattern: /\b(lens|lenses|prime|zoom|anamorphic|glass|optics)\b/i, category: /lens|optic/i },
  { pattern: /\b(light|lights|lighting|led|tube|softbox)\b/i, category: /light/i },
  { pattern: /\b(audio|sound|mic|mics|microphone|microphones|lav)\b/i, category: /audio|sound/i },
  { pattern: /\b(drone|drones|uav)\b/i, category: /drone/i },
  { pattern: /\b(grip|tripod|stand|support|rig)\b/i, category: /grip|support/i },
  { pattern: /\b(monitor|viewfinder|display)\b/i, category: /monitor|video/i },
  { pattern: /\b(battery|batteries|charger|media|card)\b/i, category: /accessor|power|media/i },
];

function inferCategory(query: string, categories: Category[]) {
  const normalized = query.toLowerCase();
  const direct = categories.find((item) => {
    const name = item.name.toLowerCase();
    return normalized.includes(name) || name.split(/[^a-z0-9]+/).some((word) =>
      word.length > 2 && new RegExp("\\b" + word + "\\b", "i").test(normalized),
    );
  });
  if (direct) return direct.name;

  const hint = categoryHints.find((item) => item.pattern.test(normalized));
  return hint ? categories.find((item) => hint.category.test(item.name))?.name : undefined;
}


import { BookingPanel } from "@/components/booking/BookingPanel";
import { pickRentalDates } from "@/lib/dateSelection";
import { IconX } from "@/components/icons";
import styles from "./HomeGearSearch.module.css";

function QuickBook({ listing, onClose }: { listing: GearListing; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  // Load the authoritative detail so display-only offers retain their request-only behaviour.
  const full = useQuery(api.catalog.getListingBySlug, { slug: listing.slug });
  useEffect(() => {
    const el = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    el.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { el.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} onCancel={onClose} className={styles.dialog} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="quick-book-title">
    <div className="p-5 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div><p className="hud-label text-accent-300">Choose your rental</p><h2 id="quick-book-title" className="mt-2 font-display text-xl font-semibold text-white">{listing.title}</h2></div>
        <button type="button" onClick={onClose} aria-label="Close rental selection" className="rounded-full bg-white/10 p-3 text-white"><IconX className="h-4 w-4" /></button>
      </div>
      <p className="mb-4 text-sm text-white/55">Pick dates and both times. Available gear is added to your kit automatically.</p>
      {full ? <BookingPanel listing={full} start={start} end={end} month={month} onMonthChange={setMonth} unavailable={new Set()} autoAdd onAdded={onClose} onPick={day => { const next = pickRentalDates(start, end, day); setStart(next.start); setEnd(next.end); }} /> : <p role="status">Loading rental options…</p>}
    </div>
  </dialog>;
}

/** Two layout modes share live matching; neither paints results over neighbouring tiles. */
export function HomeGearSearch({ categories, featured }: { categories: Category[]; featured?: GearListing[] }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [settledValue, setSettledValue] = useState("");
  const [selected, setSelected] = useState<GearListing | null>(null);
  const query = value.trim();
  useEffect(() => { const timer = window.setTimeout(() => setSettledValue(query), 280); return () => window.clearTimeout(timer); }, [query]);
  const category = useMemo(() => inferCategory(settledValue, categories), [settledValue, categories]);
  const result = useQuery(api.catalog.searchHomeGear, settledValue.length >= 2 ? { search: settledValue, category } : "skip");
  const [retainedResult, setRetainedResult] = useState<typeof result>();
  useEffect(() => { if (result) setRetainedResult(result); }, [result]);
  const displayedResult = result ?? retainedResult;
  const searching = query.length > 0;
  const loading = searching && (query !== settledValue || (query.length >= 2 && result === undefined));
  const listings = (featured ? searching ? query.length >= 2 && query === settledValue ? result?.listings ?? [] : [] : featured : displayedResult?.listings ?? []) as GearListing[];
  const input = <form onSubmit={event => event.preventDefault()} className={styles.inputShell} role="search">
    <IconSearch className="h-5 w-5 shrink-0 text-accent-300" aria-hidden />
    <input type="search" value={value} onChange={event => setValue(event.target.value)} placeholder="Search any item" aria-label={featured ? "Search most booked gear" : "Search rental gear"} aria-controls={id} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/45" />
    {searching ? <button type="button" onClick={() => setValue("")} aria-label="Clear gear search" className="rounded-full p-2 text-white/60 hover:bg-white/10"><IconX className="h-4 w-4" /></button> : <span className="rounded-full border border-accent-300/30 bg-accent-500/15 px-3 py-2 text-xs text-accent-200">Find your kit</span>}
  </form>;
  const status = searching && <p role="status" className="mb-4 text-sm text-white/55">{query.length < 2 ? "Type at least two characters to find gear." : loading ? "Finding the best matches…" : result?.mode === "category" ? `Closest matches in ${result.category}` : listings.length ? `${listings.length} matching items · gear hire rates shown` : "No exact match. Browse a department below or ask Gaffer."}</p>;
  const browse = searching && !loading && <div className="mb-4 flex flex-wrap gap-2">{(category ? categories.filter(c => c.name === category) : categories.slice(0, 6)).map(c => <Link key={c.name} href={`/gear?cat=${encodeURIComponent(c.name)}`} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/70">All {c.name} →</Link>)}</div>;
  if (featured) return <section className="section-window px-6 py-20"><div className="mx-auto max-w-7xl">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><div className="hud-label !text-accent-400/90">Most booked</div><h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">The kit crews <span className="serif-accent gradient-text">fight over</span></h2></div><div className="w-full max-w-[34rem]">{input}</div></div>
    <div id={id} className="mt-8" aria-label="Most booked gear results" aria-busy={loading}>{status}{browse}<div className="dim-grid rail flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">{listings.map(l => <div key={l._id} className="w-[240px] shrink-0 snap-start animate-[fade-in_.3s_ease-out] lg:w-auto"><GearCard listing={l} /></div>)}</div></div>
  </div></section>;
  return <div className={styles.root}>
    <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="hud-label text-accent-300">Your next shoot starts here</p><h2 className="mt-2 font-display text-2xl font-semibold text-white">Find it. Pick your time. Make it yours.</h2></div><div className="w-full max-w-[34rem]">{input}</div></div>
    <div className={styles.reveal} data-open={searching} id={id} aria-busy={loading} aria-hidden={!searching} inert={!searching}><div className={styles.results}>
      <div className="pt-6">{status}{browse}<div className="rail flex snap-x gap-4 overflow-x-auto pb-3" aria-label="Gear search results">{listings.map(l => <button key={l._id} type="button" onClick={() => setSelected(l)} className={styles.result} aria-label={`Choose rental times for ${l.title}`}>
        <SmartImage src={l.heroImage} fallbackSources={l.imageSources} alt={l.title} fit="contain" className="h-36 w-full" />
        <span className="mt-4 block line-clamp-2 text-sm font-semibold text-white">{l.title}</span><span className="mt-2 block text-xs text-white/45">{l.category}</span><span className="mt-3 flex items-center justify-between text-sm text-accent-200">{money(l.pricing.daily)}/day <IconArrowRight className="h-4 w-4" /></span>
      </button>)}</div></div>
    </div></div>
    {selected && <QuickBook key={selected._id} listing={selected} onClose={() => setSelected(null)} />}
  </div>;
}
