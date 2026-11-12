"use client";

import { Suspense, useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGafferFocus } from "@/components/gaffer/GafferFocus";
import { IconSearch } from "@/components/icons";
import { AssemblyShowcase } from "@/components/AssemblyShowcase";
import { CategoryIcon } from "@/components/CategoryIcon";
import { GearLoopBanner } from "@/components/GearLoopBanner";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { GearCard, type GearListing } from "@/components/GearCard";
import { HireProfessionals } from "@/components/HireProfessionals";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { getSessionId } from "@/lib/session";

/** Both spellings are in the wild: links use ?cat / ?q, Gaffer's navigate_to
 *  pushes ?category / ?search. Accept either rather than silently ignoring one. */
const catParam = (p: URLSearchParams) => p.get("cat") ?? p.get("category");
const qParam = (p: URLSearchParams) => p.get("q") ?? p.get("search");

const BRAND_MATCHERS = [
  ["ARRI", ["arri"]],
  ["Aputure", ["aputure"]],
  ["Atomos", ["atomos"]],
  ["BeamZ", ["beamz"]],
  ["Blackmagic", ["blackmagic"]],
  ["Blazar", ["blazar"]],
  ["Canon", ["canon"]],
  ["DJI", ["dji"]],
  ["DZOFILM", ["dzofilm"]],
  ["Fxlion", ["fxlion"]],
  ["Godox", ["godox"]],
  ["GoPro", ["gopro", "go pro"]],
  ["Hollyland", ["hollyland"]],
  ["JBL", ["jbl"]],
  ["K&F Concept", ["k&f", "k and f"]],
  ["Lexar", ["lexar"]],
  ["Nanlite", ["nanlite"]],
  ["Nanlux", ["nanlux"]],
  ["Nikon", ["nikon"]],
  ["Panasonic", ["panasonic"]],
  ["Pioneer", ["pioneer"]],
  ["RØDE", ["rode"]],
  ["Sennheiser", ["sennheiser"]],
  ["Shure", ["shure"]],
  ["Sigma", ["sigma"]],
  ["SmallHD", ["smallhd"]],
  ["SmallRig", ["smallrig"]],
  ["Sony", ["sony"]],
  ["Tascam", ["tascam"]],
  ["Tilta", ["tilta"]],
  ["Vaxis", ["vaxis"]],
  ["Zoom", ["zoom"]],
  ["Other", []],
] as const;

const normalizeBrandText = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[øØ]/g, "o").toLowerCase();

