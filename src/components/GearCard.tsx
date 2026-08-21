"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { useGafferFocus } from "@/components/gaffer/GafferFocus";
import { SmartImage } from "@/components/SmartImage";
import { IconHeart, IconCheck } from "@/components/icons";
import { money } from "@/lib/pricing";
import { getSessionId } from "@/lib/session";

export type GearListing = {
  _id: string;
  slug: string;
  title: string;
  category: string;
  heroImage: string | null;
  pricing: { daily: number; day3?: number; day7?: number };
  depositAmount: number;
  minimumRentalDays: number;
  quietDeal?: number | null;
  displayOnly?: boolean | null;
};

const off = (n: number, pct: number) => Math.round(n * (1 - pct / 100));

export function GearCard({ listing }: { listing: GearListing }) {
  const { slug, title, category, heroImage, pricing, quietDeal, displayOnly } = listing;
  const account = useAccount();
  const router = useRouter();
  const track = useMutation(api.analytics.track);
  const [registered, setRegistered] = useState(false);
  const faved = !!account.me?.favorites?.includes(listing._id);
  // lit up when Gaffer names this item on a call, just before it goes in the basket
  const { focusedId, suggestedIds } = useGafferFocus();
  const picked = focusedId === listing._id;
  const suggested = !picked && suggestedIds.includes(listing._id);

  function registerInterest(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setRegistered(true);
    track({ type: "register_interest", path: slug, listingId: listing._id, title, qty: 1, sessionId: getSessionId() }).catch(() => {});
  }

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
      data-listing-id={listing._id}
      data-gaffer-focus={picked ? "true" : undefined}
      data-gaffer-suggested={suggested ? "true" : undefined}
      className="gear-card group lift spot gradient-border relative flex h-full flex-col overflow-hidden rounded-2xl"
    >
      <button
        onClick={toggleFav}
        aria-label={faved ? "Remove favourite" : "Add favourite"}
        className={`absolute right-2.5 top-2.5 z-10 flex h-10 w-10 items-center justify-center rounded-full transition-all ${
          faved
            ? "bg-accent-500/90 text-white"
            : "bg-black/45 text-white/60 opacity-100 hover:text-white lg:opacity-0 lg:group-hover:opacity-100"
        }`}
      >
        <IconHeart filled={faved} className="h-4 w-4" />
      </button>

      <div className="relative overflow-hidden">
        {/* Says why this card is lit up. A ring on its own reads as a hover
            state; naming it makes the shortlist legible as Gaffer's doing. */}
        {(picked || suggested) && (
          <span
            className={`gaffer-pick-badge absolute right-2.5 top-2.5 z-20 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-lg ${
              picked ? "bg-accent-400 text-black" : "bg-accent-400/25 text-accent-200 ring-1 ring-accent-400/50"
            }`}
          >
            {picked ? "Gaffer's pick" : "Suggested"}
          </span>
        )}
        {displayOnly ? (
          <span className="absolute left-2.5 top-2.5 z-10 rounded-full bg-sky-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg">
            Display only
          </span>
        ) : quietDeal ? (
          <span className="absolute left-2.5 top-2.5 z-10 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg">
            −{quietDeal}% quiet deal
          </span>
        ) : null}
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
        {displayOnly ? (
          <button
            onClick={registerInterest}
            disabled={registered}
            className={`mt-0.5 flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${registered ? "bg-emerald-500/85 text-white" : "bg-sky-500/90 text-white hover:bg-sky-400"}`}
          >
            {registered ? <><IconCheck className="h-3.5 w-3.5" /> Interest noted</> : "Register interest"}
          </button>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="font-display text-2xl font-bold text-accent-400">
              £{money(quietDeal ? off(pricing.daily, quietDeal) : pricing.daily)}
            </span>
            <span className="text-sm text-white/40">/day</span>
            {quietDeal ? (
              <span className="text-xs text-white/30 line-through">£{money(pricing.daily)}</span>
            ) : null}
            {pricing.day7 ? (
              <span className="ml-auto font-mono text-[11px] text-white/35">
                £{money(quietDeal ? off(pricing.day7, quietDeal) : pricing.day7)}/d · 7+
              </span>
            ) : null}
          </div>
        )}
      </div>
    </Link>
  );
}
