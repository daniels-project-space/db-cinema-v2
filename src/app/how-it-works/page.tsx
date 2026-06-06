import Link from "next/link";
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
        <div className="mb-2 text-xs uppercase tracking-widest text-accent-400">How it works</div>
        <h1 className="font-display text-4xl font-bold text-white/90">
          Rent in <span className="gradient-text">four steps</span>
        </h1>
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
          rates apply automatically, spend over £300 to unlock add-on deals, and
          use code <span className="text-accent-300">DB15OFF</span> for 15% off your rental.
        </div>
        <Link href="/gear" className="mt-8 inline-block rounded-full bg-accent-500 px-7 py-3 font-medium text-white hover:bg-accent-600">
          Start browsing
        </Link>
      </main>
    </>
  );
}
