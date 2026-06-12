"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { IconSliders, IconSearch } from "@/components/icons";
import { CategoryIcon } from "@/components/CategoryIcon";
import { PageHero } from "@/components/PageHero";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { GearCard } from "@/components/GearCard";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { getSessionId } from "@/lib/session";

function GearPageInner() {
  const params = useSearchParams();
  const [cat, setCat] = useState(() => params.get("cat") ?? "All");
  const [search, setSearch] = useState("");

  const cats = useQuery(api.catalog.categories) ?? [];
  const best = useQuery(api.catalog.bestSellers, { limit: 6 }) ?? [];
  const listings =
    useQuery(api.catalog.listListings, {
      category: cat === "All" ? undefined : cat,
      search: search || undefined,
    }) ?? undefined;

  const total = cats.reduce((n, c) => n + c.count, 0);
  const tabs = [{ name: "All", count: total }, ...cats];

  // log searches that return nothing (demand signal for the owner dashboard)
  const track = useMutation(api.analytics.track);
  useEffect(() => {
    const q = search.trim();
    if (!q || listings === undefined) return;
    if (listings.length === 0) {
      const t = setTimeout(
        () => track({ type: "search_no_results", path: q, sessionId: getSessionId() }).catch(() => {}),
        700,
      );
      return () => clearTimeout(t);
    }
  }, [search, listings, track]);

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto min-h-screen max-w-7xl px-6 py-12">
        <PageHero
          eyebrow="The catalogue"
          lead="Rent"
          accent="cinema gear"
          sub="Professional cameras, lenses, lighting, audio and more. Daily, 3-day and 7-day rates. Delivered across London."
        />

        <Link
          href="/assemble"
          className="spot border-beam press group mt-8 flex items-center gap-4 rounded-2xl p-4 sm:p-5"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 transition-colors group-hover:bg-accent-500/20">
            <IconSliders className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display font-semibold text-white/90">AI item assembly</span>
            <span className="mt-0.5 block text-sm text-white/40">
              Tell us the shoot — we build the kit, priced for your dates.
            </span>
          </span>
          <span className="arrow-link hidden text-sm text-accent-400 sm:block">
            Build your kit <span className="arrow">→</span>
          </span>
        </Link>

        {/* sticky toolbar: search + category tabs */}
        <div className="sticky top-[57px] z-30 -mx-6 mt-8 border-b border-white/[0.06] bg-[#060608]/95 px-6 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative w-full max-w-md">
              <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search gear…"
                className="input w-full rounded-full !pl-11"
              />
            </div>
            <div className="rail flex gap-2 overflow-x-auto lg:flex-wrap">
              {tabs.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setCat(t.name)}
                  className={`ci-host flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition-all ${
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
                  {t.name}{" "}
                  <span className="font-mono text-xs opacity-60">{t.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* best sellers (data-driven) — only on All, no search */}
        {cat === "All" && !search && best.length > 0 && (
          <section className="mt-8">
            <h2 className="flex items-center gap-3 font-display text-lg font-semibold text-white/85">
              <span className="hud-label !text-accent-400/90">Best sellers</span>
              <span className="h-px flex-1 bg-white/[0.07]" aria-hidden />
            </h2>
            <div className="dim-grid mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
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
        {listings === undefined ? (
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
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
        ) : listings.length === 0 ? (
          <div className="mt-20 text-center">
            <div className="hud-label">No matches</div>
            <p className="mt-3 text-white/40">Nothing matches that search.</p>
            <button
              onClick={() => {
                setSearch("");
                setCat("All");
              }}
              className="btn-ghost mt-5 px-6 py-2.5 text-sm"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="dim-grid mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {listings.map((l, i) => (
              <Reveal key={l._id} delay={Math.min(i, 8) * 50}>
                <GearCard listing={l} />
              </Reveal>
            ))}
          </div>
        )}
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
