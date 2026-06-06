"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import Link from "next/link";

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a);
  return ms >= 0 ? Math.round(ms / 86400000) + 1 : 0;
}

export default function GearDetailPage() {
  const params = useParams<{ slug: string }>();
  const listing = useQuery(api.catalog.getListingBySlug, { slug: params.slug });

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const startMs = start ? Date.parse(start) : 0;
  const endMs = end ? Date.parse(end) : 0;
  const avail = useQuery(
    api.availability.check,
    listing && startMs && endMs
      ? { listingId: listing._id, start: startMs, end: endMs }
      : "skip",
  );

  const days = start && end ? daysBetween(start, end) : 0;
  const quote = useMemo(() => {
    if (!listing || !days) return null;
    const p = listing.pricing;
    const rate =
      days >= 7 && p.day7 ? p.day7 : days >= 3 && p.day3 ? p.day3 : p.daily;
    return { rate, total: rate * days };
  }, [listing, days]);

  if (listing === undefined)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-7xl px-6 py-20 text-white/30">
          Loading…
        </main>
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

  const gallery = listing.gallery.length ? listing.gallery : [listing.heroImage].filter(Boolean) as string[];

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-7xl px-6 py-10">
        <Link
          href="/gear"
          className="text-sm text-white/40 transition-colors hover:text-white"
        >
          ← All gear
        </Link>
        <div className="mt-6 grid gap-10 lg:grid-cols-2">
          {/* gallery */}
          <div className="flex flex-col gap-3">
            <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-charcoal-800">
              {gallery[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={gallery[0]}
                  alt={listing.title}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            {gallery.length > 1 && (
              <div className="grid grid-cols-4 gap-3">
                {gallery.slice(1, 5).map((g, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={g}
                    alt=""
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                ))}
              </div>
            )}
          </div>

          {/* detail + booking */}
          <div>
            <span className="text-xs uppercase tracking-widest text-accent-400">
              {listing.category}
            </span>
            <h1 className="mt-2 font-display text-3xl font-bold text-white/90">
              {listing.title}
            </h1>

            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-accent-400">
                <span className="font-display text-2xl font-bold">
                  £{listing.pricing.daily}
                </span>{" "}
                /day
              </span>
              {listing.pricing.day3 ? (
                <span className="text-white/50">£{listing.pricing.day3}/day · 3 days</span>
              ) : null}
              {listing.pricing.day7 ? (
                <span className="text-white/50">£{listing.pricing.day7}/day · 7 days</span>
              ) : null}
            </div>

            <p className="mt-3 text-sm text-white/40">
              Refundable deposit £{listing.depositAmount} · min{" "}
              {listing.minimumRentalDays} day
              {listing.minimumRentalDays > 1 ? "s" : ""}
            </p>

            {/* date picker */}
            <div className="mt-8 glass gradient-border rounded-2xl p-5">
              <div className="text-sm font-medium text-white/70">
                Check availability
              </div>
              <div className="mt-3 flex flex-wrap gap-4">
                <label className="flex flex-col gap-1 text-xs text-white/40">
                  From
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none [color-scheme:dark]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/40">
                  To
                  <input
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none [color-scheme:dark]"
                  />
                </label>
              </div>

              {quote && (
                <div className="mt-4 border-t border-white/5 pt-4 text-sm">
                  <div className="flex justify-between text-white/60">
                    <span>
                      £{quote.rate}/day × {days} day{days > 1 ? "s" : ""}
                    </span>
                    <span className="font-display text-lg font-bold text-white/90">
                      £{quote.total}
                    </span>
                  </div>
                  {avail === undefined ? (
                    <div className="mt-2 text-white/30">Checking…</div>
                  ) : avail.available ? (
                    <div className="mt-3 rounded-lg bg-accent-500/10 px-3 py-2 text-accent-400">
                      ✓ Available for these dates
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-red-300">
                      ✕ Not available{" "}
                      {avail.reason ? `— ${avail.reason}` : ""}
                    </div>
                  )}
                </div>
              )}

              <button
                disabled={!quote || !avail?.available}
                className="mt-5 w-full rounded-full bg-accent-500 py-2.5 font-medium text-white transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Add to kit
              </button>
              <p className="mt-2 text-center text-xs text-white/25">
                Cart &amp; checkout land next — P2.
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
