import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { IconArrowRight, IconClock, IconBolt } from "@/components/icons";

export const metadata = { title: "How it works — Db Cinema Rentals" };

const STEPS = [
  ["01", "Browse", "Find the gear you need by category — cameras, lenses, lighting, audio and more. Each listing shows live availability and multi-day rates."],
  ["02", "Pick your dates", "Choose your start and end date on the calendar. The longer you rent, the better the per-day rate — applied automatically. Add suggested kit in one tap."],
  ["03", "Book & pay securely", "Checkout with card via Stripe. We take the rental plus a refundable deposit, released on safe return."],
  ["04", "Pickup or delivery", "Collect from central London or get it delivered locally. Shoot, then return it on your end date — that's it."],
];

export default function HowItWorksPage() {
  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-4xl px-6 py-14">
        <PageHero
          eyebrow="How it works"
          lead="Rent in"
          accent="four steps"
          sub="From first browse to back on set, here is the whole flow in four easy steps."
        />

        {/* timeline */}
        <Reveal className="relative mt-12">
          <div className="timeline-line left-[19px] hidden sm:block" aria-hidden />
          <div className="flex flex-col gap-6">
            {STEPS.map(([n, h, p], i) => (
              <Reveal key={n} delay={i * 110}>
                <div className="relative flex gap-6 sm:pl-14">
                  <span
                    className="absolute left-0 top-1 hidden h-10 w-10 items-center justify-center rounded-full border border-accent-400/30 bg-charcoal-950 font-mono text-xs text-accent-300 accent-glow sm:flex"
                    aria-hidden
                  >
                    {n}
                  </span>
                  <div className="spot gradient-border flex-1 rounded-2xl p-6">
                    <div className="font-poster text-3xl text-accent-400/30 sm:hidden">{n}</div>
                    <h2 className="font-display text-xl font-semibold text-white/90 sm:mt-0">{h}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-white/50">{p}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Reveal delay={60}>
            <div className="spot h-full rounded-2xl p-6 text-sm leading-relaxed text-white/50">
              <div className="flex items-center gap-2.5">
                <IconBolt className="h-4 w-4 text-accent-400" />
                <span className="font-display font-semibold text-white/80">Discounts &amp; offers</span>
              </div>
              <p className="mt-2.5">
                Multi-day rates apply automatically, and spending over £300 unlocks add-on deals.
              </p>
            </div>
          </Reveal>
          <Reveal delay={130}>
            <div className="spot h-full rounded-2xl p-6 text-sm leading-relaxed text-white/50">
              <div className="flex items-center gap-2.5">
                <IconClock className="h-4 w-4 text-accent-400" />
                <span className="font-display font-semibold text-white/80">Opening hours &amp; delivery</span>
              </div>
              <p className="mt-2.5">
                Pickup, return and delivery windows are <span className="font-mono text-white/70">10:00–12:00</span> and{" "}
                <span className="font-mono text-white/70">19:00–21:00</span>, every day. You choose your time slots at
                checkout. Local delivery is quoted by distance and item size as a round trip (delivery + collection),
                within ~30km of central London — beyond that, pickup only. Delivery uses a third-party courier; times
                are estimates and may be affected by traffic.
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal className="mt-10">
          <Link href="/gear" className="btn-primary px-7 py-3">
            Start browsing
            <IconArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </main>
    </>
  );
}
