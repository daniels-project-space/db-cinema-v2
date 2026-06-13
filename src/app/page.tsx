import Link from "next/link";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { ReviewCarousel } from "@/components/ReviewCarousel";
import { HomeStats } from "@/components/HomeStats";
import { HeroVideo } from "@/components/HeroVideo";
import { CameraDeconstruct } from "@/components/CameraDeconstruct";
import { Reveal } from "@/components/Reveal";
import { Marquee } from "@/components/Marquee";
import { ViewfinderHUD } from "@/components/ViewfinderHUD";
import { CountUp } from "@/components/CountUp";
import { GearCard, type GearListing } from "@/components/GearCard";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Magnetic } from "@/components/Magnetic";
import { ScrambleText } from "@/components/ScrambleText";
import { IconArrowRight, IconStar } from "@/components/icons";
import { BadgeTruck, BadgeShield, BadgeClock, BadgeBrowse, BadgeCalendar, BadgeLock } from "@/components/AnimatedIcons";
import { SITE_URL, SITE_NAME, BRANDS, HOURS_WINDOWS } from "@/lib/site";

export default async function Home() {
  let rating: { ratingValue: number; reviewCount: number } | null = null;
  let featured: GearListing[] = [];
  let categories: { name: string; count: number }[] = [];
  try {
    const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const [s, best, cats] = await Promise.all([
      c.query(api.reviews.stats, {}).catch(() => null),
      c.query(api.catalog.bestSellers, { limit: 8 }).catch(() => []),
      c.query(api.catalog.categories, {}).catch(() => []),
    ]);
    if ((s as any)?.count) rating = { ratingValue: Number((s as any).average ?? 4.9), reviewCount: (s as any).count };
    featured = (best as any) ?? [];
    categories = ((cats as any) ?? []).filter((x: any) => x.count > 0);
  } catch {}

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: SITE_NAME,
    url: SITE_URL,
    description:
      "Professional cinema camera, lens, lighting, audio and drone rental in London. Daily, 3-day and weekly rates, delivered.",
    priceRange: "££",
    areaServed: "London, United Kingdom",
    address: { "@type": "PostalAddress", addressLocality: "London", addressCountry: "GB" },
    openingHoursSpecification: HOURS_WINDOWS.map((w) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: DAYS,
      opens: w.opens,
      closes: w.closes,
    })),
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

      {/* ───────────────── hero — the viewfinder ───────────────── */}
      <section className="section-window relative flex min-h-[calc(100vh-93px)] flex-col overflow-hidden">
        {/* hero plate — cinematic crew film (Kling v3.0): intro → neon-logo idle loop */}
        <HeroVideo />
        {/* legibility scrim for the overlaid title */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 60%, rgba(5,5,10,0.12) 0%, rgba(5,5,10,0.55) 68%, rgba(5,5,10,0.84) 100%)",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#05050a] to-transparent"
          aria-hidden
        />
        <ViewfinderHUD />

        <div className="hero-push relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <div className="hero-rise hud-label" style={{ animationDelay: "0.15s" }}>
            <ScrambleText text="CAMERA · LENS · LIGHT · SOUND" />
          </div>

          <h1 className="mt-6 font-poster uppercase leading-[0.92]" aria-label="DB Cinema">
            <span className="block text-7xl text-white sm:text-9xl" aria-hidden>
              {"DB".split("").map((ch, i) => (
                <span key={i} className="hero-letter" style={{ animationDelay: `${0.2 + i * 0.07}s` }}>
                  {ch}
                </span>
              ))}
            </span>
            <span className="block text-6xl tracking-[0.06em] sm:text-8xl" aria-hidden>
              {"CINEMA".split("").map((ch, i) => (
                <span key={i} className="hero-letter gradient-text" style={{ animationDelay: `${0.34 + i * 0.055}s` }}>
                  {ch}
                </span>
              ))}
            </span>
          </h1>

          <p className="hero-rise serif-accent mt-6 text-2xl text-white/75 sm:text-3xl" style={{ animationDelay: "0.55s" }}>
            the gear that makes the shot.
          </p>

          <p className="hero-rise mt-6 max-w-xl text-balance leading-relaxed text-white/55" style={{ animationDelay: "0.65s" }}>
            Cameras, glass, light and sound the pros actually book — delivered
            across London and ready when you are. Rent longer, pay less.
          </p>

          <div className="hero-rise mt-9 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "0.75s" }}>
            <Magnetic>
              <Link href="/gear" className="btn-primary px-8 py-3">
                Browse the kit
                <IconArrowRight className="h-4 w-4" />
              </Link>
            </Magnetic>
            <Magnetic>
              <Link href="/how-it-works" className="btn-ghost px-8 py-3">
                How it works
              </Link>
            </Magnetic>
          </div>

          {rating && (
            <div className="hero-rise mt-9 flex items-center gap-2.5 text-sm text-white/50" style={{ animationDelay: "0.85s" }}>
              <span className="flex text-accent-400">
                {Array.from({ length: 5 }).map((_, i) => (
                  <IconStar key={i} className="h-3.5 w-3.5" />
                ))}
              </span>
              <span className="font-mono text-white/80">{rating.ratingValue.toFixed(2)}</span>
              <span className="text-white/25">·</span>
              <span>{rating.reviewCount}+ verified reviews</span>
            </div>
          )}
        </div>

        <div className="relative z-10 flex flex-col items-center gap-5 pb-6">
          <div className="scroll-cue" aria-hidden />
          <Marquee
            items={BRANDS}
            speed={34}
            className="w-full py-3"
            itemClassName="font-mono text-xs tracking-[0.35em] text-white/30"
          />
        </div>
      </section>

      {/* ───────────────── trust strip ───────────────── */}
      <section className="section-window border-y border-white/5 px-6 py-12">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-3">
          {[
            [BadgeTruck, "Delivered across London", "or collect in central London"],
            [BadgeShield, "Pro-maintained gear", "checked and cleaned between rentals"],
            [BadgeClock, "Booked in minutes", "online, any time, instant confirmation"],
          ].map(([Icon, h, p]: any, i) => (
            <Reveal key={h} delay={i * 90}>
              <div className="spot gradient-border flex items-start gap-4 rounded-2xl p-5">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400">
                  <Icon className="h-10 w-10" />
                </span>
                <span>
                  <span className="block font-display font-semibold text-white/90">{h}</span>
                  <span className="mt-1 block text-sm text-white/40">{p}</span>
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ──────────── the instrument — scroll-scrubbed deconstruction ──────────── */}
      <CameraDeconstruct />

      <div className="film-strip" aria-hidden />

      {/* ───────────────── featured gear ───────────────── */}
      {featured.length > 0 && (
        <section className="section-window px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <Reveal>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="hud-label !text-accent-400/90">Most booked</div>
                  <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
                    The kit crews <span className="serif-accent gradient-text text-[1.06em]">fight over</span>
                  </h2>
                </div>
                <Link href="/gear" className="arrow-link text-sm text-accent-400 transition-colors hover:text-accent-300">
                  All gear <span className="arrow">→</span>
                </Link>
              </div>
            </Reveal>
            <div className="dim-grid rail mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">
              {featured.slice(0, 8).map((l, i) => (
                <Reveal key={l._id} delay={Math.min(i, 6) * 60} className="w-[240px] shrink-0 snap-start lg:w-auto">
                  <GearCard listing={l} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ───────────────── categories ───────────────── */}
      {categories.length > 0 && (
        <section className="section-glass px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <Reveal>
              <div className="hud-label !text-accent-400/90">The catalogue</div>
              <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
                Every department, <span className="serif-accent gradient-text text-[1.06em]">covered</span>
              </h2>
            </Reveal>
            <div className="dim-grid mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {categories.map((c, i) => (
                <Reveal key={c.name} delay={Math.min(i, 8) * 50}>
                  <Link
                    href={`/gear?cat=${encodeURIComponent(c.name)}`}
                    className="ci-host spot lift group flex h-full flex-col rounded-2xl p-5"
                  >
                    <span className="flex items-start justify-between">
                      <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 transition-all duration-300 group-hover:scale-105 group-hover:bg-accent-500/15 group-hover:accent-glow">
                        <CategoryIcon name={c.name} className="h-9 w-9" />
                      </span>
                      <span className="font-poster text-xl text-white/[0.1] transition-colors group-hover:text-accent-400/25">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </span>
                    <span className="mt-5">
                      <span className="block font-display text-lg font-semibold text-white/90 transition-colors group-hover:text-white">
                        {c.name}
                      </span>
                      <span className="mt-1 flex items-center justify-between">
                        <span className="font-mono text-xs text-white/35">{c.count} items</span>
                        <IconArrowRight className="h-4 w-4 text-white/20 transition-all group-hover:translate-x-1 group-hover:text-accent-400" />
                      </span>
                    </span>
                  </Link>
                </Reveal>
              ))}
              <Reveal delay={Math.min(categories.length, 9) * 50}>
                <Link
                  href="/gear"
                  className="spot lift group flex h-full min-h-[150px] flex-col items-center justify-center gap-3 rounded-2xl border-dashed p-5 text-center"
                >
                  <span className="font-display text-lg font-semibold text-white/70 transition-colors group-hover:text-white">
                    View everything
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-xs text-accent-400">
                    {categories.reduce((n, c) => n + c.count, 0)} items
                    <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              </Reveal>
            </div>
          </div>
        </section>
      )}

      {/* ───────────────── how it works teaser ───────────────── */}
      <section className="section-window px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <Reveal className="text-center">
            <div className="hud-label !text-accent-400/90">How it works</div>
            <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
              On set in <span className="serif-accent gradient-text text-[1.06em]">four steps</span>
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["01", "Browse", "Pick from cameras, lenses, light and sound.", BadgeBrowse],
              ["02", "Dates", "Longer rentals unlock better day rates.", BadgeCalendar],
              ["03", "Book", "Pay securely by card with a refundable deposit.", BadgeLock],
              ["04", "Shoot", "Collect or get it delivered. Return. Done.", BadgeTruck],
            ].map(([n, h, p, Icon]: any, i) => (
              <Reveal key={n} delay={i * 80}>
                <div className="spot h-full rounded-2xl p-5">
                  <div className="flex items-start justify-between">
                    <div className="font-poster text-3xl text-accent-400/35">{n}</div>
                    <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent-500/10 text-accent-400">
                      <Icon className="h-8 w-8" />
                    </span>
                  </div>
                  <div className="mt-3 font-display text-lg font-semibold text-white/90">{h}</div>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/45">{p}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-8 text-center">
            <Link href="/how-it-works" className="arrow-link text-sm text-accent-400 transition-colors hover:text-accent-300">
              The whole flow, explained <span className="arrow">→</span>
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ───────────────── testimonials ───────────────── */}
      <section id="reviews" className="section-glass px-6 py-20">
        <Reveal className="mx-auto max-w-6xl">
          <div className="text-center">
            <div className="hud-label !text-accent-400/90">What crews say</div>
            <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
              Loved by London&apos;s <span className="serif-accent gradient-text text-[1.06em]">filmmakers</span>
            </h2>
          </div>
          <HomeStats />
          <div className="mt-10">
            <ReviewCarousel />
          </div>
        </Reveal>
      </section>

      {/* ───────────────── numbers ───────────────── */}
      <section className="section-window border-y border-white/5 px-6 py-14">
        <div className="mx-auto grid max-w-4xl grid-cols-3 gap-6 text-center">
          {[
            { v: rating?.ratingValue ?? 4.86, d: 2, suffix: "", label: "average rating" },
            { v: rating?.reviewCount ?? 875, d: 0, suffix: "+", label: "verified reviews" },
            { v: 200, d: 0, suffix: "+", label: "items for hire" },
          ].map((s) => (
            <div key={s.label}>
              <div className="font-poster text-4xl text-white sm:text-5xl">
                <CountUp value={s.v} decimals={s.d} suffix={s.suffix} className="gradient-text" />
              </div>
              <div className="hud-label mt-2">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="film-strip" aria-hidden />

      {/* ───────────────── CTA ───────────────── */}
      <section className="section-window relative overflow-hidden px-6 py-28 text-center">
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-500/[0.07] blur-[110px]"
          aria-hidden
        />
        <div className="lens-flare left-1/4 top-1/2 w-1/2" aria-hidden />
        <Reveal className="relative">
          <p className="serif-accent text-3xl text-white/85 sm:text-5xl">
            Your next shoot <span className="gradient-text">starts here.</span>
          </p>
          <p className="mx-auto mt-4 max-w-md text-white/45">
            Pick your dates, build your kit, and get back to the work that matters.
          </p>
          <Magnetic className="mt-9">
            <Link href="/gear" className="btn-primary px-9 py-3.5">
              Start your booking
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </Magnetic>
        </Reveal>
      </section>
    </>
  );
}
