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
          <p className="mt-6 text-xs uppercase tracking-[0.3em] text-white/40">
            London cinema rental
          </p>
          <p className="mt-7 max-w-xl text-balance text-lg leading-relaxed text-white/60">
            Rent the gear that makes the shot. Cameras, glass, light and sound the
            pros actually book, delivered across London and ready when you are.
          </p>
          <p className="mt-3 text-sm text-white/35">Rent longer, pay less. Booked in two minutes.</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/gear"
              className="press rounded-full bg-accent-500 px-7 py-3 font-medium text-white transition-colors hover:bg-accent-600"
            >
              Browse the kit
            </Link>
            <Link
              href="/how-it-works"
              className="glass glass-hover rounded-full px-7 py-3 font-medium text-white/80"
            >
              How it works
            </Link>
          </div>
        </div>
      </section>

      {/* trust strip */}
      <section className="section-window border-y border-white/5 px-6 py-9">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-7 text-center sm:grid-cols-3">
          <div><div className="font-display text-white/85">Delivered across London</div><div className="mt-1 text-xs text-white/40">or collect in central London</div></div>
          <div><div className="font-display text-white/85">Pro-maintained gear</div><div className="mt-1 text-xs text-white/40">checked and cleaned between rentals</div></div>
          <div><div className="font-display text-white/85">Booked in minutes</div><div className="mt-1 text-xs text-white/40">online, any time, instant confirmation</div></div>
        </div>
      </section>

      {/* testimonials */}
      <section
        id="reviews"
        className="section-glass px-6 py-20"
      >
        <Reveal className="mx-auto max-w-6xl">
          <div className="mb-2 text-center text-xs uppercase tracking-[0.3em] text-accent-400">
            What crews say
          </div>
          <h2 className="text-center font-display text-3xl font-bold text-white/90">
            Loved by London&apos;s <span className="gradient-text">filmmakers</span>
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
          Your next shoot <span className="gradient-text">starts here</span>
        </h2>
        <p className="mx-auto mt-3 max-w-md text-white/45">
          Pick your dates, build your kit, and get back to the work that matters.
        </p>
        <Link
          href="/gear"
          className="press mt-8 inline-block rounded-full bg-accent-500 px-8 py-3 font-medium text-white transition-colors hover:bg-accent-600"
        >
          Start your booking
        </Link>
        </Reveal>
      </section>
    </>
  );
}
