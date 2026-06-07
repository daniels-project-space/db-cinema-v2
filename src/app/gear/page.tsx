"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { GearCard } from "@/components/GearCard";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { getSessionId } from "@/lib/session";

export default function GearPage() {
  const [cat, setCat] = useState("All");
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
        <div className="mb-2 text-xs uppercase tracking-widest text-accent-400">
          The catalogue
        </div>
        <h1 className="font-display text-4xl font-bold tracking-tight text-white/90">
          Rent <span className="gradient-text">cinema gear</span>
        </h1>
        <p className="mt-2 max-w-xl text-white/40">
          Professional cameras, lenses, lighting, audio and more. Daily, 3-day
          and 7-day rates. Delivered across London.
        </p>

        <Link
          href="/assemble"
          className="glow press mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-accent-500 to-indigo-500 px-6 py-3 font-medium text-white"
        >
          ✨ AI Item Assembly — build my kit
        </Link>

        {/* search */}
        <div className="mt-8">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search gear…"
            className="w-full max-w-md rounded-full glass border border-white/10 bg-white/[0.02] px-5 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30 focus:border-accent-400/40"
          />
        </div>

        {/* category tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.name}
              onClick={() => setCat(t.name)}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                cat === t.name
                  ? "bg-accent-500 text-white"
                  : "glass text-white/50 hover:text-white"
              } ${
                t.name === "Packages"
                  ? "ring-1 ring-amber-400/70 shadow-[0_0_14px_-4px_rgba(251,191,36,0.7)]"
                  : ""
              }`}
            >
              {t.name === "Packages" && <span className="mr-1">📦</span>}
              {t.name}{" "}
              <span className="text-xs opacity-60">{t.count}</span>
            </button>
          ))}
        </div>

        {/* best sellers (data-driven) — only on All, no search */}
        {cat === "All" && !search && best.length > 0 && (
          <section className="mt-8">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-white/85">
              🔥 Best sellers
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
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
              <div key={i} className="overflow-hidden rounded-2xl glass">
                <div className="shimmer aspect-[4/3] bg-charcoal-800" />
                <div className="space-y-2 p-4">
                  <div className="shimmer h-3 w-1/3 rounded bg-charcoal-800" />
                  <div className="shimmer h-3 w-2/3 rounded bg-charcoal-800" />
                  <div className="shimmer h-5 w-1/4 rounded bg-charcoal-800" />
                </div>
              </div>
            ))}
          </div>
        ) : listings.length === 0 ? (
          <div className="mt-16 text-center text-white/30">
            Nothing matches that search.
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
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
