import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { HireOfferGrid } from "@/components/HireOfferGrid";
import { discoveryListings, discoveryOffers } from "@/lib/discovery";
import { discoveryOfferSlugs } from "@/lib/discoveryOfferSelection";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sony FX3 Hire London | Compare Camera Kits",
  description: "Compare Sony FX3 camera body and kit rental options in London, check current daily rates and choose your hire dates.",
  alternates: { canonical: "/hire/sony-fx3-hire-london" },
};

export default async function SonyFx3Hire() {
  const rows = await discoveryListings();
  const candidates = rows.filter(row => ["Cameras", "Packages"].includes(row.category) && /\bfx[\s-]?3\b/i.test(`${row.title} ${row.slug.replace(/-/g, " ")}`));
  const offers = (await discoveryOffers(discoveryOfferSlugs(candidates))).filter(offer => ["Cameras", "Packages"].includes(offer.category) && /\bfx[\s-]?3\b/i.test(offer.title.split(/\b(?:like|similar to|equivalent to|compatible with)\b/i)[0])).sort((a, b) => (a.daily ?? Infinity) - (b.daily ?? Infinity));

  return <><SiteHeader /><main className="mx-auto max-w-6xl px-6 py-12">
    <nav aria-label="Breadcrumb" className="mb-8 text-sm text-white/50"><Link href="/">Home</Link> / <Link href="/hire/camera-hire-london">Camera hire</Link> / Sony FX3</nav>
    <p className="hud-label text-accent-400">London camera rental</p>
    <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">Sony FX3 hire in London</h1>
    <p className="mt-5 max-w-3xl text-lg leading-relaxed text-white/65">Compare available-to-book FX3 listings by kit and daily rate. Each listing shows its own included equipment; select your rental dates and times to check availability before booking.</p>
    <div className="mt-7 flex flex-wrap gap-3"><Link href="/gear?q=Sony%20FX3" className="rounded-full bg-accent-500 px-5 py-3 font-semibold text-black">Search the FX3 catalogue</Link><Link href="/contact" className="rounded-full border border-white/15 px-5 py-3">Ask about a kit</Link></div>
    <section className="mt-12" aria-labelledby="fx3-options"><h2 id="fx3-options" className="font-display text-2xl">Compare Sony FX3 rental options</h2><p className="mt-2 text-sm text-white/50">A selection from our catalogue. Rates are shown per day; the final price depends on your rental period. Listings are not reserved until booking is confirmed.</p><HireOfferGrid offers={offers} /></section>
    <section className="mt-12 rounded-2xl border border-white/10 p-6"><h2 className="font-display text-2xl">Choosing your FX3 kit</h2><p className="mt-3 leading-relaxed text-white/65">Compare the body-only and lens or support options against your shoot. Check each listing for its exact supplied parts, then choose the dates and times you need. Different kits can share equipment, so availability is confirmed for your complete basket.</p><div className="mt-5 flex flex-wrap gap-5 text-accent-400"><Link href="/hire/camera-hire-london">Compare other cameras →</Link><Link href="/hire/lens-hire-london">Browse lenses →</Link><Link href="/faq">Rental questions →</Link></div></section>
  </main></>;
}
