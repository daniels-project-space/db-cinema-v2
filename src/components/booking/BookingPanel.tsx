"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useAccount } from "@/components/account/AccountProvider";
import { api } from "@cvx/_generated/api";
import { quote as computeQuote, type Pricing } from "@/lib/pricing";
import { Calendar } from "@/components/booking/Calendar";
import { useCalendarStock } from "./useCalendarStock";
import { dayMs } from "@/lib/dates";
import { rentalPricingDays } from "../../../shared/rentalDuration";
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
  bookable?: boolean;
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
  onAdded,
  touchFriendlyCalendar = false,
}: {
  listing: Listing;
  start: string | null;
  end: string | null;
  month: Date;
  onPick: (iso: string) => void;
  onMonthChange: (d: Date) => void;
  unavailable: Set<string>;
  demand?: number;
  onAdded?: () => void;
  touchFriendlyCalendar?: boolean;
}) {
  const cart = useCart();
  const policy = useQuery(api.settings.get, {});
  const calendarStock=useCalendarStock(listing._id,month,cart.items,!!listing.marketingOnly,start&&!end?start:null);
  const validOrder = !start || !end || start <= end;
  const blockedDays=new Set([...unavailable,...calendarStock.unavailable]);
  const days = start && end && validOrder ? rentalPricingDays(dayMs(start), dayMs(end)) : 0;
  const q = useMemo(
    () => (days ? computeQuote(listing.pricing, days) : null),
    [listing.pricing, days],
  );
  const rateLadder = useMemo(
    () => computeQuote(listing.pricing, 1).ladder.filter((tier) => tier.days === 3 || tier.days === 7),
    [listing.pricing],
  );
  const securitySummary = policy === undefined
    ? "Checking"
    : policy.setupIntentSecurityEnabled
      ? "No hold"
      : policy.cardHoldSecurityEnabled
        ? "Temporary hold"
        : policy.assessmentSecurityEnabled
          ? "Kit-based amount"
          : policy.refundableDepositEnabled
            ? "Refundable amount"
            : "No hold";
  const securityHeading = policy?.setupIntentSecurityEnabled
    ? "Saved-card future-claim ceiling"
    : policy?.cardHoldSecurityEnabled
      ? "Card authorisation hold"
      : "Rental security shown at checkout";
  const securityAmountDescription = policy === undefined
    ? "Checking deposit policy…"
    : policy.setupIntentSecurityEnabled
      ? "Stripe saves your card; no cash deposit or hold is taken. The saved card may cover itemised late-return charges or severe, permanent cosmetic damage or loss, up to a combined £50, £100 or £200 ceiling set by equipment replacement value. No charge for an on-time return without a reported issue. Insurance is separate."
      : policy.cardHoldSecurityEnabled
        ? "A temporary £50, £100 or £200 card authorisation is set by equipment value, unless your account meets the agreed exemption. It is not a payment, but your bank may reduce available balance. If pickup is over a week away, the hold may expire; we request a replacement five hours before pickup."
        : policy.assessmentSecurityEnabled
          ? "£20, £50 or £100 based on the whole kit’s replacement value. £0 is only available after a previous clean completed rental with settled security, plus a paid active subscription after its first recurring payment or the final Encore tier. First rentals and free trials do not qualify. No separate card hold."
          : policy.refundableDepositEnabled
            ? "£0, £50 or £100 per booking, based on the whole kit’s replacement value. No separate card hold."
            : "No upfront deposit or card hold. Saved-card permission applies under your rental terms.";
  const securityReturnDescription = policy === undefined
    ? "Checkout confirms the exact amount and return process."
    : policy.setupIntentSecurityEnabled
      ? "The ceiling is never charged or held. A later payment may be declined or require bank authentication. Checkout shows the exact amount and terms."
      : policy.cardHoldSecurityEnabled
        ? "An issue-free return cancels the uncaptured hold; your bank controls when the balance is restored. Any claim needs a recorded reason and evidence. Checkout confirms your exact amount and eligibility."
        : "Your deposit is separate from the rental price. Any unused deposit is refunded to your original card after the return assessment. Checkout confirms your exact amount and eligibility.";

  const startMs = start ? dayMs(start) : 0;
  const endMs = end ? dayMs(end) : 0;
  // evaluate the PROSPECTIVE cart (everything already in the kit + one more of
  // this listing) so shared physical units across different bundles are counted
  const prospective =
    start && end
      ? [
          ...cart.items.map((i) => ({ listingId: i.listingId as any, start: dayMs(i.start), end: dayMs(i.end),pickupTime:i.pickupTime,returnTime:i.returnTime })),
          { listingId: listing._id as any, start: startMs, end: endMs },
        ]
      : [];
  const fit = useQuery(
    api.availability.forCart,
    start && end && validOrder && !listing.marketingOnly ? { items: prospective } : "skip",
  );
  const cand: any = fit ? (fit as any)[listing._id] : undefined;
  // Marketing requests are recorded by cart.add; the basket checks stock and
  // offers replacements before checkout rather than blocking demand collection.
  const needsRequestReview = !!(listing.marketingOnly || listing.bookable === false || (fit !== undefined && !cand?.ok));
  const canAdd = !!(start && end && q && validOrder);

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
    onAdded?.();
  }

  return (
    <div className="flex flex-col gap-4">
      <Calendar
        month={month}
        onMonthChange={onMonthChange}
        start={start}
        end={end}
        unavailable={blockedDays}
        partial={calendarStock.partial}
        allowUnavailable
        touchFriendly={touchFriendlyCalendar}
        onPick={onPick}
      />

      {!calendarStock.ready && <div role="status" className="text-sm text-white/70">{calendarStock.error ? <>Couldn’t check these dates. <button type="button" className="underline text-accent-300" onClick={()=>void calendarStock.retry()}>Retry availability</button></> : "Checking available dates…"}</div>}

      {start&&end&&<p className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-xs text-white/50">Exact pickup and return times are chosen at checkout.</p>}
      {start&&end&&needsRequestReview&&<p role="status" className="rounded-xl border border-amber-300/20 bg-amber-300/[.05] p-3 text-xs leading-5 text-amber-100/80">{listing.bookable === false ? "Stock matching for this item isn't confirmed yet. Add it as a request; checkout blocks payment until the live stock check passes." : "This item is not confirmed available for these dates. Add it as a request to see matching alternatives in your kit; payment stays blocked until the full kit passes the stock check."}</p>}
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
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45" aria-label="Multi-day rental rates">
          {rateLadder.map((tier) => (
            <span key={tier.days}>
              {tier.label} <span className="font-medium text-white/70">£{tier.perDay}/day</span>
            </span>
          ))}
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
                Rental total · £{q.perDay}/day × {days} day{days > 1 ? "s" : ""}
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
            <p className="mt-2 text-right text-[11px] text-white/40">
              Date-based estimate. Confirm exact times and final price at checkout; delivery is quoted separately.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-white/[0.03] px-3 py-2.5 text-center text-xs text-white/40">
            Pick your dates on the calendar — longer rentals cost less per day
          </div>
        )}

        {q && (
          <div data-testid="desktop-security-details" className="mt-3 hidden rounded-xl bg-white/[0.03] p-3 text-xs text-white/55 sm:block">
            <p className="font-medium text-white/75">{securityHeading}</p>
            <p className="mt-1">{securityAmountDescription}</p>
            <p className="mt-1">{securityReturnDescription}</p>
          </div>
        )}
        <details data-testid="mobile-security-details" aria-label="Deposit and card authorisation details" className="group mt-3 rounded-xl border border-white/[0.07] bg-white/[0.025] sm:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black">
            <span className="min-w-0 flex-1 truncate font-medium text-white/75">Deposit &amp; card authorisation details</span>
            <span className="shrink-0 rounded-full bg-white/[0.05] px-2 py-1 text-[10px] text-white/55">{securitySummary}</span>
            <span aria-hidden="true" className="shrink-0 text-accent-300 transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="border-t border-white/[0.07] px-3 pb-3 pt-2 text-xs text-white/55">
            <p className="font-medium text-white/75">{securityHeading}</p>
            <p className="mt-1">{securityAmountDescription}</p>
            <p className="mt-1">{securityReturnDescription}</p>
          </div>
        </details>

        {/* availability (unit-aware, whole-cart) */}
        {start && end && !listing.marketingOnly && (
          <div className="mt-3 flex justify-center text-xs">
            {!validOrder ? (
              <span className="text-amber-200">Choose a valid date range.</span>
            ) : fit === undefined || !calendarStock.ready ? (
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

        {start && end && !listing.marketingOnly && listing.bookable !== false && cand && cand.available === 0 && (
          <WaitlistForm listingId={listing._id} start={startMs} end={endMs} />
        )}

        <button
          onClick={addToKit}
          disabled={!canAdd}
          data-testid="booking-add-to-kit"
          className="btn-primary mt-5 w-full py-3"
        >
          {!start || !end ? "Choose rental dates" : needsRequestReview ? "Add request to kit" : "Add to kit"}
        </button>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-white/40">
          <span>✓ Delivered across London</span>
              <span>✓ Security terms shown before payment</span>
          <span>✓ Pro-checked gear</span>
        </div>
      </div>
    </div>
  );
}
