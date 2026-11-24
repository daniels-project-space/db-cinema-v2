"use client";

import { useEffect, useMemo, useRef, useState, useId, type KeyboardEvent } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SmartImage } from "@/components/SmartImage";
import { IconArrowRight, IconSearch } from "@/components/icons";
import { GearCard, type GearListing } from "@/components/GearCard";
import { formatRate } from "@/lib/pricing";

import { gearSearchIntent, type SearchDepartment as Category } from "@/lib/gearSearchIntent";
import { CategoryIcon } from "@/components/CategoryIcon";

type SearchResult = { mode: string; category: string | null; categories: string[]; listings: GearListing[]; failed: boolean };

function handleSearchCarouselKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const carousel = event.currentTarget;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (event.key === "Home") carousel.scrollTo({ left: 0, behavior: smooth ? "smooth" : "auto" });
  else if (event.key === "End") carousel.scrollTo({ left: carousel.scrollWidth, behavior: smooth ? "smooth" : "auto" });
  else carousel.scrollBy({ left: Math.max(180, carousel.clientWidth * 0.75) * (event.key === "ArrowRight" ? 1 : -1), behavior: smooth ? "smooth" : "auto" });
  event.preventDefault();
}

import { BookingPanel } from "@/components/booking/BookingPanel";
import { pickRentalDates } from "@/lib/dateSelection";
import { IconX } from "@/components/icons";
import styles from "./HomeGearSearch.module.css";
import { useCatalogRevisionRefresh } from "./useCatalogRevisionRefresh";
import { HOME_GEAR_CATEGORY_EVENT } from "@/lib/homeGearSearchEvents";

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
      <p className="mb-4 text-sm text-white/55">Pick your dates and times, then choose “Add to kit” when you’re ready.</p>
      {full ? <BookingPanel listing={full} start={start} end={end} month={month} onMonthChange={setMonth} unavailable={new Set()} onAdded={onClose} onPick={day => { const next = pickRentalDates(start, end, day); setStart(next.start); setEnd(next.end); }} onEndChange={setEnd} /> : <p role="status">{full === null ? "This item is no longer available. Please choose another item." : "Loading rental options…"}</p>}
    </div>
  </dialog>;
}

