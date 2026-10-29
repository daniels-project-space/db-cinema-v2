"use client";

import { useEffect, useMemo, useRef, useState, useId } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SmartImage } from "@/components/SmartImage";
import { IconArrowRight, IconSearch } from "@/components/icons";
import { GearCard, type GearListing } from "@/components/GearCard";
import { money } from "@/lib/pricing";

import { gearSearchIntent, type SearchDepartment as Category } from "@/lib/gearSearchIntent";
import { CategoryIcon } from "@/components/CategoryIcon";

type SearchResult = { mode: string; category: string | null; categories: string[]; listings: GearListing[]; failed: boolean };

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
  const intent = useMemo(() => gearSearchIntent(settledValue, categories), [settledValue, categories]);
  const requests = useMemo(() => {
    if (settledValue.length < 2) return {};
    const departments: (string | undefined)[] = intent.categories.length ? intent.categories.slice(0, 4) : [undefined];
    return Object.fromEntries(departments.map((category, index) => [String(index), {
      query: api.catalog.searchHomeGear,
      args: { search: intent.search || category || settledValue, ...(category ? { category } : {}) },
    }]));
  }, [settledValue, intent]);
  const responses = useQueries(requests);
  const result = useMemo<SearchResult | undefined>(() => {
    const groups = Object.values(responses);
    if (!groups.length || groups.some(group => group === undefined)) return undefined;
    const good = groups.filter(group => !(group instanceof Error));
    const listings: GearListing[] = [];
    // Interleave departments so a camera enquiry cannot crowd audio out.
    for (let index = 0; index < 8; index++) for (const group of good) {
      const item = group.listings?.[index] as GearListing | undefined;
      if (item && !listings.some(listing => listing._id === item._id) && listings.length < 8) listings.push(item);
    }
    return { mode: intent.categoryOnly || good.some(group => group.mode === "category") ? "category" : "matches", category: intent.categories[0] ?? good[0]?.category ?? null, categories: intent.categories, listings, failed: good.length !== groups.length };
  }, [responses, intent]);
  const [retainedResult, setRetainedResult] = useState<SearchResult>();
  useEffect(() => { if (result) setRetainedResult(previous => JSON.stringify(previous) === JSON.stringify(result) ? previous : result); }, [result]);
  const displayedResult = result ?? retainedResult;
  const searching = query.length > 0;
  const loading = searching && (query !== settledValue || (query.length >= 2 && result === undefined));
  const listings = (featured ? searching ? query.length >= 2 && query === settledValue ? result?.listings ?? [] : [] : featured : displayedResult?.listings ?? []) as GearListing[];
  const showDetails = searching || (!featured && listings.length > 0);
  const browseCategories = displayedResult?.categories.length ? displayedResult.categories : displayedResult?.category ? [displayedResult.category] : [];
  const input = <form onSubmit={event => event.preventDefault()} className={styles.inputShell} role="search">
    <IconSearch className="h-5 w-5 shrink-0 text-accent-300" aria-hidden />
    <input type="search" value={value} onChange={event => setValue(event.target.value)} placeholder="Search gear, categories or abbreviations" aria-label={featured ? "Search most booked gear" : "Search rental gear"} aria-controls={id} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/45" />
    {searching ? <button type="button" onClick={() => setValue("")} aria-label="Clear gear search" className="rounded-full p-2 text-white/60 hover:bg-white/10"><IconX className="h-4 w-4" /></button> : <span className="rounded-full border border-accent-300/30 bg-accent-500/15 px-3 py-2 text-xs text-accent-200">Find your kit</span>}
  </form>;
  const status = showDetails && <p role="status" className="mb-4 text-sm text-white/55">{searching && query.length < 2 ? "Type at least two characters to find gear." : loading ? "Finding the best matches…" : displayedResult?.failed ? "Some matches couldn’t load. Browse a department below or try again." : displayedResult?.mode === "category" ? `Explore ${browseCategories.join(" + ") || "matching gear"} · popular picks below` : listings.length ? `${listings.length} matching items${browseCategories.length ? ` · ${browseCategories.join(" + ")}` : ""} · gear hire rates shown` : "No exact match. Browse a department below or ask Gaffer."}</p>;
  const browse = showDetails && !loading && <nav aria-label="Matching gear departments" className="mb-5 flex flex-wrap gap-2">{(browseCategories.length ? browseCategories.map(name => categories.find(item => item.name === name)).filter((item): item is Category => !!item) : categories.slice(0, 6)).map(category => <Link key={category.name} href={`/gear?cat=${encodeURIComponent(category.name)}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent-300/25 bg-accent-500/[0.08] px-4 py-2 text-sm text-white/85 transition-colors hover:border-accent-300/60 hover:bg-accent-500/20"><CategoryIcon name={category.name} className="h-5 w-5 text-accent-300" /><span>{category.name}</span><span className="text-xs text-white/40">{category.count}</span><IconArrowRight className="h-3.5 w-3.5 text-accent-300" /></Link>)}</nav>;
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
