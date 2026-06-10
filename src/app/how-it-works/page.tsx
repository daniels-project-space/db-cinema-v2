import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";

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
        <PageHero eyebrow="How it works" lead="Rent in" accent="four steps" sub="From first browse to back on set, here is the whole flow in four easy steps." />
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {STEPS.map(([n, h, p]) => (
            <div key={n} className="rounded-2xl glass gradient-border p-6">
              <div className="font-display text-3xl font-bold text-accent-400/40">{n}</div>
              <h2 className="mt-2 font-display text-xl font-semibold text-white/90">{h}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/50">{p}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-white/5 bg-white/[0.015] p-6 text-sm text-white/50">
          <span className="font-semibold text-white/70">Discounts &amp; offers:</span> multi-day
          rates apply automatically, and spending over £300 unlocks add-on deals.
        </div>
        <div className="mt-4 rounded-2xl border border-white/5 bg-white/[0.015] p-6 text-sm text-white/50">
          <span className="font-semibold text-white/70">Opening hours &amp; delivery:</span>{" "}
          pickup, return and delivery windows are <span className="text-white/70">10:00–12:00</span> and{" "}
          <span className="text-white/70">19:00–21:00</span>, every day. You choose your time slots at checkout.
          Local delivery is quoted by distance and item size as a round trip (delivery + collection), within
          ~30km of central London — beyond that, pickup only. Delivery uses a third-party courier; times are
          estimates and may be affected by traffic.
        </div>
        <Link href="/gear" className="mt-8 inline-block rounded-full bg-accent-500 px-7 py-3 font-medium text-white hover:bg-accent-600">
          Start browsing
        </Link>
      </main>
    </>
  );
}
