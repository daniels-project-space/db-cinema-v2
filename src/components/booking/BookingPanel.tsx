"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { quote as computeQuote, type Pricing } from "@/lib/pricing";
import { Calendar, daysInclusive } from "@/components/booking/Calendar";
import { useCart } from "@/components/cart/CartProvider";

type Listing = {
  _id: string;
  slug: string;
  title: string;
  heroImage: string | null;
  pricing: Pricing;
  depositAmount: number;
  minimumRentalDays: number;
};

export function BookingPanel({
  listing,
  start,
  end,
  month,
  onPick,
  onMonthChange,
  unavailable,
}: {
  listing: Listing;
  start: string | null;
  end: string | null;
  month: Date;
  onPick: (iso: string) => void;
  onMonthChange: (d: Date) => void;
  unavailable: Set<string>;
}) {
  const cart = useCart();
  const days = start && end ? daysInclusive(start, end) : 0;
  const q = useMemo(
    () => (days ? computeQuote(listing.pricing, days) : null),
    [listing.pricing, days],
  );

  const startMs = start ? Date.parse(start + "T00:00:00Z") : 0;
  const endMs = end ? Date.parse(end + "T00:00:00Z") : 0;
  const avail = useQuery(
    api.availability.forListing,
    start && end ? { listingId: listing._id as any, start: startMs, end: endMs } : "skip",
  );
  const inKit = cart.items.filter((i) => i.listingId === listing._id).length;
  const remaining = avail ? Math.max(0, avail.available - inKit) : 0;
  const canAdd = !!(start && end && q && remaining > 0);

  function addToKit() {
    if (!canAdd || !q || !start || !end) return;
    cart.add({
      listingId: listing._id,
      slug: listing.slug,
      title: listing.title,
      heroImage: listing.heroImage,
      start,
      end,
      days,
      perDay: q.perDay,
      total: q.total,
      deposit: listing.depositAmount,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Calendar
        month={month}
        onMonthChange={onMonthChange}
        start={start}
        end={end}
        unavailable={unavailable}
        onPick={onPick}
      />

      <div className="glass gradient-border rounded-2xl p-5">
        {/* base rate row */}
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-white/50">From</span>
          <div>
            <span className="font-display text-2xl font-bold text-accent-400">
              £{listing.pricing.daily}
            </span>
            <span className="text-sm text-white/40"> /day</span>
          </div>
        </div>

        {q ? (
          <div className="mt-4 border-t border-white/5 pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-white/60">
                £{q.perDay}/day × {days} day{days > 1 ? "s" : ""}
                <span className="ml-2 rounded bg-accent-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-300">
                  {q.tier.label}
                </span>
              </span>
              <span className="font-display text-2xl font-bold text-white/90">
                £{q.total}
              </span>
            </div>
            {q.saved > 0 && (
              <div className="mt-1 text-right text-xs text-emerald-300">
                multi-day discount applied — save £{q.saved} ({q.savedPct}%)
              </div>
            )}
            <div className="mt-2 flex justify-between text-xs text-white/35">
              <span>+ refundable deposit</span>
              <span>£{listing.depositAmount}</span>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-white/[0.03] px-3 py-2 text-center text-xs text-white/40">
            Pick your dates on the calendar
          </div>
        )}

        {/* availability (quantity-aware) */}
        {start && end && (
          <div className="mt-3 text-center text-xs">
            {avail === undefined ? (
              <span className="text-white/30">Checking availability…</span>
            ) : avail.available === 0 ? (
              <span className="text-red-300">✕ Not available for these dates</span>
            ) : remaining > 0 ? (
              <span className="text-emerald-300">
                ✓ Available — {remaining} left{inKit > 0 ? ` (${inKit} in your kit)` : ""}
              </span>
            ) : (
              <span className="text-amber-300">
                All {avail.available} already in your kit
              </span>
            )}
          </div>
        )}

        <button
          onClick={addToKit}
          disabled={!canAdd}
          className="mt-5 w-full rounded-full bg-accent-500 py-3 font-medium text-white transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {remaining <= 0 && start && end && avail && avail.available > 0 ? "Max in kit" : "Add to kit"}
        </button>
      </div>
    </div>
  );
}
