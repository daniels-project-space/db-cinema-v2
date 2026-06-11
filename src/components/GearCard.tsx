"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/components/account/AccountProvider";
import { SmartImage } from "@/components/SmartImage";
import { IconHeart } from "@/components/icons";

export type GearListing = {
  _id: string;
  slug: string;
  title: string;
  category: string;
  heroImage: string | null;
  pricing: { daily: number; day3?: number; day7?: number };
  depositAmount: number;
  minimumRentalDays: number;
};

export function GearCard({ listing }: { listing: GearListing }) {
  const { slug, title, category, heroImage, pricing } = listing;
  const account = useAccount();
  const router = useRouter();
  const faved = !!account.me?.favorites?.includes(listing._id);

  function toggleFav(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!account.me) {
      router.push("/account");
      return;
    }
    account.toggleFavorite(listing._id);
  }

  return (
    <Link
      href={`/gear/${slug}`}
      className="group lift spot gradient-border relative flex h-full flex-col overflow-hidden rounded-2xl"
    >
      <button
        onClick={toggleFav}
        aria-label={faved ? "Remove favourite" : "Add favourite"}
        className={`absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full transition-all ${
          faved
            ? "bg-accent-500/90 text-white"
            : "bg-black/45 text-white/60 opacity-100 hover:text-white lg:opacity-0 lg:group-hover:opacity-100"
        }`}
      >
        <IconHeart filled={faved} className="h-4 w-4" />
      </button>

      <div className="relative overflow-hidden">
        <SmartImage
          src={heroImage}
          alt={title}
          className="aspect-[4/3]"
          imgClassName="transition-transform duration-700 ease-out group-hover:scale-[1.07]"
        />
        {/* bottom fade so the title zone reads cleanly */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/35 to-transparent" aria-hidden />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="hud-label !text-accent-400/90">{category}</span>
        <h3 className="line-clamp-2 flex-1 text-sm leading-snug text-white/85 transition-colors group-hover:text-white">
          {title}
        </h3>
        <div className="flex items-baseline gap-1">
          <span className="font-display text-2xl font-bold text-accent-400">
            £{pricing.daily}
          </span>
          <span className="text-sm text-white/40">/day</span>
          {pricing.day7 ? (
            <span className="ml-auto font-mono text-[11px] text-white/35">
              £{pricing.day7}/d · 7+
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
