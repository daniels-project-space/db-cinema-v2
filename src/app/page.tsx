export const metadata = { alternates: { canonical: "/" } };
export const dynamic = "force-dynamic";
import Link from "next/link";
import Image from "next/image";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { ReviewCarousel } from "@/components/ReviewCarousel";
import { HyggloReviewRows, HyggloTrustTile, type VerifiedHyggloHighlight } from "@/components/HyggloReviewShowcase";
import { HomeStats } from "@/components/HomeStats";
import { HeroCinematic } from "@/components/HeroCinematic";
import { FilmFundInvite } from "@/components/FilmFundInvite";
import { CameraDeconstruct } from "@/components/CameraDeconstruct";
import { Reveal } from "@/components/Reveal";
import { Marquee } from "@/components/Marquee";
import { ViewfinderHUD } from "@/components/ViewfinderHUD";
import { GearCard, type GearListing } from "@/components/GearCard";
import { HomeGearSearch } from "@/components/HomeGearSearch";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Magnetic } from "@/components/Magnetic";
import { IconArrowRight } from "@/components/icons";
import { BadgeTruck, BadgeSquare, BadgeShield, BadgeClock } from "@/components/AnimatedIcons";
import { HowItWorksSteps } from "@/components/HowItWorksSteps";
import { CONTACT_EMAIL, SITE_URL, SITE_NAME, BRANDS, HOURS_WINDOWS } from "@/lib/site";
import { unstable_cache } from "next/cache";
import closingStyles from "./HomeClosing.module.css";

const homeHyggloReviews = unstable_cache(async (_revision: string) => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(api.reviews.listVerifiedHyggloHighlights, { limit: 100 }), ["public-home-reviews-v4", process.env.NEXT_PUBLIC_CONVEX_URL!], { revalidate: 300 });
const homeBest = unstable_cache(async (_revision: string) => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(api.catalog.bestSellers, { limit: 8 }), ["public-home-best-v1", process.env.NEXT_PUBLIC_CONVEX_URL!], { revalidate: 86400 });
const homeCategories = unstable_cache(async (_revision: string) => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(api.catalog.categories, {}), ["public-home-categories-v1", process.env.NEXT_PUBLIC_CONVEX_URL!], { revalidate: 86400 });

const trustTiles = [
  {
    eyebrow: "Location",
    icon: BadgeSquare,
    title: "Based at Trafalgar Square",
    copy: "Pick up from the heart of central London.",
    image: "/images/home/trafalgar-square-location-20261028.webp",
    alt: "Cinema cases in Trafalgar Square, beside Nelson’s Column and the National Gallery",
  },
  {
    eyebrow: "Pro maintained",
    icon: BadgeShield,
    title: "Pro kit, meticulously maintained",
    copy: "Every item checked and cleaned before it leaves us.",
    image: "/images/home/maintained-cinema-gear-20261028.webp",
    alt: "A technician checks a cinema lens beside a professional camera kit",
  },
  {
    eyebrow: "Delivery",
    icon: BadgeTruck,
    title: "Delivered across London",
    copy: "Reliable delivery and collection, straight to your set.",
    image: "/images/home/london-delivery-20261028.webp",
    alt: "Cinema cases being delivered through central London",
  },
  {
    eyebrow: "Booking",
    icon: BadgeClock,
    title: "Ready when you are",
    copy: "Book online in minutes with instant confirmation.",
    image: "/images/home/ready-to-shoot-kit-20261028.webp",
    alt: "A complete cinema kit prepared for a film shoot",
  },
];

