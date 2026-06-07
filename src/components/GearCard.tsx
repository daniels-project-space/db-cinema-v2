"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/components/account/AccountProvider";
import { SmartImage } from "@/components/SmartImage";

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
      className="group lift glass glass-hover gradient-border relative flex flex-col overflow-hidden rounded-2xl"
    >
      <button
        onClick={toggleFav}
        aria-label={faved ? "Remove favourite" : "Add favourite"}
        className={`absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur transition-colors ${
          faved ? "bg-accent-500/90 text-white" : "bg-black/40 text-white/70 hover:text-white"
        }`}
      >
        {faved ? "♥" : "♡"}
      </button>
      <SmartImage
        src={heroImage}
        alt={title}
        className="aspect-[4/3]"
        imgClassName="transition-transform duration-500 group-hover:scale-105"
      />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="text-xs uppercase tracking-widest text-accent-400">
          {category}
        </span>
        <h3 className="line-clamp-2 flex-1 text-sm text-white/80">{title}</h3>
        <div className="flex items-baseline gap-1">
          <span className="font-display text-2xl font-bold text-accent-400">
            £{pricing.daily}
          </span>
          <span className="text-sm text-white/40">/day</span>
          {pricing.day7 ? (
            <span className="ml-auto text-xs text-white/35">
              £{pricing.day7}/day for 7+
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
