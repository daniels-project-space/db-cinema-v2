"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useAccount } from "@/components/account/AccountProvider";
import { api } from "@cvx/_generated/api";
import { quote as computeQuote, type Pricing } from "@/lib/pricing";
import { Calendar, daysInclusive } from "@/components/booking/Calendar";
import { dayMs } from "@/lib/dates";
import { useCart } from "@/components/cart/CartProvider";
import { IconCheck, IconX } from "@/components/icons";

function WaitlistForm({ listingId, start, end }: { listingId: string; start: number; end: number }) {
  const account = useAccount();
  const addWait = useMutation(api.waitlist.add);
  const [email, setEmail] = useState(account.me?.email ?? "");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = /\S+@\S+\.\S+/.test(email);
  async function go() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      await addWait({ email: email.trim(), listingId: listingId as any, start, end });
      setDone(true);
    } catch (e: any) {
      const m = String(e?.message || "").match(/Uncaught Error:\s*(.+?)(?:\n|$)/);
      setErr(m ? m[1] : "Couldn't set the alert — please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-center text-xs text-emerald-300">
        Done — we'll email you if it frees up for these dates ✓
      </div>
    );
  return (
    <div className="mt-3 rounded-lg bg-white/[0.03] p-3">
      <div className="text-center text-xs text-white/55">Booked out — get an email if it frees up:</div>
      <div className="mt-2 flex gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          type="email"
          className="input flex-1 text-sm"
        />
        <button
          onClick={go}
          disabled={!valid || busy}
          className="shrink-0 rounded-full bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
        >
          {busy ? "…" : "Notify me"}
        </button>
      </div>
      {err && <div className="mt-1 text-center text-[11px] text-rose-300">{err}</div>}
    </div>
  );
}

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

  const startMs = start ? dayMs(start) : 0;
  const endMs = end ? dayMs(end) : 0;
  // evaluate the PROSPECTIVE cart (everything already in the kit + one more of
  // this listing) so shared physical units across different bundles are counted
  const prospective =
    start && end
      ? [
          ...cart.items.map((i) => ({ listingId: i.listingId as any, start: dayMs(i.start), end: dayMs(i.end) })),
          { listingId: listing._id as any, start: startMs, end: endMs },
        ]
      : [];
  const fit = useQuery(
    api.availability.forCart,
    start && end ? { items: prospective } : "skip",
  );
  const cand: any = fit ? (fit as any)[listing._id] : undefined;
  const canAdd = !!(start && end && q && cand?.ok);

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

      <div className="spot gradient-border rounded-2xl p-5">
        {/* base rate row */}
        <div className="flex items-baseline justify-between">
          <span className="hud-label">Day rate from</span>
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
                <span className="ml-2 rounded bg-accent-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent-300">
                  {q.tier.label}
                </span>
              </span>
              <span key={q.total} className="price-pop font-display text-3xl font-bold text-white">
                £{q.total}
              </span>
            </div>
            {q.saved > 0 && (
              <div className="mt-1.5 text-right text-xs text-emerald-300">
                multi-day discount applied — save £{q.saved} ({q.savedPct}%)
              </div>
            )}
            <div className="mt-2 flex justify-between font-mono text-xs text-white/35">
              <span>+ refundable deposit</span>
              <span>£{listing.depositAmount}</span>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-white/[0.03] px-3 py-2.5 text-center text-xs text-white/40">
            Pick your dates on the calendar — longer rentals cost less per day
          </div>
        )}

        {/* availability (unit-aware, whole-cart) */}
        {start && end && (
          <div className="mt-3 flex justify-center text-xs">
            {fit === undefined ? (
              <span className="text-white/30">Checking availability…</span>
            ) : cand?.ok ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-300">
                <IconCheck className="h-3 w-3" /> Available for these dates
              </span>
            ) : cand && cand.available === 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rec-500/10 px-3 py-1 text-red-300">
                <IconX className="h-3 w-3" /> Not available for these dates
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-amber-300">
                <IconX className="h-3 w-3" /> That exceeds our stock — max already in your kit
              </span>
            )}
          </div>
        )}

        {start && end && cand && cand.available === 0 && (
          <WaitlistForm listingId={listing._id} start={startMs} end={endMs} />
        )}

        <button
          onClick={addToKit}
          disabled={!canAdd}
          className="btn-primary mt-5 w-full py-3"
        >
          {start && end && cand && !cand.ok && cand.available > 0 ? "Max in kit" : "Add to kit"}
        </button>
      </div>
    </div>
  );
}
