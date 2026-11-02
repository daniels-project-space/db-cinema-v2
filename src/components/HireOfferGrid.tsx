import Link from "next/link";
import type { DiscoveryOffer } from "@/lib/discovery";

export function HireOfferGrid({ offers }: { offers: DiscoveryOffer[] }) {
  if (!offers.length) return <p className="mt-4 text-white/60">No matching kits are shown here right now. Browse the catalogue or contact us for alternatives.</p>;
  return <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{offers.map(offer => <li key={offer.slug}>
    <Link href={`/gear/${offer.slug}`} className="block h-full rounded-2xl border border-white/10 bg-white/[0.025] p-5 hover:border-accent-400/50">
      <span className="font-medium text-white/90">{offer.title}</span>
      {offer.daily !== null && <span className="mt-2 block text-sm text-white/65">£{offer.daily} per day{offer.minimumRentalDays > 1 ? ` · ${offer.minimumRentalDays}-day minimum` : ""}</span>}
      <span className="mt-3 block text-sm text-accent-400">See included equipment &amp; check dates →</span>
    </Link>
  </li>)}</ul>;
}
