"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { BookingPanel } from "@/components/booking/BookingPanel";
import { Recommendations } from "@/components/Recommendations";
import { SmartImage } from "@/components/SmartImage";
import { addDaysIso, daysInclusive } from "@/components/booking/Calendar";

function expandUnavailable(raw: string[]): Set<string> {
  const set = new Set<string>();
  for (const e of raw) {
    if (/^\d{4}-\d{2}-\d{2}/.test(e)) {
      set.add(e.slice(0, 10));
      continue;
    }
    try {
      const o = JSON.parse(e);
      const from = o.from ?? o.start ?? o.date;
      const to = o.to ?? o.end ?? from;
      if (from) {
        let cur = String(from).slice(0, 10);
        const last = String(to).slice(0, 10);
        for (let i = 0; i < 400 && cur <= last; i++) {
          set.add(cur);
          cur = addDaysIso(cur, 1);
        }
      }
    } catch {}
  }
  return set;
}

export default function GearDetailClient({ slug }: { slug: string }) {
  const listing = useQuery(api.catalog.getListingBySlug, { slug });

  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });

  function pick(iso: string) {
    if (!start || (start && end)) {
      setStart(iso);
      setEnd(null);
    } else if (iso < start) {
      setStart(iso);
    } else {
      setEnd(iso);
    }
  }

  const unavailable = useMemo(
    () => expandUnavailable(listing?.unavailableDates ?? []),
    [listing?.unavailableDates],
  );
  const days = start && end ? daysInclusive(start, end) : 0;

  if (listing === undefined)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-7xl px-6 py-20 text-white/30">Loading…</main>
      </>
    );
  if (listing === null)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-7xl px-6 py-20 text-center text-white/40">
          Not found.{" "}
          <Link href="/gear" className="text-accent-400 hover:underline">
            Back to gear
          </Link>
        </main>
      </>
    );

  const gallery = listing.gallery.length
    ? listing.gallery
    : ([listing.heroImage].filter(Boolean) as string[]);
  const k: any = (listing as any).knowledge ?? {};

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-7xl px-6 py-10">
        <Link href="/gear" className="text-sm text-white/40 transition-colors hover:text-white">
          ← All gear
        </Link>
        <div className="mt-6 grid gap-10 lg:grid-cols-2">
          {/* gallery + copy */}
          <div>
            <SmartImage src={gallery[0]} alt={listing.title} className="aspect-[4/3] rounded-2xl" />
            {gallery.length > 1 && (
              <div className="mt-3 grid grid-cols-4 gap-3">
                {gallery.slice(1, 5).map((g, i) => (
                  <SmartImage key={i} src={g} className="aspect-square rounded-lg" />
                ))}
              </div>
            )}
            <span className="mt-6 block text-xs uppercase tracking-[0.3em] text-accent-400">
              {listing.category}
            </span>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-white/90">
              {listing.title}
            </h1>
            <p className="mt-4 text-balance leading-relaxed text-white/60">
              {k.summary ||
                `Professional ${listing.category.toLowerCase()} for hire in London. Pick your dates and the longer you rent, the better the per-day rate. Delivered across London or collect central.`}
            </p>

            {Array.isArray(k.features) && k.features.length > 0 && (
              <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {k.features.slice(0, 6).map((f: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-white/65">
                    <span className="mt-0.5 text-accent-400">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}

            {(k.bestFor?.length || k.tips?.length || k.limits?.length) && (
              <div className="mt-6 space-y-4 rounded-2xl glass p-5 text-sm">
                {k.bestFor?.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-white/40">Best for</div>
                    <div className="mt-1 capitalize text-white/70">{k.bestFor.join("  ·  ")}</div>
                  </div>
                )}
                {k.tips?.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-white/40">Pro tips</div>
                    <ul className="mt-1 space-y-1 text-white/65">
                      {k.tips.slice(0, 3).map((t: string, i: number) => (
                        <li key={i} className="flex gap-2"><span className="text-accent-400">›</span>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {k.limits?.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-white/40">Good to know</div>
                    <ul className="mt-1 space-y-1 text-white/55">
                      {k.limits.slice(0, 3).map((t: string, i: number) => (
                        <li key={i} className="flex gap-2"><span className="text-amber-400/80">!</span>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* booking */}
          <div>
            <BookingPanel
              listing={listing as any}
              start={start}
              end={end}
              month={month}
              onPick={pick}
              onMonthChange={setMonth}
              unavailable={unavailable}
            />
          </div>
        </div>

        <Recommendations slug={listing.slug} start={start} end={end} days={days} />
      </main>
    </>
  );
}
