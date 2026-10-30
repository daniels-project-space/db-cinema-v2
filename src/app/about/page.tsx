import {publicPageMetadata} from "@/lib/pageMetadata";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { IconArrowRight } from "@/components/icons";

export const metadata = publicPageMetadata("/about",'About our London hire service','Meet DB Cinema Rentals, a London film and photography equipment hire service. Explore the catalogue, collection and local delivery options.');

export default async function AboutPage() {
  let rating: { ratingValue: number; reviewCount: number } | null = null;
  let itemCount = 0;
  try {
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const [reviewStats, categories] = await Promise.all([
      client.query(api.reviews.stats, {}).catch(() => null),
      client.query(api.catalog.categories, {}).catch(() => []),
    ]);
    if (reviewStats?.count) {
      rating = { ratingValue: Number(reviewStats.average), reviewCount: reviewStats.count };
    }
    itemCount = categories.reduce((sum, category) => sum + category.count, 0);
  } catch {}

  const trustStats = [
    ...(rating
      ? [
          { value: rating.ratingValue, decimals: 2, suffix: "", label: "average rating" },
          { value: rating.reviewCount, decimals: 0, suffix: "+", label: "verified reviews" },
        ]
      : []),
    ...(itemCount > 0 ? [{ value: itemCount, decimals: 0, suffix: "", label: "items for hire" }] : []),
  ];

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-3xl px-6 py-14">
        <PageHero
          eyebrow="About us"
          lead="Cinema gear,"
          accent="ready to roll"
          sub="We keep London film crews rolling with pro gear that just works, and people who actually pick up the phone."
        />

        <Reveal className="mt-10">
          <p className="serif-accent border-l-2 border-accent-400/50 pl-5 text-2xl leading-snug text-white/80 sm:text-3xl">
            We started out renting our own kit between shoots — and grew into one
            of the most-reviewed gear hosts in the city.
          </p>
        </Reveal>

        <div className="mt-10 flex flex-col gap-5 leading-relaxed text-white/55">
          <Reveal delay={60}>
            <p>
              Db Cinema Rentals is a London-based hire house for professional film
              and photography equipment — cinema cameras, lenses, lighting, audio,
              stabilisers and more.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <p>
              Our rental equipment includes company equipment and equipment leased to the company and declared to its insurer. We manage its maintenance and testing. Whether you&apos;re
              shooting a short film, a music video, a wedding or a brand campaign,
              you get pro gear at fair daily rates — and the longer you rent, the
              more you save.
            </p>
          </Reveal>
          <Reveal delay={180}>
            <p>
              We offer pickup from central London or local delivery, with a simple,
              secure booking process and a refundable deposit. Thousands of happy
              renters later, our mission is the same: keep great gear working on
              great projects.
            </p>
          </Reveal>
        </div>

        {trustStats.length > 0 && (
          <div className="mt-10 grid grid-cols-1 gap-4 text-center sm:grid-cols-2 lg:grid-cols-3" aria-label="Live rental and review figures">
            {trustStats.map((stat, index) => (
              <Reveal key={stat.label} delay={index * 80}>
                <div className="spot gradient-border rounded-2xl p-5">
                  <div className="font-poster text-3xl text-accent-400">
                    {stat.value.toFixed(stat.decimals)}{stat.suffix}
                  </div>
                  <div className="hud-label mt-2">{stat.label}</div>
                </div>
              </Reveal>
            ))}
          </div>
        )}

        <Reveal className="mt-10">
          <Link href="/gear" className="btn-primary px-7 py-3">
            Browse the catalogue
            <IconArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>

        {/* Creative Collective */}
        <Reveal className="mt-14">
          <div className="spot gradient-border overflow-hidden rounded-2xl p-7 sm:p-9">
            <span className="hud-label !text-accent-400/90">Work with us</span>
            <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
              Join the <span className="serif-accent gradient-text text-[1.06em]">Creative Collective</span>
            </h2>
            <p className="mt-3 max-w-xl leading-relaxed text-white/55">
              Got pro gear sitting idle, or you&apos;re a cinematographer, editor or operator for hire? List your kit and
              earn 40% of every rental, or add your profile to our crew roster and get booked on London shoots. Every
              application is reviewed by hand.
            </p>
            <Link href="/join" className="btn-primary mt-6 px-7 py-3">
              Join the Collective
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
      </main>
    </>
  );
}