function brandForTitle(title: string) {
  const searchable = normalizeBrandText(title).replace(
    /^(?:(?:\d+\s*[x×]\s*)|(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+)/i,
    "",
  );
  const match = BRAND_MATCHERS.find(([, aliases]) => aliases.some((alias) => searchable.startsWith(normalizeBrandText(alias))));
  return match?.[0] ?? "Other";
}

const isPackageListing = (listing: GearListing) =>
  listing.isPackage ?? listing.category.toLowerCase() === "packages";

function GearPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { suggestedIds } = useGafferFocus();
  const [cat, setCat] = useState(() => catParam(params) ?? "All");
  const [search, setSearch] = useState(() => qParam(params) ?? "");
  const [brandFilter, setBrandFilter] = useState("all");
  const [maxDailyPrice, setMaxDailyPrice] = useState("");
  const [packageFilter, setPackageFilter] = useState("all");
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Gaffer filters this page by pushing a new URL. Without this the page is
  // already mounted, so the initialisers above never run again and the grid
  // ignores it — which is why voice-driven filtering did nothing before.
  //
  // When either param is present the URL owns BOTH: a push of "?q=sigma" with no
  // category has to clear a category left over from the last push, or the search
  // is silently narrowed to whatever was on screen before and comes back empty.
  const urlCat = catParam(params);
  const urlQ = qParam(params);
  useEffect(() => {
    setCat(urlCat || "All");
    setSearch(urlQ ?? "");
    setBrandFilter("all");
    setMaxDailyPrice("");
    setPackageFilter("all");
  }, [urlCat, urlQ]);

  const cats = useQuery(api.catalog.categories) ?? [];
  const bestResults = useQuery(api.catalog.bestSellers, { limit: 6 });
  const best = bestResults ?? [];
  const filteredListings =
    useQuery(api.catalog.listListings, {
      category: cat === "All" ? undefined : cat,
      search: search || undefined,
    }) ?? undefined;
  // Voice matching understands model aliases and spoken requests; literal title
  // search does not. Render the actual returned picks on the voice shortlist.
  const shortlist = params.get("gaffer") === "1" && cat === (urlCat || "All") && search === (urlQ ?? "");
  const pickedListings = useQuery(api.catalog.listingsByIds,
    shortlist && suggestedIds.length ? { ids: suggestedIds as any } : "skip");
  const listings = shortlist && suggestedIds.length ? pickedListings : filteredListings;
  const route = "/gear" + (params.toString() ? `?${params.toString()}` : "");

  const total = cats.reduce((n, c) => n + c.count, 0);
  const tabs = [{ name: "All", count: total }, ...cats];
  const categoryRailRef = useRef<HTMLDivElement>(null);
  const [categoryRailEdges, setCategoryRailEdges] = useState({ overflow: false, moreLeft: false, moreRight: false });
  useEffect(() => {
    const rail = categoryRailRef.current;
    if (!rail) return;
    const updateEdges = () => {
      const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
      // Safari and Chromium can settle a snapping rail a couple of CSS pixels
      // away from zero/end. Treat that as the boundary so the fade does not
      // flicker while a user taps the first or last pill.
      const edgeTolerance = 4;
      const next = { overflow: maxScroll > edgeTolerance, moreLeft: rail.scrollLeft > edgeTolerance, moreRight: rail.scrollLeft < maxScroll - edgeTolerance };
      setCategoryRailEdges((current) => current.overflow === next.overflow && current.moreLeft === next.moreLeft && current.moreRight === next.moreRight ? current : next);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateEdges);
    observer?.observe(rail);
    rail.querySelectorAll("button").forEach((button) => observer?.observe(button));
    rail.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges, { passive: true });
    updateEdges();
    return () => {
      observer?.disconnect();
      rail.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, [tabs.length]);
  const brandOptions = useMemo(
    () => [...new Set((listings ?? []).map((listing) => brandForTitle(listing.title)))].sort((a, b) => a.localeCompare(b)),
    [listings],
  );
  const visibleListings = useMemo(() => (listings ?? []).filter((listing) => {
    if (brandFilter !== "all" && brandForTitle(listing.title) !== brandFilter) return false;
    if (maxDailyPrice && listing.pricing.daily > Number(maxDailyPrice)) return false;
    if (packageFilter === "packages" && !isPackageListing(listing)) return false;
    if (packageFilter === "individual" && isPackageListing(listing)) return false;
    return true;
  }), [listings, brandFilter, maxDailyPrice, packageFilter]);
  const hasRefinements = brandFilter !== "all" || !!maxDailyPrice || packageFilter !== "all";
  const hasActiveSelection = hasRefinements || !!search.trim() || cat !== "All";
  const activeRefinementCount = Number(brandFilter !== "all") + Number(!!maxDailyPrice) + Number(packageFilter !== "all");

  function clearFilters() {
    setSearch("");
    setCat("All");
    setBrandFilter("all");
    setMaxDailyPrice("");
    setPackageFilter("all");
    setShowMobileFilters(false);
    router.replace("/gear", { scroll: false });
  }

  // log searches that return nothing (demand signal for the owner dashboard)
  const track = useMutation(api.analytics.track);
  const recordedSearch = useRef<string | null>(null);
  useEffect(()=>{if(cat==="All")return;const timer=setTimeout(()=>{void track({type:"search_tag",path:cat,sessionId:getSessionId()}).catch(()=>{})},700);return()=>clearTimeout(timer)},[cat,track]);
  useEffect(() => {
    const q = search.trim();
    if (!q) { recordedSearch.current = null; return; }
    if (listings === undefined) return;
    const key = JSON.stringify([cat, q.toLowerCase()]);
    if (recordedSearch.current === key) return;
    const timer = setTimeout(() => {
      recordedSearch.current = key;
      void track({ type: "search", path: q, sessionId: getSessionId() }).catch(() => { if (recordedSearch.current === key) recordedSearch.current = null; });
      if (listings.length === 0) void track({ type: "search_no_results", path: q, sessionId: getSessionId() }).catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [cat, search, listings, track]);

  return (
    <>
      <SiteHeader />
      <GearLoopBanner
        motion
        compact
        mobileTight
        browseCompact
        sub="Cameras, lenses, lighting and audio for hire across London."
      />
      <main data-gaffer-route={route} data-gaffer-ready={listings !== undefined && cat === (urlCat || "All") && search === (urlQ ?? "")} className="section-window mx-auto flex min-h-screen min-w-0 max-w-7xl flex-col px-4 pb-12 pt-3 sm:px-6 sm:pt-8">
        <div className="order-5 px-2 lg:order-1 sm:px-4 xl:px-6">
          <AssemblyShowcase
            listings={[...best, ...(filteredListings ?? [])]}
            loading={bestResults === undefined || filteredListings === undefined}
          />
        </div>

        {/* hire professionals — crew for hire, booked through us (shows on every
            category so it's there when a category is clicked from the home page; hidden only on search) */}
        {!search && (
          <div className="order-6 lg:order-2">
          <>
            <HireProfessionals />
            <div className="mt-12 border-t border-white/5" />
          </>
          </div>
        )}

        {/* sticky toolbar: search + category tabs.
            id="gear-toolbar" is Gaffer's scroll target for a category browse
            with no single item to focus — see GafferFocus.scrollToId. Without
            it, filtering to a category and finding several matches left the
            customer still looking at the hero/assembly card up top, with the
            actual results a full screen below the fold. */}
        <div id="gear-toolbar" className="order-1 scroll-mt-24 -mx-4 mt-2 rounded-2xl border border-white/10 border-b border-white/[0.06] bg-white/[0.035] px-3 py-2 backdrop-blur-xl lg:order-3 sm:-mx-6 sm:mt-8 sm:px-6 sm:py-4">
          <div className="flex min-w-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-3">
            <div className="flex min-w-0 gap-2 sm:block sm:w-full sm:max-w-md">
            <div className="relative min-w-0 flex-1 sm:w-full sm:max-w-md sm:flex-none">
              <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search gear…"
                className="input h-11 w-full rounded-full !border-white/15 !bg-white/[0.04] !pl-11 shadow-inner focus:!border-accent-300/50"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowMobileFilters((open) => !open)}
              aria-expanded={showMobileFilters}
              aria-controls="gear-refinements"
              className="glass inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-xs font-semibold text-white/80 transition hover:border-accent-300/40 hover:text-white sm:hidden"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 5h14M3 10h14M3 15h14" />
                <circle cx="7" cy="5" r="1.5" className="fill-charcoal-950" />
                <circle cx="13" cy="10" r="1.5" className="fill-charcoal-950" />
                <circle cx="8" cy="15" r="1.5" className="fill-charcoal-950" />
              </svg>
              Filters
              {activeRefinementCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent-400 px-1 text-[10px] font-bold text-black">{activeRefinementCount}</span>}
            </button>
            </div>
            <div
              role="group"
              aria-label="Gear categories"
              aria-describedby="gear-category-scroll-hint"
              ref={categoryRailRef}
              onKeyDown={(event) => {
                if (!(["ArrowLeft", "ArrowRight", "Home", "End"] as const).includes(event.key as "ArrowLeft" | "ArrowRight" | "Home" | "End")) return;
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
                const currentIndex = buttons.indexOf(event.target as HTMLButtonElement);
                if (currentIndex < 0) return;
                const nextIndex = event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : Math.max(0, Math.min(buttons.length - 1, currentIndex + (event.key === "ArrowRight" ? 1 : -1)));
                const next = buttons[nextIndex];
                if (!next || next === event.target) return;
                event.preventDefault();
                next.focus({ preventScroll: true });
                next.scrollIntoView({
                  block: "nearest",
                  inline: "nearest",
                  behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
                });
              }}
              className={`rail gear-category-rail snap-x snap-proximity flex min-w-0 flex-nowrap touch-pan-x gap-1.5 overflow-x-auto overscroll-x-contain scroll-px-3 px-1 pr-4 py-1 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:scroll-px-0 sm:px-0 sm:py-0 ${categoryRailEdges.moreLeft ? "gear-category-rail--more-left" : ""} ${categoryRailEdges.moreRight ? "gear-category-rail--more-right" : ""}`}
            >
              <span id="gear-category-scroll-hint" className="sr-only sm:hidden">Swipe horizontally or use the arrow keys to reach every category.</span>
              {tabs.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setCat(t.name)}
                  aria-pressed={cat === t.name}
                  aria-label={`Browse ${t.name}, ${t.count} ${t.count === 1 ? "item" : "items"}`}
                  title={`${t.name} · ${t.count}`}
                  className={`ci-host snap-start flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:snap-align-none sm:gap-1.5 sm:px-4 sm:py-1.5 sm:text-sm ${
                    cat === t.name
                      ? "accent-glow bg-accent-500 text-white"
                      : "glass text-white/50 hover:text-white"
                  } ${
                    t.name === "Packages"
                      ? "ring-1 ring-amber-400/70 shadow-[0_0_14px_-4px_rgba(251,191,36,0.7)]"
                      : ""
                  }`}
                >
                  {t.name !== "All" && <CategoryIcon name={t.name} className="h-4 w-4" />}
                  <span className="sm:hidden">{{ Cameras: "Camera", Lenses: "Lens", Lighting: "Light", Packages: "Kits" }[t.name] ?? t.name}</span>
                  <span className="hidden sm:inline">{t.name}</span>{" "}
                  <span className="font-mono text-xs opacity-60">{t.count}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 sm:mt-4 sm:flex sm:flex-wrap sm:gap-3">
          <div id="gear-refinements" className={`${showMobileFilters ? "grid" : "hidden"} col-span-2 min-w-0 grid-cols-2 items-end gap-x-3 gap-y-2 sm:col-span-1 sm:flex sm:flex-wrap sm:gap-3`}>
            <label className="grid min-w-0 gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white/40">
              Brand
              <select
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
                aria-label="Filter gear by brand"
                className="input h-9 w-full min-w-0 rounded-full !bg-white/[0.04] text-sm normal-case tracking-normal text-white/80 sm:h-10 sm:w-auto sm:min-w-[145px]"
              >
                <option value="all">All brands</option>
                {brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
              </select>
            </label>
            <label className="grid min-w-0 gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white/40">
              Daily budget
              <select
                value={maxDailyPrice}
                onChange={(e) => setMaxDailyPrice(e.target.value)}
                aria-label="Filter by maximum daily rental price"
                className="input h-9 w-full min-w-0 rounded-full !bg-white/[0.04] text-sm normal-case tracking-normal text-white/80 sm:h-10 sm:w-auto sm:min-w-[155px]"
              >
                <option value="">Any daily rate</option>
                <option value="25">Up to £25/day</option>
                <option value="50">Up to £50/day</option>
                <option value="100">Up to £100/day</option>
                <option value="250">Up to £250/day</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white/40">
              Kit type
              <select
                value={packageFilter}
                onChange={(e) => setPackageFilter(e.target.value)}
                aria-label="Filter by kit type"
                className="input h-9 w-full min-w-0 rounded-full !bg-white/[0.04] text-sm normal-case tracking-normal text-white/80 sm:h-10 sm:w-auto sm:min-w-[155px]"
              >
                <option value="all">All gear</option>
                <option value="packages">Complete kits</option>
                <option value="individual">Individual items</option>
              </select>
            </label>
          </div>
          <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 border-t border-white/[0.06] pt-2 text-[11px] text-white/45 sm:col-span-1 sm:ml-auto sm:border-0 sm:pt-0 sm:pb-2 sm:text-xs">
            <div role="status" aria-live="polite" className="min-w-0">
              {listings === undefined
                ? "Loading gear…"
                : `${visibleListings.length} ${visibleListings.length === 1 ? "item" : "items"} ${hasRefinements ? "match these filters" : search.trim() ? "match your search" : cat !== "All" ? "in this category" : "in the catalogue"}`}
            </div>
            {hasActiveSelection && (
              <button type="button" onClick={clearFilters} aria-label="Reset gear search and filters" className="min-h-11 shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/65 transition hover:border-accent-300/40 hover:text-white sm:text-xs">
                Reset
              </button>
            )}
          </div>
          </div>
        </div>

        {/* best sellers (data-driven) — only on All, no search */}
        {cat === "All" && !search && !hasRefinements && best.length > 0 && (
        <section className="order-3 mt-10 hidden lg:order-4 lg:block">
            <h2 className="flex items-center gap-3 font-display text-lg font-semibold text-white/85">
              <span className="hud-label !text-accent-400/90">Best sellers</span>
              <span className="h-px flex-1 bg-white/[0.07]" aria-hidden />
            </h2>
            <div className="dim-grid mt-4 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
              {best.map((l, i) => (
                <Reveal key={l._id} delay={i * 40}>
                  <GearCard listing={l} />
                </Reveal>
              ))}
            </div>
            <div className="mt-8 border-t border-white/5" />
          </section>
        )}

        {/* grid */}
        <div className="order-4 lg:order-5">
        {listings === undefined ? (
          <div className="mt-8 grid grid-cols-1 gap-3 min-[600px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="glass overflow-hidden rounded-2xl">
                <div className="aspect-[4/3] animate-pulse bg-charcoal-800" />
                <div className="space-y-2 p-4">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-charcoal-800" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-charcoal-800" />
                  <div className="h-5 w-1/4 animate-pulse rounded bg-charcoal-800" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleListings.length === 0 ? (
          <div className="mt-20 text-center">
            <div className="hud-label">No matches</div>
            <p className="mt-3 text-white/40">Nothing matches that search.</p>
            <button
              type="button"
              onClick={clearFilters}
              className="btn-ghost mt-5 min-h-11 px-6 py-2.5 text-sm"
            >
              Reset search and filters
            </button>
          </div>
        ) : (
          <div className={`dim-grid mt-4 grid gap-3 sm:mt-8 sm:gap-4 ${visibleListings.length === 1 ? "mx-auto w-full max-w-3xl grid-cols-1" : "grid-cols-1 min-[600px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"}`}>
            {visibleListings.map((l, i) => (
              <Reveal key={l._id} delay={Math.min(i, 8) * 50}>
                <GearCard listing={l} mobileCompact priorityImage={i < 2} />
              </Reveal>
            ))}
          </div>
        )}
        </div>
      </main>
    </>
  );
}

export default function GearPage() {
  return (
    <Suspense fallback={null}>
      <GearPageInner />
    </Suspense>
  );
}
