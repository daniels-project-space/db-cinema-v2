"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { GearCard } from "@/components/GearCard";
import { SiteHeader } from "@/components/SiteHeader";

export default function GearPage() {
  const [cat, setCat] = useState("All");
  const [search, setSearch] = useState("");

  const cats = useQuery(api.catalog.categories) ?? [];
  const listings =
    useQuery(api.catalog.listListings, {
      category: cat === "All" ? undefined : cat,
      search: search || undefined,
    }) ?? undefined;

  const total = cats.reduce((n, c) => n + c.count, 0);
  const tabs = [{ name: "All", count: total }, ...cats];

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
              }`}
            >
              {t.name}{" "}
              <span className="text-xs opacity-60">{t.count}</span>
            </button>
          ))}
        </div>

        {/* grid */}
        {listings === undefined ? (
          <div className="mt-16 text-center text-white/30">Loading gear…</div>
        ) : listings.length === 0 ? (
          <div className="mt-16 text-center text-white/30">
            Nothing matches that search.
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {listings.map((l) => (
              <GearCard key={l._id} listing={l} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