export default async function Home() {
  const rating = { ratingValue: 4.73, reviewCount: 1300, reviewCountLabel: "1,300+" };
  let hyggloReviews: VerifiedHyggloHighlight[] = [];
  let featured: GearListing[] = [];
  let categories: { name: string; count: number }[] = [];
  let catalogVersion: string | null = null;
  try {
    const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const revision = await c.query(api.catalog.publicRevision, {});
    catalogVersion = revision;
    const [best, cats, sourceReviews] = await Promise.all([homeBest(revision).catch(() => []), homeCategories(revision).catch(() => []), homeHyggloReviews(revision).catch(() => [])]);
    hyggloReviews = (sourceReviews as VerifiedHyggloHighlight[]) ?? [];
    featured = (best as any) ?? [];
    categories = ((cats as any) ?? []).filter((x: any) => x.count > 0);
  } catch {}

  const itemCount = categories.reduce((sum, category) => sum + category.count, 0);

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${SITE_URL}/#business`,
    name: SITE_NAME,
    url: SITE_URL,
    email: CONTACT_EMAIL,
    image: `${SITE_URL}/opengraph-image`,
    description:
      "Camera hire in London — professional cinema cameras, lenses, lighting, audio and drone rental. Daily, 3-day and weekly rates, delivered across London or collect in central London.",
    priceRange: "££",
    areaServed: { "@type": "City", name: "London" },
    address: { "@type": "PostalAddress", addressLocality: "London", addressCountry: "GB" },
    knowsAbout: ["Camera hire London", "Cinema camera rental", "Lens hire London", "Lighting hire London", "Video camera hire", "Drone hire London", "Audio equipment hire", "Film equipment hire London", "RED ARRI Sony FX hire"],
    openingHoursSpecification: HOURS_WINDOWS.map((w) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: DAYS,
      opens: w.opens,
      closes: w.closes,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />

      {/* ───────────────── hero — the viewfinder ───────────────── */}
      <section className="section-window relative min-h-[54svh] overflow-hidden lg:min-h-[calc(100vh-93px)]">
        {/* cinematic film (Veo 3.1) + timed gear callouts + catchphrase/CTA */}
        <HeroCinematic rating={rating} categories={categories} />
        <ViewfinderHUD />

        <div className="absolute inset-x-0 bottom-0 z-10 pb-2">
          <Marquee
            items={BRANDS}
            speed={34}
            className="w-full py-1.5"
            itemClassName="font-mono text-xs tracking-[0.35em] text-white/30"
          />
        </div>
      </section>

      {/* ───────────────── London, on the label ───────────────── */}
      <section className="section-window border-y border-white/5 px-6 py-12">
        {/* Four visual proof cards make the London base and rental service clear at a glance. */}
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {trustTiles.map((tile, i) => (
            <Reveal key={tile.title} delay={i * 70} className="h-full">
              {tile.title === "Pro kit, meticulously maintained" && hyggloReviews[0] ? (
                <HyggloTrustTile reviews={hyggloReviews} />
              ) : <article className="trust-card group relative isolate h-[280px] overflow-hidden rounded-2xl border border-white/10 bg-[#101013] shadow-[0_20px_60px_-32px_rgba(0,0,0,.9)] sm:h-[304px]">
                <Image
                  src={tile.image}
                  alt={tile.alt}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  className="trust-card-image object-cover transition-transform duration-700 ease-out group-hover:scale-[1.045]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#070709] via-[#070709]/55 to-black/5" aria-hidden />
                <div className="absolute inset-0 bg-gradient-to-r from-black/25 via-transparent to-transparent" aria-hidden />
                <div className="absolute inset-x-0 top-0 flex items-center justify-between p-5 sm:p-6">
                  <span className="inline-flex rounded-full border border-white/20 bg-black/65 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.17em] text-white/85 shadow-lg backdrop-blur-sm">
                    {tile.eyebrow}
                  </span>
                  <span className="trust-symbol ci-host rounded-xl border border-accent-300/25 bg-[#160d11]/85 p-2 text-accent-300"><tile.icon className="h-8 w-8" /></span>
                </div>
                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                  <h2 className="mt-4 max-w-[17rem] font-display text-xl font-semibold leading-tight text-white sm:text-2xl">
                    {tile.title}
                  </h2>
                  <p className="mt-2 max-w-[18rem] text-sm leading-relaxed text-white/75">
                    {tile.copy}
                  </p>
                </div>
              </article>}
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section-window px-6 py-8" aria-label="Find and book rental gear">
        <div className="mx-auto max-w-7xl"><HomeGearSearch categories={categories} /></div>
      </section>

      {/* ──────────── the instrument — scroll-scrubbed deconstruction ──────────── */}
      <div className="h-8 lg:h-0" aria-hidden />
      <CameraDeconstruct />

      <div className="h-8 lg:h-0" aria-hidden />
      <div className="film-strip" aria-hidden />

      {/* ───────────────── featured gear ───────────────── */}
      <HomeGearSearch categories={categories} featured={featured} initialRevision={catalogVersion} />

      {/* ───────────────── categories ───────────────── */}
      {categories.length > 0 && (
        <section className="section-glass px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <Reveal>
              <div className="hud-label !text-accent-400/90">The catalogue</div>
              <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
                Every department, <span className="serif-accent gradient-text text-[1.06em]">covered</span>
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/45">
                From cinema camera hire to lens, lighting, audio and drone rental, Db Cinema is London&apos;s
                full-service film equipment hire — delivered across London or collected in central London.
              </p>
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

      <section id="reviews" className="section-glass scroll-mt-24 px-6 py-20">
        <Reveal className="mx-auto max-w-6xl">
          <div className="text-center">
            <div className="hud-label !text-accent-400/90">What crews say</div>
            <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
              Loved by London&apos;s <span className="serif-accent gradient-text text-[1.06em]">filmmakers</span>
            </h2>
          </div>
          {hyggloReviews.length >= 3 && <HyggloReviewRows reviews={hyggloReviews} />}
          <div className={hyggloReviews.length >= 3 ? "mt-8" : "mt-10"}><ReviewCarousel /></div>
          <HomeStats ratingValue={rating.ratingValue} reviewCount={rating.reviewCount} itemCount={itemCount} />
        </Reveal>
      </section>

      <HowItWorksSteps />

      <div className="film-strip" aria-hidden />

      <FilmFundInvite />

      <section aria-labelledby="hygglo-profile-title" className="section-window px-6 pb-20">
        <div className="mx-auto max-w-6xl">
          <div className="group relative isolate grid overflow-hidden rounded-[2rem] border border-accent-300/25 bg-[#0d0f12] shadow-[0_28px_90px_-48px_rgba(212,172,107,.45)] sm:grid-cols-[1.2fr_.8fr]">
            <Image
              src="/images/home/maintained-cinema-gear-20261028.webp"
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 1152px"
              className="pointer-events-none object-cover opacity-30 transition duration-700 group-hover:scale-[1.025] group-hover:opacity-40"
            />
            <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(100deg,rgba(8,10,12,.97)_0%,rgba(8,10,12,.9)_48%,rgba(8,10,12,.45)_100%)]" />
            <div className="relative z-10 px-7 py-9 sm:px-11 sm:py-12">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent-300/25 bg-black/35 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.2em] text-accent-200/80">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent-300 shadow-[0_0_12px_rgba(212,172,107,.9)]" />
                DB Cinema Rentals × Hygglo
              </div>
              <h2 id="hygglo-profile-title" className="mt-5 max-w-xl font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
                Another way to find your <span className="serif-accent gradient-text">next-shot kit.</span>
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-white/65">
                Browse our London camera, lens, lighting and sound rentals on Hygglo, and read the feedback from crews who have rented with us.
              </p>
              <a href="https://hygglo.com/uk/users/dbcinemarentals" target="_blank" rel="noopener noreferrer" className="mt-7 inline-flex min-h-12 items-center gap-3 rounded-xl border border-accent-300/35 bg-accent-300/10 px-5 text-sm font-medium text-accent-100 transition hover:border-accent-200/70 hover:bg-accent-300/20 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-300">
                Explore our Hygglo profile
                <span aria-hidden="true" className="text-lg transition-transform group-hover:translate-x-1">↗</span>
              </a>
            </div>
            <div className="relative z-10 grid grid-cols-2 gap-3 self-end p-6 pt-0 sm:gap-4 sm:p-8">
              <div className="rounded-2xl border border-white/15 bg-black/45 p-4 backdrop-blur-xl sm:p-5">
                <p className="font-poster text-3xl tabular-nums text-white sm:text-4xl">4.73<span className="ml-1 text-base text-white/45">/5</span></p>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-[.18em] text-white/50">Profile rating</p>
              </div>
              <div className="rounded-2xl border border-accent-200/20 bg-black/45 p-4 backdrop-blur-xl sm:p-5">
                <p className="font-poster text-3xl tabular-nums text-accent-200 sm:text-4xl">1,300+</p>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-[.18em] text-white/50">Renter reviews</p>
              </div>
              <p className="col-span-2 text-right font-mono text-[9px] uppercase tracking-[.17em] text-white/40">A well-reviewed profile. Your next rental starts here.</p>
            </div>
          </div>
        </div>
      </section>

      <section className={`section-window relative overflow-hidden px-6 py-28 text-center ${closingStyles.section}`} aria-labelledby="home-closing-title">
        <div className={closingStyles.lights} aria-hidden="true"><span/><span/><span/><span/><span/></div>
        <Reveal className="relative">
          <p className="hud-label !text-accent-300/80">Your story is waiting</p>
          <h2 id="home-closing-title" className="serif-accent mt-4 text-3xl text-white/85 sm:text-5xl">Your next shot <span className="gradient-text">starts here.</span></h2>
          <p className="mx-auto mt-4 max-w-md text-white/55">Pick your dates, build your kit, and get back to the work that matters.</p>
          <Magnetic className="mt-9"><Link href="/gear" className="btn-primary px-9 py-3.5">Start your booking <IconArrowRight className="h-4 w-4" /></Link></Magnetic>
        </Reveal>
      </section>

    </>
  );
}
