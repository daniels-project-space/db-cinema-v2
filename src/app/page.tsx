import Link from "next/link";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { ReviewCarousel } from "@/components/ReviewCarousel";
import { HomeStats } from "@/components/HomeStats";
import { Particles } from "@/components/Particles";
import { Reveal } from "@/components/Reveal";

export default async function Home() {
  let rating: { ratingValue: number; reviewCount: number } | null = null;
  try {
    const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const s: any = await c.query(api.reviews.stats, {});
    if (s?.count) rating = { ratingValue: Number(s.average ?? 4.9), reviewCount: s.count };
  } catch {}

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Db Cinema Rentals",
    url: "https://dbcinemarentals.com",
    description:
      "Professional cinema camera, lens, lighting, audio and drone rental in London. Daily, 3-day and weekly rates, delivered.",
    priceRange: "££",
    areaServed: "London, United Kingdom",
    address: { "@type": "PostalAddress", addressLocality: "London", addressCountry: "GB" },
    openingHoursSpecification: [
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"], opens: "10:00", closes: "12:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"], opens: "19:00", closes: "21:00" },
    ],
    ...(rating
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: rating.ratingValue, reviewCount: rating.reviewCount } }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />

      {/* hero */}
      <section className="section-window relative flex min-h-[calc(100vh-57px)] flex-col items-center justify-center overflow-hidden px-6">
        <div
          className="pointer-events-none absolute h-[800px] w-[800px] rounded-full bg-accent-500/5 blur-[120px]"
          aria-hidden
        />
        <div className="lens-flare left-1/4 top-1/2 w-1/2" aria-hidden />
        {/* drifting particle field behind the wordmark */}
        <Particles />
        <div className="relative z-10 flex flex-col items-center text-center">
          <h1 className="font-display text-6xl font-bold tracking-[-0.02em] text-white/90 sm:text-8xl">
            DB
          </h1>
          <h2 className="gradient-text font-display text-5xl font-bold tracking-[0.08em] sm:text-7xl">
            CINEMA
          </h2>
          <p className="mt-6 text-sm uppercase tracking-widest text-white/40">
            Pro gear. Daily rates. Delivered.
          </p>
          <p className="mt-8 max-w-md text-white/30">
            Professional cinema cameras, lenses, lighting, audio and drones —
            bookable online, delivered across London. The longer you rent, the
            more you save.
          </p>
          <div className="mt-10 flex gap-4">
            <Link
              href="/gear"
              className="rounded-full bg-accent-500 px-7 py-3 font-medium text-white transition-colors hover:bg-accent-600"
            >
              Browse Gear
            </Link>
            <Link
              href="/#reviews"
              className="glass glass-hover rounded-full px-7 py-3 font-medium text-white/80"
            >
              Read reviews
            </Link>
          </div>
        </div>
      </section>

      {/* testimonials */}
      <section
        id="reviews"
        className="section-glass px-6 py-20"
      >
        <Reveal className="mx-auto max-w-6xl">
          <div className="mb-2 text-center text-xs uppercase tracking-widest text-accent-400">
            What renters say
          </div>
          <h2 className="text-center font-display text-3xl font-bold text-white/90">
            Trusted on <span className="gradient-text">Hygglo</span>
          </h2>
          <HomeStats />
          <div className="mt-10">
            <ReviewCarousel />
          </div>
        </Reveal>
      </section>

      {/* CTA */}
      <section className="section-window px-6 py-20 text-center">
        <Reveal>
        <h2 className="font-display text-3xl font-bold text-white/90">
          Ready to <span className="gradient-text">roll</span>?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-white/40">
          Browse the full catalogue and lock in your dates.
        </p>
        <Link
          href="/gear"
          className="mt-8 inline-block rounded-full bg-accent-500 px-8 py-3 font-medium text-white transition-colors hover:bg-accent-600"
        >
          Browse Gear
        </Link>
        </Reveal>
      </section>
    </>
  );
}
