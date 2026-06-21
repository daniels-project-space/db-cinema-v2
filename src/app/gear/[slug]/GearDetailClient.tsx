"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { getSessionId } from "@/lib/session";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { BookingPanel } from "@/components/booking/BookingPanel";
import { Recommendations } from "@/components/Recommendations";
import { SmartImage } from "@/components/SmartImage";
import { addDaysIso, daysInclusive } from "@/components/booking/Calendar";
import { IconCheck, IconChevronLeft } from "@/components/icons";

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
  const [imgIdx, setImgIdx] = useState(0);
  const [month, setMonth] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const track = useMutation(api.analytics.track);
  const [registered, setRegistered] = useState(false);

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
        <main className="mx-auto max-w-7xl px-6 py-10">
          <div className="h-4 w-24 animate-pulse rounded bg-charcoal-800" />
          <div className="mt-8 grid gap-10 lg:grid-cols-2">
            <div>
              <div className="aspect-[4/3] animate-pulse rounded-2xl bg-charcoal-800" />
              <div className="mt-6 h-3 w-1/4 animate-pulse rounded bg-charcoal-800" />
              <div className="mt-3 h-7 w-2/3 animate-pulse rounded bg-charcoal-800" />
              <div className="mt-4 h-3 w-full animate-pulse rounded bg-charcoal-800" />
            </div>
            <div className="h-96 animate-pulse rounded-2xl bg-charcoal-800/60" />
          </div>
        </main>
      </>
    );
  if (listing === null)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-7xl px-6 py-24 text-center">
          <div className="hud-label">404 · Reel not found</div>
          <p className="mt-4 text-white/40">That listing doesn&apos;t exist (anymore).</p>
          <Link href="/gear" className="btn-ghost mt-6 px-6 py-2.5 text-sm">
            Back to gear
          </Link>
        </main>
      </>
    );

  const gallery = listing.gallery.length
    ? listing.gallery
    : ([listing.heroImage].filter(Boolean) as string[]);
  const hero = gallery[Math.min(imgIdx, gallery.length - 1)] ?? null;
  const k: any = (listing as any).knowledge ?? {};

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-7xl px-6 py-10">
        <Link
          href="/gear"
          className="group inline-flex items-center gap-1.5 text-sm text-white/40 transition-colors hover:text-white"
        >
          <IconChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          All gear
        </Link>

        <div className="mt-6 grid gap-10 lg:grid-cols-2">
          {/* gallery + copy */}
          <div className="page-in">
            <div className="spot gradient-border group relative overflow-hidden rounded-2xl">
              <SmartImage
                key={hero ?? "none"}
                src={hero}
                alt={listing.title}
                className="aspect-[4/3]"
                imgClassName="transition-transform duration-700 ease-out group-hover:scale-[1.04]"
              />
              <div className="pointer-events-none absolute left-3 top-3 hidden sm:block" aria-hidden>
                <span className="hud-label rounded bg-black/45 px-2 py-1">
                  {listing.category} <span className="tick">/</span> {String(imgIdx + 1).padStart(2, "0")}—{String(gallery.length).padStart(2, "0")}
                </span>
              </div>
            </div>
            {gallery.length > 1 && (
              <div className="mt-3 grid grid-cols-5 gap-2.5">
                {gallery.slice(0, 5).map((g, i) => (
                  <button
                    key={i}
                    onClick={() => setImgIdx(i)}
                    aria-label={`Photo ${i + 1}`}
                    className={`overflow-hidden rounded-lg transition-all ${
                      i === imgIdx
                        ? "ring-2 ring-accent-400"
                        : "opacity-55 ring-1 ring-white/10 hover:opacity-90"
                    }`}
                  >
                    <SmartImage src={g} className="aspect-square" />
                  </button>
                ))}
              </div>
            )}

            <span className="hud-label mt-7 block !text-accent-400/90">{listing.category}</span>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-white lg:text-4xl">
              {listing.title}
            </h1>
            <p className="mt-4 text-balance leading-relaxed text-white/60">
              {k.summary ||
                `Professional ${listing.category.toLowerCase()} for hire in London. Pick your dates and the longer you rent, the better the per-day rate. Delivered across London or collect central.`}
            </p>

            {Array.isArray(k.features) && k.features.length > 0 && (
              <ul className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {k.features.slice(0, 6).map((f: string, i: number) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-white/65">
                    <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-accent-400">
                      <IconCheck className="h-3 w-3" />
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}

            {(k.bestFor?.length || k.tips?.length || k.limits?.length) && (
              <div className="spot mt-6 space-y-5 rounded-2xl p-5 text-sm">
                {k.bestFor?.length > 0 && (
                  <div>
                    <div className="hud-label">Best for</div>
                    <div className="mt-1.5 capitalize text-white/70">{k.bestFor.join("  ·  ")}</div>
                  </div>
                )}
                {k.tips?.length > 0 && (
                  <div>
                    <div className="hud-label">Pro tips</div>
                    <ul className="mt-1.5 space-y-1.5 text-white/65">
                      {k.tips.slice(0, 3).map((t: string, i: number) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-accent-400">›</span>
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {k.limits?.length > 0 && (
                  <div>
                    <div className="hud-label">Good to know</div>
                    <ul className="mt-1.5 space-y-1.5 text-white/55">
                      {k.limits.slice(0, 3).map((t: string, i: number) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-amber-400/80">!</span>
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* booking — or, for display-only items, register interest */}
          <div className="page-in lg:sticky lg:top-24 lg:self-start" style={{ animationDelay: "0.15s" }}>
            {(listing as any).displayOnly ? (
              <div className="spot gradient-border rounded-2xl p-6">
                <span className="rounded-full bg-sky-500/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-300">Display only</span>
                <h2 className="mt-3 font-display text-lg font-semibold text-white/90">Not available to book directly</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  This item is shown for reference. Register your interest and we&apos;ll let you know if it comes into the hire range — it also tells us what crews want us to stock.
                </p>
                <button
                  onClick={() => {
                    setRegistered(true);
                    track({ type: "register_interest", path: listing.slug, listingId: listing._id, title: listing.title, qty: 1, sessionId: getSessionId() }).catch(() => {});
                  }}
                  disabled={registered}
                  className={`mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition ${registered ? "bg-emerald-500/85 text-white" : "btn-primary"}`}
                >
                  {registered ? <><IconCheck className="h-4 w-4" /> Interest registered</> : "Register interest"}
                </button>
              </div>
            ) : (
              <BookingPanel
                listing={listing as any}
                start={start}
                end={end}
                month={month}
                onPick={pick}
                onMonthChange={setMonth}
                unavailable={unavailable}
              />
            )}
          </div>
        </div>

        <Recommendations slug={listing.slug} start={start} end={end} days={days} />
      </main>
    </>
  );
}