/** Two layout modes share live matching; neither paints results over neighbouring tiles. */
export function HomeGearSearch({ categories, featured, initialRevision }: { categories: Category[]; featured?: GearListing[]; initialRevision?: string | null }) {
  const id = useId();
  const { stale: catalogStale, refresh: refreshCatalog } = useCatalogRevisionRefresh(initialRevision);
  const [value, setValue] = useState("");
  const [settledValue, setSettledValue] = useState("");
  const [placeholderText, setPlaceholderText] = useState("");
  const [placeholderVisible, setPlaceholderVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [selected, setSelected] = useState<GearListing | null>(null);
  const query = value.trim();
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (featured) return;
    const selectCategory = (event: Event) => {
      const category = (event as CustomEvent<{ category?: unknown }>).detail?.category;
      if (typeof category !== "string" || !categories.some(item => item.name === category)) return;
      setValue(category);
      const target = document.getElementById("home-gear-search");
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      window.requestAnimationFrame(() => target?.scrollIntoView({ behavior, block: "start" }));
    };
    window.addEventListener(HOME_GEAR_CATEGORY_EVENT, selectCategory);
    return () => window.removeEventListener(HOME_GEAR_CATEGORY_EVENT, selectCategory);
  }, [featured, categories]);
  useEffect(() => { const timer = window.setTimeout(() => setSettledValue(query), 280); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => {
    if (featured || value.length > 0) {
      setPlaceholderVisible(false);
      setPlaceholderText("");
      return;
    }
    const examples = ["Sony FX3 kits", "Blackmagic 6K kits", "cinema lenses", "lighting for interviews"];
    if (reduceMotion) {
      setPlaceholderText(examples[0]);
      setPlaceholderVisible(true);
      return;
    }
    let phraseIndex = 0;
    let characterIndex = 0;
    let timer = 0;
    let cancelled = false;
    const showNextPhrase = () => {
      const phrase = examples[phraseIndex];
      characterIndex = 0;
      setPlaceholderText("");
      setPlaceholderVisible(true);
      const typeNextCharacter = () => {
        if (cancelled) return;
        characterIndex += 1;
        setPlaceholderText(phrase.slice(0, characterIndex));
        if (characterIndex >= phrase.length) {
          timer = window.setTimeout(() => {
            setPlaceholderVisible(false);
            timer = window.setTimeout(() => {
              if (cancelled) return;
              setPlaceholderVisible(true);
              phraseIndex = (phraseIndex + 1) % examples.length;
              showNextPhrase();
            }, 280);
          }, 1350);
          return;
        }
        timer = window.setTimeout(typeNextCharacter, 48);
      };
      timer = window.setTimeout(typeNextCharacter, 420);
    };
    showNextPhrase();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [featured, value, reduceMotion]);
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
  const listings = (catalogStale ? [] : featured ? searching ? query.length >= 2 && query === settledValue ? result?.listings ?? [] : [] : featured : searching && (query.length < 2 || loading) ? [] : displayedResult?.listings ?? []) as GearListing[];
  const showDetails = searching || (!featured && listings.length > 0);
  const browseCategories = displayedResult?.categories.length ? displayedResult.categories : displayedResult?.category ? [displayedResult.category] : [];
  const input = <form onSubmit={event => event.preventDefault()} className={styles.inputShell} role="search">
    <IconSearch className="h-5 w-5 shrink-0 text-accent-300" aria-hidden />
    <div className="relative min-w-0 flex-1">
      <input type="search" value={value} onChange={event => setValue(event.target.value)} placeholder={placeholderVisible ? "" : "Search gear or categories"} aria-label={featured ? "Search featured rental gear" : "Search rental gear"} aria-controls={id} className="w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-white/45" />
      {!featured && <span aria-hidden="true" className={`${styles.examplePlaceholder} ${placeholderVisible && !value ? styles.examplePlaceholderVisible : ""}`}>{placeholderText}<span className={styles.exampleCursor} /></span>}
    </div>
    {searching ? <button type="button" onClick={() => setValue("")} aria-label="Clear gear search" className="grid min-h-11 min-w-11 place-items-center rounded-full p-2 text-white/60 hover:bg-white/10"><IconX className="h-4 w-4" /></button> : !featured && <Link href="/gear#ai-item-assembly" aria-label="Have AI assemble your kit" className="group/ai inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-accent-300/35 bg-accent-400/10 px-2.5 py-2 text-xs font-medium text-accent-100 transition hover:border-accent-200/70 hover:bg-accent-300/20 hover:text-white sm:gap-2 sm:px-3"><svg className="h-3.5 w-3.5 shrink-0 text-accent-200 transition-transform duration-300 group-hover/ai:rotate-12 group-hover/ai:scale-110 sm:h-4 sm:w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m10 1.8 1.45 5.1 5.1 1.45-5.1 1.45L10 14.9l-1.45-5.1-5.1-1.45 5.1-1.45L10 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="m16 13.1.66 2.23 2.24.67-2.24.66L16 18.9l-.66-2.23-2.24-.66 2.24-.67L16 13.1Z" fill="currentColor"/></svg><span>Have AI assemble your kit</span></Link>}
  </form>;
  const quickBrowse = !featured && !searching && categories.length > 0 && <nav aria-label="Browse gear categories" className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{categories.slice(0, 4).map(category => <button key={category.name} type="button" aria-pressed={query === category.name} onClick={() => setValue(category.name)} className="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-left text-xs text-white/75 transition-colors hover:border-accent-300/45 hover:text-white aria-pressed:border-accent-300/45 aria-pressed:bg-accent-400/10"><CategoryIcon name={category.name} className="h-4 w-4 shrink-0 text-accent-300" /><span className="min-w-0 flex-1 truncate">{category.name}</span><span className="shrink-0 text-[10px] text-white/35">{category.count}</span></button>)}</nav>;
  const status = showDetails && <p role="status" className="mb-4 text-sm text-white/55">{searching && query.length < 2 ? "Type at least two characters to find gear." : loading ? "Finding the best matches…" : displayedResult?.failed ? "Some matches couldn’t load. Browse a department below or try again." : displayedResult?.mode === "category" ? `Explore ${browseCategories.join(" + ") || "matching gear"} · popular picks below` : listings.length ? `${listings.length} matching items${browseCategories.length ? ` · ${browseCategories.join(" + ")}` : ""} · gear hire rates shown` : "No exact match. Browse a department below or ask Gaffer."}</p>;
  const browse = showDetails && !loading && (!searching || query.length >= 2) && <nav aria-label="Matching gear departments" className="mb-5 flex flex-wrap gap-2">{(browseCategories.length ? browseCategories.map(name => categories.find(item => item.name === name)).filter((item): item is Category => !!item) : categories.slice(0, 6)).map(category => <button key={category.name} type="button" aria-pressed={query === category.name} onClick={() => setValue(category.name)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent-300/25 bg-accent-500/[0.08] px-4 py-2 text-sm text-white/85 transition-colors hover:border-accent-300/60 hover:bg-accent-500/20 aria-pressed:border-accent-300/60 aria-pressed:bg-accent-500/20"><CategoryIcon name={category.name} className="h-5 w-5 text-accent-300" /><span>{category.name}</span><span className="text-xs text-white/40">{category.count}</span><IconArrowRight className="h-3.5 w-3.5 text-accent-300" /></button>)}</nav>;
  if (featured) return <section className="section-window px-6 py-20"><div className="mx-auto max-w-7xl">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><div className="hud-label !text-accent-400/90">Featured rental gear</div><h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">The kit crews <span className="serif-accent gradient-text">fight over</span></h2></div><div className={styles.searchField}>{input}</div></div>
    <div id={id} className="mt-8" role="region" aria-label="Featured rental gear results" aria-busy={loading || catalogStale}>{catalogStale && <p role="status" className="mb-4 text-sm text-white/55">The catalogue changed. Refreshing current equipment… <button type="button" onClick={refreshCatalog} className="underline">Retry</button></p>}{status}{browse}<div className="dim-grid rail flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-300 focus-visible:outline-offset-2 lg:grid lg:grid-cols-4 lg:overflow-visible" role="region" aria-roledescription="carousel" aria-label="Featured rental gear carousel" tabIndex={0} onKeyDown={handleSearchCarouselKeyDown}>{listings.map(l => <div key={l._id} className="w-[240px] shrink-0 snap-start animate-[fade-in_.3s_ease-out] lg:w-auto"><GearCard listing={l} /></div>)}</div></div>
  </div></section>;
  return <div id="home-gear-search" className={`${styles.root} scroll-mt-24`}>
    <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="hud-label text-accent-300">Your next shoot starts here</p><h2 className="mt-2 font-display text-2xl font-semibold text-white">Find it. Pick your time. Make it yours.</h2></div><div className={styles.searchField}>{input}{quickBrowse}</div></div>
    <div className={styles.reveal} data-open={searching} id={id} role="region" aria-label="Gear search results" aria-busy={loading} aria-hidden={!searching} inert={!searching}><div className={styles.results}>
      <div className="pt-6">{status}{browse}<div className="rail flex snap-x gap-4 overflow-x-auto pb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-300 focus-visible:outline-offset-2" role="region" aria-roledescription="carousel" aria-label="Gear search results carousel" tabIndex={0} onKeyDown={handleSearchCarouselKeyDown}>{listings.map(l => l.bookable === false ? <Link key={l._id} href={`/gear/${l.slug}`} className={styles.result} aria-label={`View ${l.title}`}>
        <SmartImage src={l.heroImage} fallbackSources={l.imageSources} alt={l.title} fit="contain" className="h-36 w-full" />
        <span className="mt-4 block line-clamp-2 text-sm font-semibold text-white">{l.title}</span><span className="mt-2 block text-xs text-white/45">{l.category}</span><span className="mt-3 flex items-center justify-between gap-2 text-sm text-sky-200"><span>{l.marketingOnly || l.displayOnly ? "Display only" : "Browse alternatives"}</span><IconArrowRight className="h-4 w-4 shrink-0" /></span>
      </Link> : <button key={l._id} type="button" onClick={() => setSelected(l)} className={styles.result} aria-label={`Choose rental times for ${l.title}`}>
        <SmartImage src={l.heroImage} fallbackSources={l.imageSources} alt={l.title} fit="contain" className="h-36 w-full" />
        <span className="mt-4 block line-clamp-2 text-sm font-semibold text-white">{l.title}</span><span className="mt-2 block text-xs text-white/45">{l.category}</span><span className="mt-3 flex items-center justify-between text-sm text-accent-200">£{formatRate(l.pricing.daily)}/day <IconArrowRight className="h-4 w-4" /></span>
      </button>)}</div></div>
    </div></div>
    {selected && <QuickBook key={selected._id} listing={selected} onClose={() => setSelected(null)} />}
  </div>;
}
