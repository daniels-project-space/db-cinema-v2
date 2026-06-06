"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { BookingPanel } from "@/components/booking/BookingPanel";
import Link from "next/link";

export default function GearDetailPage() {
  const params = useParams<{ slug: string }>();
  const listing = useQuery(api.catalog.getListingBySlug, { slug: params.slug });

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
          {/* gallery + copy */}
          <div>
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
              <div className="mt-3 grid grid-cols-4 gap-3">
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

            <span className="mt-6 block text-xs uppercase tracking-widest text-accent-400">
              {listing.category}
            </span>
            <h1 className="mt-2 font-display text-3xl font-bold text-white/90">
              {listing.title}
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-white/40">
              Professional {listing.category.toLowerCase()} for hire. Use the
              calendar to pick your dates — multi-day discounts apply
              automatically as your rental gets longer.
            </p>
          </div>

          {/* booking */}
          <div>
            <BookingPanel listing={listing as any} />
          </div>
        </div>
      </main>
    </>
  );
}
