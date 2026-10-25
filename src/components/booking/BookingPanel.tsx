"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useAccount } from "@/components/account/AccountProvider";
import { api } from "@cvx/_generated/api";
import { quote as computeQuote, type Pricing } from "@/lib/pricing";
import { Calendar, daysInclusive } from "@/components/booking/Calendar";
import { useCalendarStock } from "./useCalendarStock";
import { dayMs } from "@/lib/dates";
import { useCart } from "@/components/cart/CartProvider";
import { IconCheck, IconX } from "@/components/icons";

import {TimeSlotPicker} from "../checkout/TimeSlotPicker";

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
      await addWait({ email: email.trim(), token: account.token ?? undefined, listingId: listingId as any, start, end });
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
  marketingOnly?: boolean;
};

export function BookingPanel({
  listing,
  start,
  end,
  month,
  onPick,
  onMonthChange,
  unavailable,
  demand = 0,
}: {
  listing: Listing;
  start: string | null;
  end: string | null;
  month: Date;
  onPick: (iso: string) => void;
  onMonthChange: (d: Date) => void;
  unavailable: Set<string>;
  demand?: number;
}) {
  const cart = useCart();
  const policy = useQuery(api.settings.get, {});
  const [pickupTime,setPickupTime]=useState(""),[returnTime,setReturnTime]=useState("");
  const calendarStock=useCalendarStock(listing._id,month,cart.items,!!listing.marketingOnly,start&&!end?start:null);
  const validOrder = start !== end || !pickupTime || !returnTime || returnTime > pickupTime;
  const blockedDays=new Set([...unavailable,...calendarStock.unavailable]);
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
          ...cart.items.map((i) => ({ listingId: i.listingId as any, start: dayMs(i.start), end: dayMs(i.end),pickupTime:i.pickupTime,returnTime:i.returnTime })),
          { listingId: listing._id as any, start: startMs, end: endMs,pickupTime:pickupTime||undefined,returnTime:returnTime||undefined },
        ]
      : [];
  const fit = useQuery(
    api.availability.forCart,
    start && end && pickupTime && returnTime && validOrder && !listing.marketingOnly ? { items: prospective } : "skip",
  );
  const slots=useQuery(api.availability.forTimeSlots,start&&end&&!listing.marketingOnly?{listingId:listing._id as any,start:startMs,end:endMs,pickupTime:pickupTime||undefined,returnTime:returnTime||undefined,items:prospective.slice(0,-1)}:"skip");
  const cand: any = fit ? (fit as any)[listing._id] : undefined;
  // Marketing requests are recorded by cart.add; the basket checks stock and
  // offers replacements before checkout rather than blocking demand collection.
  const haveTimes = !!(pickupTime && returnTime);
  const timesAllowed = !!(slots?.pickupSlots.includes(pickupTime) && slots?.returnSlots.includes(returnTime));
  const canAdd = !!(start && end && q && (listing.marketingOnly || haveTimes && validOrder && calendarStock.ready && timesAllowed && cand?.ok));

  function addToKit() {
    if (!canAdd || !q || !start || !end) return;
    cart.add({
      listingId: listing._id,
      slug: listing.slug,
      title: listing.title,
      heroImage: listing.heroImage,
      start,
      end,
      pickupTime:pickupTime||undefined,returnTime:returnTime||undefined,
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
        unavailable={listing.marketingOnly ? new Set<string>() : blockedDays}
        partial={calendarStock.partial}
        disabled={!calendarStock.ready}
        onPick={onPick}
      />

      {!calendarStock.ready && <div role="status" className="text-sm text-white/70">{calendarStock.error ? <>Couldn’t check these dates. <button type="button" className="underline text-accent-300" onClick={()=>void calendarStock.retry()}>Retry availability</button></> : "Checking available dates…"}</div>}

      {start&&end&&!listing.marketingOnly&&<div className="grid grid-cols-2 gap-3">
        <TimeSlotPicker id={`gear-${listing._id}-pickup`} label="Pickup time" value={pickupTime} onChange={setPickupTime} disabled={!calendarStock.ready||!slots} allowedSlots={slots?.pickupSlots}/>
        <TimeSlotPicker id={`gear-${listing._id}-return`} label="Return time" value={returnTime} onChange={setReturnTime} disabled={!calendarStock.ready||!slots} allowedSlots={slots?.returnSlots}/>
      </div>}
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

        {demand >= 120 && (
          <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
            In demand — book early to lock your dates
          </div>
        )}

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
            <div className="mt-3 rounded-xl bg-white/[0.03] p-3 text-xs text-white/55">
              <p className="font-medium text-white/75">Refundable deposit shown at checkout</p>
              <p className="mt-1">{policy === undefined ? "Checking deposit policy…" : policy.assessmentSecurityEnabled
                ? "£20, £50 or £100 per booking, based on the whole kit’s replacement value. Eligible members and Encore renters pay £0. No separate card hold."
                : policy.refundableDepositEnabled
                  ? "£0, £50 or £100 per booking, based on the whole kit’s replacement value. No separate card hold."
                  : "No upfront deposit or card hold. Saved-card permission applies under your rental terms."}</p>
              <p className="mt-1">Your deposit is separate from the rental price. Any unused deposit is refunded to your original card after the return assessment. Checkout confirms your exact amount and eligibility.</p>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-white/[0.03] px-3 py-2.5 text-center text-xs text-white/40">
            Pick your dates on the calendar — longer rentals cost less per day
          </div>
        )}

        {/* availability (unit-aware, whole-cart) */}
        {start && end && !listing.marketingOnly && (
          <div className="mt-3 flex justify-center text-xs">
            {!haveTimes ? (
              <span className="text-amber-200">Choose pickup and return times to check availability.</span>
            ) : !validOrder ? (
              <span className="text-amber-200">Return time must be later than pickup on the same day.</span>
            ) : fit === undefined || !calendarStock.ready || slots === undefined ? (
              <span className="text-white/30">Checking availability…</span>
            ) : !timesAllowed ? (
              <span className="text-amber-200">Choose available pickup and return times for these dates.</span>
            ) : cand?.ok ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-300">
                <IconCheck className="h-3 w-3" /> Available for these dates and times
              </span>
            ) : cand && cand.available === 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rec-500/10 px-3 py-1 text-red-300">
                <IconX className="h-3 w-3" /> Not available for these dates and times
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-amber-300">
                <IconX className="h-3 w-3" /> That exceeds our stock — max already in your kit
              </span>
            )}
          </div>
        )}

        {start && end && haveTimes && !listing.marketingOnly && cand && cand.available === 0 && (
          <WaitlistForm listingId={listing._id} start={startMs} end={endMs} />
        )}

        <button
          onClick={addToKit}
          disabled={!canAdd}
          className="btn-primary mt-5 w-full py-3"
        >
          {!start || !end ? "Choose rental dates" : !haveTimes && !listing.marketingOnly ? "Choose pickup and return times" : cand && !cand.ok && cand.available > 0 ? "Max in kit" : "Add to kit"}
        </button>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-white/40">
          <span>✓ Delivered across London</span>
          <span>✓ Refundable deposit shown at checkout</span>
          <span>✓ Pro-checked gear</span>
        </div>
      </div>
    </div>
  );
}
