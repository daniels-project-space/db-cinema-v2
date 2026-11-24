"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useConvex } from "convex/react";
import { api } from "@cvx/_generated/api";
import { dayMs, addDaysIso } from "@/lib/dates";
import { useAccount } from "@/components/account/AccountProvider";
import { formatGbp } from "@/lib/pricing";
import { rentalPricingDays } from "../../../shared/rentalDuration";
import { useCart, type CartItem } from "./CartProvider";

type Preview = { context: string; end: string; total: number; dailyRate: number; saving: number; extra: number; days: number };
type AppliedDuration = { days: number; saving: number };

export function CartThirdDayOffer({ item, currentTotal }: { item: CartItem; currentTotal: number }) {
  const cart = useCart(), account = useAccount(), convex = useConvex();
  const priceQuote = useAction(api.checkout.priceQuote);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState<AppliedDuration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoOfferKey = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const context = JSON.stringify({ items: cart.items, currentTotal, membership: cart.membership, promo: cart.promo, account: account.me?.email, token: account.token });
  const latestContext = useRef(context);
  latestContext.current = context;
  const activePreview = preview?.context === context ? preview : null;

  const checkDuration = useCallback(async (change: -1 | 1, confirmed?: Preview) => {
    if (busy || !Number.isFinite(currentTotal)) return;
    setBusy(true); setError(null); setPreview(null);
    try {
      const nextEnd = addDaysIso(item.end, change);
      if (nextEnd < item.start) throw new Error("A rental needs at least one day.");
      const nextItems = cart.items.map(line => ({
        listingId: line.listingId as any,
        title: line.title,
        start: dayMs(line.start),
        end: dayMs(line.key === item.key ? nextEnd : line.end),
        pickupTime: line.pickupTime || undefined,
        returnTime: line.returnTime || undefined,
        qty: 1,
        total: line.total,
        deposit: line.deposit,
        offerType: line.offerType,
      }));
      const availability = await convex.query(api.availability.forCart, { items: nextItems.map(({ listingId, start, end, pickupTime, returnTime, qty }) => ({ listingId, start, end, pickupTime, returnTime, qty })) });
      if (cart.items.some(line => availability[String(line.listingId)]?.ok !== true)) throw new Error("That duration does not fit the available stock for your whole kit.");
      const quote = await priceQuote({
        items: nextItems,
        customerEmail: account.me?.email ?? "",
        token: account.token && account.me ? account.token : undefined,
        selectedMembership: cart.membership ? { tier: cart.membership.tier, intro: cart.membership.intro } : undefined,
        promoCode: cart.promo ?? undefined,
        fulfilment: "pickup",
        protection: "verify",
      });
      const lineIndex = cart.items.findIndex(line => line.key === item.key);
      const pricedLine = quote.items[lineIndex];
      if (!pricedLine || quote.items.length !== cart.items.length || !Number.isFinite(pricedLine.total) || !Number.isFinite(pricedLine.dailyRate)) throw new Error("The updated rental price could not be checked. Please try again.");
      const billableDays = rentalPricingDays(dayMs(item.start), dayMs(nextEnd), item.pickupTime, item.returnTime);
      if (billableDays !== item.days + change) throw new Error(`Those exact times would price as ${billableDays} days. Use the date editor to review this change.`);
      const total = Math.round(pricedLine.total * 100) / 100;
      const extra = Math.round((total - currentTotal) * 100) / 100;
      const saving = Math.max(0, Math.round((pricedLine.dailyRate * billableDays - total) * 100) / 100);
      if (!mounted.current) return;
      if (latestContext.current !== context) throw new Error("Your basket changed. Review the refreshed offer and try again.");
      const nextPreview = { context, end: nextEnd, total, dailyRate: pricedLine.dailyRate, saving, extra, days: billableDays };
      if (confirmed && confirmed.context === context && confirmed.end === nextEnd && confirmed.total === total && confirmed.extra === extra) {
        cart.updateDates(item.key, item.start, nextEnd, total, item.pickupTime, item.returnTime,
          `${billableDays} rental day${billableDays === 1 ? "" : "s"} · ${formatGbp(total)} updated in your basket.`, { preserveMembership: true });
        setApplied({ days: billableDays, saving });
      } else {
        setPreview(nextPreview);
        if (confirmed) setError("The price changed. Review the updated offer before applying it.");
      }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not check this rental duration.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [account.me, account.token, busy, cart, context, convex, currentTotal, item, priceQuote]);

  useEffect(() => {
    if (item.days !== 2 || busy || activePreview) return;
    const key = context;
    if (autoOfferKey.current === key) return;
    autoOfferKey.current = key;
    void checkDuration(1);
  }, [busy, checkDuration, context, item.days, activePreview]);

  function apply() {
    if (!activePreview || busy) return;
    void checkDuration(activePreview.days > item.days ? 1 : -1, activePreview);
  }

  return <div className="min-w-0" data-testid="cart-duration-control">
    <div className="flex items-center justify-end gap-2">
      <span className="whitespace-nowrap font-display text-lg font-bold text-accent-400" data-testid="cart-item-price">{formatGbp(currentTotal)}</span>
      <div className="inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/[.035] p-0.5" aria-label={`Rental duration, ${item.days} days`}>
        <button type="button" aria-label={`Remove one rental day from ${item.title}`} onClick={() => void checkDuration(-1)} disabled={busy || item.days <= 1} className="grid h-7 w-7 place-items-center rounded-full text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 10h12"/></svg>
        </button>
        <span className="min-w-[2.8rem] px-1 text-center text-[10px] font-medium tabular-nums text-white/70">{item.days}d</span>
        <button type="button" aria-label={`Add one rental day to ${item.title}`} onClick={() => void checkDuration(1)} disabled={busy} className="grid h-7 w-7 place-items-center rounded-full text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-40">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M10 4v12M4 10h12"/></svg>
        </button>
      </div>
    </div>
    {item.days === 2 && !activePreview && !busy && !error && <p className="mt-1 whitespace-nowrap text-right text-[9px] leading-4 text-white/45">Use + to check the 3-day offer</p>}
    {busy && <p className="mt-1 text-right text-[10px] text-white/50" role="status">Checking stock and price…</p>}
    {activePreview && <div className="mt-2 rounded-xl border border-emerald-200/15 bg-emerald-200/[.055] p-2.5 text-left" data-testid="cart-duration-preview" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-medium text-white/80">{activePreview.days} {activePreview.days === 1 ? "day" : "days"} · {formatGbp(activePreview.total)}</span>
        {activePreview.extra > 0 ? <span className="text-white/55">+{formatGbp(activePreview.extra)}</span> : activePreview.extra < 0 ? <span className="text-emerald-200">−{formatGbp(-activePreview.extra)}</span> : <span className="text-emerald-200">Same price</span>}
      </div>
      <p className="mt-1 text-[10px] text-white/55">Gear estimate · discounts and fees confirmed at checkout</p>
      {activePreview.saving > 0 && <p className="mt-1 text-[10px] text-emerald-200">{item.days === 2 && activePreview.days === 3 ? "Add one day · " : ""}save {formatGbp(activePreview.saving)} vs the daily rate</p>}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button type="button" onClick={() => setPreview(null)} className="min-h-8 rounded-full px-3 text-[10px] text-white/55 hover:text-white">Cancel</button>
        <button type="button" onClick={apply} className="min-h-8 rounded-full bg-emerald-200 px-3.5 text-[10px] font-semibold text-emerald-950 transition hover:bg-emerald-100">Apply {activePreview.days} {activePreview.days === 1 ? "day" : "days"}</button>
      </div>
    </div>}
    {applied?.days === item.days && <p className="mt-1 text-right text-[10px] font-medium text-emerald-200" role="status" data-testid="cart-third-day-applied">{item.days}-day price applied{applied.saving > 0 ? ` · save ${formatGbp(applied.saving)} vs daily rate` : ""}</p>}
    {error && <p className="mt-1 text-right text-[10px] leading-4 text-amber-200" role="alert">{error}</p>}
  </div>;
}
