"use client";
import { listingMentions, createSpokenListingTracker, type Alignment } from "./spokenListings";
import { contentsText } from "../../../shared/rentalContents";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConvex, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { GAFFER_PRICE_CODE } from "@cvx/lib/gafferDiscount";
import { asksForBetterPrice } from "./priceRequest";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";
import {useCreditBalance} from "@/components/account/useCreditBalance";
import { refundableDepositFor, assessmentDepositFor, cardHoldFor, savedCardChargeLimit, immediateClaimSecurityLimit } from "../../../shared/rentalSecurity";
import { resolveDate, inclusiveDays, londonToday } from "@/lib/voiceDates";
import { dayMs } from "@/lib/dates";
import { rentalPricingDays } from "../../../shared/rentalDuration";
import { useGafferFocus, scrollToId } from "@/components/gaffer/GafferFocus";
import { voiceCartReviewSignature, voiceCartShareSignature } from "@/components/gaffer/cartSnapshot";

/**
 * Lets Gaffer act on the page while it talks.
 *
 * The webhook tools (/api/voice) can only answer questions — they run on the
 * server and can't touch the customer's screen. These are ElevenLabs *client*
 * tools: the agent calls them and they execute here, in the browser, so saying
 * "I'll pull that up for you" actually opens the product, and "shall I add it?"
 * actually fills the basket. Without them the call is a phone call that happens
 * to be in a browser tab.
 *
 * Every tool returns a short string. The agent reads it as the tool result, so
 * these double as its knowledge of what the customer can now see — which is why
 * they report the real outcome ("added, that's 2 items") rather than just "ok".
 */

/** Spoken destinations → routes. Category words go to the filtered gear page. */
const ROUTES: Record<string, string> = {
  home: "/", gear: "/gear", catalogue: "/gear", catalog: "/gear", shop: "/gear",
  basket: "/cart", cart: "/cart", checkout: "/checkout",
  account: "/account", profile: "/account",
  membership: "/membership", member: "/membership", join: "/join",
  about: "/about", faq: "/faq", help: "/faq", contact: "/contact",
  guides: "/guides", "how it works": "/how-it-works", assemble: "/assemble",
};

const CATEGORIES = [
  "Cameras", "Lenses", "Lighting", "Audio", "Monitors", "Drones",
  "Stabilizers", "Grip", "Power", "Accessories", "Packages", "Sound & DJ",
];

/**
 * Suppress entrance animations for navigations Gaffer performs.
 *
 * A page that fades and rises over ~0.9s reads as slow when the customer didn't
 * click anything and Gaffer is already talking about what's on screen. This
 * reuses the same escape hatch as `prefers-reduced-motion` (see globals.css) so
 * a customer navigating normally still gets the full treatment.
 */
function instant() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.gafferNav = "1";
  window.setTimeout(() => {
    delete document.documentElement.dataset.gafferNav;
  }, 1200);
}

function secureCartShareKey() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * The compat engine reports three levels; "info" is for the page, not a
 * phone call — a fixed-lens note or a redundant-lens heads-up reads as
 * competent on screen but as filler out loud. Only error/warn get said.
 */
function speakCompat(result: { warnings?: { level: string; text: string }[]; unknown?: boolean }): string {
  if (result.unknown) return " I couldn't verify kit compatibility just now, so please check the fit before booking.";
  const said = (result.warnings ?? []).filter((w) => w.level === "error" || w.level === "warn");
  if (!said.length) return "";
  return " Compatibility check: " + said.map((w) => w.text).join(" ");
}

export function useGafferTools() {
  const checkoutSettings = useQuery(api.settings.get, {});
  const router = useRouter();
  const priceRequested = useRef(false);
  const noteCustomerMessage = useCallback((message: string) => {
    if (asksForBetterPrice(message)) priceRequested.current = true;
  }, []);
  const resetPriceRequest = useCallback(() => { priceRequested.current = false; }, []);
  const cart = useCart();
  const account = useAccount();
  const accountCredit=useCreditBalance(account.token);
  const convex = useConvex();
  const catalogOnlyLines = useRef<Array<{ listingId: string; title: string; slug: string; heroImage: string | null }>>([]);
  const [catalogOnlyLinesView, setCatalogOnlyLinesView] = useState(catalogOnlyLines.current);
  const emailedCart = useRef<{email:string;shareKey:string;signature:string;expiresAt:number}|null>(null);
  const pendingEmailedCart = useRef<{email:string;shareKey:string;signature:string}|null>(null);
  const emailCartLink = async (email:string, signature:string, lines:Array<{listingId:any;start?:number;end?:number;pickupTime?:string;returnTime?:string}>, token?:string) => {
    const sent = emailedCart.current;
    if (sent?.email === email && sent.signature === signature && sent.expiresAt > Date.now()) return {shareKey:sent.shareKey,alreadySent:true};
    const pending = pendingEmailedCart.current;
    const shareKey = pending?.email === email && pending.signature === signature ? pending.shareKey : secureCartShareKey();
    pendingEmailedCart.current = {email,shareKey,signature};
    const result = await convex.action(api.checkoutCarts.email,{email,token,shareKey,lines});
    emailedCart.current = {email,shareKey:result.shareKey,signature,expiresAt:Date.now()+7*86400000};
    if (pendingEmailedCart.current?.shareKey === shareKey) pendingEmailedCart.current = null;
    return {shareKey:result.shareKey,alreadySent:false};
  };
  const cartAlternatives = useQuery(api.cartReplacements.forCart, cart.items.length ? {items:cart.items.map(i=>({key:i.key,listingId:i.listingId as any,start:dayMs(i.start),end:dayMs(i.end),pickupTime:i.pickupTime,returnTime:i.returnTime})),limit:6} : "skip");
  const replacementBrief = useCallback(async()=>{
    const rows=await convex.query(api.cartReplacements.forCart,{items:cart.items.map(i=>({key:i.key,listingId:i.listingId as any,start:dayMs(i.start),end:dayMs(i.end),pickupTime:i.pickupTime,returnTime:i.returnTime})),limit:6});
    if(rows.status!=="ready")return "Rental Manager stock is refreshing, so I cannot confirm current availability or replacements yet. Keep the original items and return times unchanged until the check completes.";
    return cart.items.filter(i=>Object.prototype.hasOwnProperty.call(rows.results,i.key)).map(i=>`${i.title} is unavailable for ${i.start} to ${i.end}. Available replacements for those same dates: ${(rows.results[i.key]??[]).map(c=>`${c.title} (£${c.total})`).join("; ")||"none found"}. The cart shows two initially; Show more replacements reveals more. Ask before changing their selection.`).join(" ");
  },[cart.items,convex]);
  const { focus, suggest, suggestedIds, focusedId } = useGafferFocus();
  const catalog = useQuery(api.catalog.listListings, {});
  const spokenState = useRef<any>(null);
  spokenState.current = { catalog, preferred: [focusedId,...suggestedIds].filter(Boolean), focus, router, cart };
  const spokenTracker = useRef<ReturnType<typeof createSpokenListingTracker> | null>(null);
  if (!spokenTracker.current) spokenTracker.current = createSpokenListingTracker(id=>{
    const state=spokenState.current;
    const onScreen=document.querySelector(`[data-listing-id="${CSS.escape(id)}"]`);
    if(onScreen)void state.focus(id,0);
    else { state.cart.close();const route="/gear?gaffer=1";state.router.push(route,{scroll:false});void state.focus(id,0,route); }
  });
  const resetSpokenFocus = useCallback(()=>{spokenTracker.current?.reset();void spokenState.current.focus(null);},[]);
  const noteAgentAlignment = useCallback((alignment:Alignment)=>{
    const state=spokenState.current;const rows=Array.isArray(state.catalog)?state.catalog:(state.catalog?.items??state.catalog?.listings??[]);
    spokenTracker.current?.alignment(alignment,rows,state.preferred);
  },[]);
  const noteAgentMessage = useCallback((message:string)=>{
    // Transcript fallback is deterministic; audio timings replace it once received.
    const state=spokenState.current;const rows=Array.isArray(state.catalog)?state.catalog:(state.catalog?.items??state.catalog?.listings??[]);
    const first=listingMentions(message,rows,state.preferred)[0];
    if(first){const onScreen=document.querySelector(`[data-listing-id="${CSS.escape(first.id)}"]`);if(onScreen)void state.focus(first.id,0);}
  },[]);
  useEffect(()=>()=>spokenTracker.current?.reset(),[]);
  /**
   * Has the customer been shown the basket breakdown yet this basket?
   * Reset whenever the basket changes, so adding something after reviewing
   * means they see the new total before paying rather than skipping past it.
   */
  const reviewed = useRef<string | null>(null);
  const currentCart = useRef(cart);
  currentCart.current = cart;
  const cartShareSnapshot = (items: typeof cart.items) => {
    const cartListingIds = new Set(items.map(item => item.listingId));
    const shareItems = [
      ...items.map(item => ({ listingId: item.listingId, start: item.start, end: item.end, pickupTime: item.pickupTime, returnTime: item.returnTime })),
      ...catalogOnlyLines.current.filter(item => !cartListingIds.has(item.listingId)).map(item => ({ listingId: item.listingId, start: "", end: "", pickupTime: undefined, returnTime: undefined })),
    ];
    return {
      signature: voiceCartShareSignature(shareItems),
      lines: shareItems.map(item => ({
        listingId: item.listingId as any,
        ...(item.start && item.end ? { start: dayMs(item.start), end: dayMs(item.end) } : {}),
        ...(item.start && item.end && item.pickupTime && item.returnTime ? { pickupTime: item.pickupTime, returnTime: item.returnTime } : {}),
      })),
      items: shareItems,
    };
  };
  const currentCartShareSignature = () => cartShareSnapshot(currentCart.current.items).signature;
  const reviewContext = {
    accountId: account.me?._id ?? null, email: account.me?.email ?? null,
    membershipTier: account.me?.membershipTier ?? null, membershipActive: account.me?.membershipActive ?? null,
    membershipStatus: account.me?.membershipStatus ?? null, membershipPaidThrough: account.me?.membershipPaidThrough ?? null,
    membershipTrialEnd: account.me?.membershipTrialEnd ?? null, membershipPerksPending: account.me?.membershipPerksPending ?? null,
    membershipAdminGranted: account.me?.membershipAdminGranted ?? null, membershipBillingTier: account.me?.membershipBillingTier ?? null,
    creditAccountId: accountCredit?.accountId ?? null, creditAvailable: accountCredit?.available ?? null, creditNextExpiry: accountCredit?.nextExpiry ?? null,
    cancellationProtection: checkoutSettings?.cancellationProtectionEnabled ?? null,
    setupIntentSecurity: checkoutSettings?.setupIntentSecurityEnabled ?? null,
    assessmentSecurity: checkoutSettings?.assessmentSecurityEnabled ?? null,
  };
  const currentReviewContext = useRef(reviewContext);
  currentReviewContext.current = reviewContext;

  /** Resolve a spoken item name to a real listing via the same matcher the phone line uses. */
  const findOne = useCallback(
    async (item: string) => {
      const res: any = await convex.query(api.voiceCatalog.search, { q: String(item ?? ""), limit: 1 });
      return res?.matches?.[0] ?? null;
    },
    [convex],
  );

  /** Several candidates — a spoken request often matches a bundle and a body. */
  const findMany = useCallback(
    async (item: string, limit = 4): Promise<any[]> => {
      const res: any = await convex.query(api.voiceCatalog.search, { q: String(item ?? ""), limit });
      return res?.matches ?? [];
    },
    [convex],
  );

  /**
   * Check the whole proposed basket, including this candidate, against shared
   * inventory. Exact pickup and return times are deliberately omitted here;
   * checkout collects them and runs the final authoritative stock check.
   *
   * `unknown` on a query failure is distinct from `available: 0`: a flaky
   * query should not tell a customer their kit is booked out.
   */
  const availabilityFor = useCallback(
    async (listingId: string, startIso: string, endIso: string) => {
      try {
        const proposedItems = [
          ...cart.items.map(item => ({
            listingId: item.listingId as any,
            start: dayMs(item.start),
            end: dayMs(item.end),
            pickupTime: item.pickupTime,
            returnTime: item.returnTime,
          })),
          { listingId: listingId as any, start: dayMs(startIso), end: dayMs(endIso) },
        ];
        const r: any = await convex.query(api.availability.forCart, { items: proposedItems });
        const uniqueListingIds = [...new Set(proposedItems.map(item => String(item.listingId)))];
        const unknownBasket = uniqueListingIds.some(id => !r?.[id] || typeof r[id].ok !== "boolean" ||
          typeof r[id].available !== "number" || !Number.isFinite(r[id].available) || r[id].available < 0);
        const unavailableBasket = uniqueListingIds.filter(id => r?.[id]?.ok === false);
        const candidate = r?.[listingId];
        if (!candidate || typeof candidate.ok !== "boolean" || typeof candidate.available !== "number" || !Number.isFinite(candidate.available) || candidate.available < 0)
          return { available: 0, blocked: false, unknown: true, needsTimes: false, unknownBasket, unavailableBasket };
        return { available: candidate.ok ? candidate.available : 0, blocked: false, unknown: false, needsTimes: false, unknownBasket, unavailableBasket };
      } catch {
        return { available: 0, blocked: false, unknown: true, needsTimes: false, unknownBasket: true, unavailableBasket: [] as string[] };
      }
    },
    [convex, cart.items],
  );

  /** Resolve only the dates and times the customer selected; never lengthen them to meet a listing minimum. */
  const resolveWindow = useCallback((start?: string, end?: string) => {
    const today = londonToday();
    const requestedStart = String(start ?? "").trim();
    const requestedEnd = String(end ?? "").trim();
    const s = requestedStart ? resolveDate(requestedStart, today) : null;
    const e = requestedEnd ? resolveDate(requestedEnd, today) : null;
    const first = cart.items[0];
    const oneBasketWindow = first && first.start && first.end && cart.items.every(line =>
      line.start === first.start && line.end === first.end,
    ) ? first : null;
    const inheritBasketWindow = !requestedStart && !requestedEnd && !!oneBasketWindow;
    const invalidDate = (!!requestedStart && !s?.ok) || (!!requestedEnd && !e?.ok);
    const startIso = invalidDate ? "" : s?.ok ? s.date : inheritBasketWindow ? oneBasketWindow!.start : "";
    const endIso = invalidDate ? "" : e?.ok ? e.date : inheritBasketWindow ? oneBasketWindow!.end : "";
    const needsDates = !startIso || !endIso;
    const matching = cart.items.filter(line => line.start === startIso && line.end === endIso);
    const selected = matching[0];
    const timesAgree = !!selected?.pickupTime && !!selected?.returnTime && matching.every(line =>
      line.pickupTime === selected.pickupTime && line.returnTime === selected.returnTime,
    );
    const days = needsDates ? 0 : timesAgree
      ? rentalPricingDays(dayMs(startIso), dayMs(endIso), selected.pickupTime, selected.returnTime)
      : inclusiveDays(startIso, endIso);
    return { startIso, endIso, days, needsDates, inheritedDates: inheritBasketWindow && !needsDates };
  }, [cart.items]);

  /**
   * Guard against booking the wrong bundle.
   *
   * The catalogue has several near-identical bodies that differ only by the
   * lens in the box — an a7 III with a 28-70 and an a7 III with a GM 24-70 are
   * different listings at different prices. Title matching alone picks one of
   * them, so someone asking for "the a7 III with the 24-70" can end up booked
   * on the 28-70 and only discover it at collection.
   *
   * If the caller named a focal length and the match doesn't carry it, look for
   * a sibling that does rather than adding the wrong one.
   */
  const lensMismatch = useCallback(
    async (request: string, hit: any): Promise<{ wanted: string; better: any | null } | null> => {
      const wanted = String(request ?? "").match(/(\d{2,3})\s*(?:-|to|–)\s*(\d{2,3})/);
      if (!wanted) return null;
      const asked = `${wanted[1]}-${wanted[2]}`;
      const got = hit?.lensFocal ? String(hit.lensFocal) : null;
      if (got === asked) return null;
      // nothing bundled and nothing asked-for to contradict → not a mismatch
      if (!hit?.includesLens && !got) return null;

      // Prefer the same body carrying the right glass over any old listing that
      // happens to include that focal length — offering a bare lens when they
      // asked for the camera-with-lens bundle is its own kind of wrong.
      const siblings = (await findMany(request, 10)).filter(
        (s: any) => String(s.lensFocal ?? "") === asked && s.id !== hit.id,
      );
      const words = (s: string) =>
        new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
      const hitWords = words(hit.title);
      const overlap = (s: any) => [...words(s.title)].filter((w) => hitWords.has(w)).length;
      const better =
        siblings.slice().sort((a: any, b: any) => overlap(b) - overlap(a))[0] ?? null;
      return { wanted: asked, better };
    },
    [findMany],
  );

  /**
   * In-category substitutes that are actually free, minus anything already held.
   *
   * Was reading from `catalog.listListings` — the query built for the public
   * /gear page, which keeps display-only marketing rows visible on purpose
   * (sunk to the bottom, not hidden, for a human scrolling past them). A voice
   * call has no bottom of the page: whatever this returned, Gaffer would offer
   * as a real booking. `voiceCatalog.byCategory` is the same bookable-only
   * gate every other Gaffer-facing query in this file already goes through.
   */
  const alternativesFor = useCallback(
    async (hit: any, startIso: string, endIso: string, limit = 3) => {
      if (!hit?.category) return { items: [], unknown: true };
      let rows: any[];
      try {
        const result: any = await convex.query(api.voiceCatalog.byCategory, { category: hit.category, limit: 12 });
        if (!Array.isArray(result)) return { items: [], unknown: true };
        rows = result;
      } catch {
        return { items: [], unknown: true };
      }
      const out: { title: string; daily: number }[] = [];
      let unknown = false;
      for (const r of rows) {
        const id = String(r.id);
        if (id === hit.id || cart.has(id)) continue;
        const a = await availabilityFor(id, startIso, endIso);
        if (a.unknown) {
          unknown = true;
          continue;
        }
        if (a.available >= 1) out.push({ title: r.title, daily: r.daily ?? 0 });
        if (out.length >= limit) break;
      }
      return { items: out, unknown };
    },
    [convex, cart, availabilityFor],
  );

  /** Availability across every basket line, unit-aware (shared inventory included). */
  const basketProblems = useCallback(async () => {
    if (!cart.items.length) return null;
    try {
      const res: any = await convex.query(api.availability.forCart, {
        items: cart.items.map((i) => ({ listingId: i.listingId as any, start: dayMs(i.start), end: dayMs(i.end),pickupTime:i.pickupTime,returnTime:i.returnTime })),
      });
      if (!res || cart.items.some(item => typeof res[item.listingId]?.ok !== "boolean")) return null;
      return cart.items.filter((i) => !res[i.listingId].ok);
    } catch {
      return null;
    }
  }, [convex, cart]);

  /**
   * Mount, coverage, filter thread, battery — the same cross-item engine the
   * cart page itself uses (src/lib/compat.ts, via /api/compat), so Gaffer can
   * never disagree with what the customer sees on screen. Not reimplemented
   * here: that engine needs full specs per item (mount, filter thread,
   * battery type) that the cart only carries a price/title summary of, and
   * the route already does the spec lookup — hitting it is simpler and
   * guaranteed consistent, not a shortcut around real logic.
   */
  const compatWarnings = useCallback(async () => {
    if (cart.items.length < 2) return { warnings: [], upgrades: [] };
    try {
      const r = await fetch("/api/compat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: cart.items.map((i) => ({ listingId: i.listingId, title: i.title, total: i.total, start: i.start, end: i.end, pickupTime: i.pickupTime, returnTime: i.returnTime })),
        }),
      });
      if (!r.ok) return { warnings: [], upgrades: [], unknown: true };
      const result = await r.json();
      if (!result || result.unknown || result.error || !Array.isArray(result.warnings) || !Array.isArray(result.upgrades))
        return { warnings: [], upgrades: [], unknown: true };
      return result;
    } catch {
      return { warnings: [], upgrades: [], unknown: true };
    }
  }, [cart]);

  const securitySummary = useCallback(() => {
    const credit=accountCredit&&accountCredit.accountId===account.me?._id?` Available account credit is £${accountCredit.available.toFixed(2)}. ${accountCredit.available>0?"Choose Use account credit at checkout to apply it; the checkbox is hidden without an available balance.":"No account credit is currently available for this checkout."} Credit cannot pay separately quoted security amounts or membership fees and cannot be withdrawn as cash; the account receipts show its expiry.`:" Account credit is selected at checkout only when an available signed-in balance exists.";
    const protection=checkoutSettings?.cancellationProtectionEnabled?` The free cancellation-protection shield card opens the policy. If DB cancels before pickup, all accounts can receive a refund. Accounts not rejected or restricted for a terms violation may receive private email choices after the one-hour decision: original-payment refund or 130% rental credit valid 365 days; rejected or restricted accounts receive the refund only.${checkoutSettings?.setupIntentSecurityEnabled?" No security funds are held.":checkoutSettings?.cardHoldSecurityEnabled?" The uncaptured card hold is cancelled separately.":" Deposits are returned separately."} Opening an email link does not execute a choice.`:"";
    if(checkoutSettings?.setupIntentSecurityEnabled) return `No security deposit or card hold is charged or reserved. Stripe saves the card for a combined post-return claim ceiling of £${immediateClaimSecurityLimit(cart.depositTotal).toFixed(2)} based on equipment value. A team member records evidence and sends an itemised notice before one immediate attempt; no automatic charge on an on-time return without a reported issue. The bank may decline it or require authentication. Insurance is separate.${credit}${protection}`;
    if(checkoutSettings?.cardHoldSecurityEnabled) return `The temporary card hold is £${cardHoldFor(cart.depositTotal).toFixed(2)} based on equipment replacement value. A £0 exemption applies only below £4,000 after the same account completes a clean rental with settled security and has a paid active subscription after its first recurring payment or the final Encore tier; first rentals and free trials never qualify. The hold is not a payment, but your bank may reduce available balance. If pickup is over seven days away, the hold may expire; we request a replacement five hours before pickup and release the old hold only after the new one succeeds. An issue-free return cancels the uncaptured hold; the bank controls release timing. Any claim needs a specific recorded reason and evidence.${credit}${protection}`;
    if(checkoutSettings?.assessmentSecurityEnabled) return `The refundable deposit is £20 below £1,000 equipment value, £50 from £1,000 and £100 from £4,000. A £0 waiver applies only below £4,000 after the same account completes a clean rental with settled security, and has either a paid active subscription after its first recurring payment or final Encore tier. First rentals and free trials do not qualify. Stripe saves a card for evidenced claims; any retained deposit reduces that same assessment. Collection needs itemised notice and review.${credit}${protection}`;
    const cash = checkoutSettings?.refundableDepositEnabled === true ? refundableDepositFor(cart.depositTotal) : null;
    return `${cash === null ? "The final checkout quote confirms whether a refundable deposit is due." : cash > 0 ? `A refundable £${cash.toFixed(2)} deposit is paid at checkout.` : "No refundable deposit is due below £1,000 equipment value."} The combined saved-card damage/loss and late-fee permission is £${savedCardChargeLimit(cart.depositTotal).toFixed(2)}, subject to the final quote and explicit consent. Any retained deposit reduces later charges for the same loss. Later collection requires itemised evidence, at least seven days for review and admin action.${credit}${protection}`;
  }, [checkoutSettings?.setupIntentSecurityEnabled,checkoutSettings?.cardHoldSecurityEnabled,checkoutSettings?.assessmentSecurityEnabled, checkoutSettings?.refundableDepositEnabled,checkoutSettings?.cancellationProtectionEnabled,accountCredit,account.me?._id,cart.depositTotal]);

  const rentalSummary = useCallback(async () => {
    if (!cart.promo) return `£${cart.subtotal}`;
    const result = await convex.query(api.promo.validate, {
      code: cart.promo, eligibleSubtotal: cart.eligibleSubtotal, rentalSubtotal: cart.subtotal,
      tier: account.me?.membershipTier ?? undefined, membershipActive: !!account.me?.membershipActive,
      email: account.me?.email,
    });
    return result.valid ? `£${cart.subtotal - result.discount} after a £${result.discount} saving` : `£${cart.subtotal}`;
  }, [cart, account, convex]);

  const clientTools = useMemo(
    () => ({
      request_better_price: async () => {
        if (!priceRequested.current) return "No discount applied: the caller has not asked for a better price. Do not offer this proactively.";
        const args = { eligibleSubtotal: cart.eligibleSubtotal, rentalSubtotal: cart.subtotal,
          tier: account.me?.membershipTier ?? undefined, membershipActive: !!account.me?.membershipActive, email: account.me?.email };
        const deal = await convex.query(api.promo.validate, { ...args, code: GAFFER_PRICE_CODE });
        if (!deal.valid) return `No discount applied: ${deal.reason}.`;
        if (cart.promo && cart.promo !== GAFFER_PRICE_CODE) {
          const current = await convex.query(api.promo.validate, { ...args, code: cart.promo });
          if (current.valid && current.discount >= deal.discount) return `Your existing code already saves £${current.discount}; kept the better price.`;
        }
        cart.setPromo(GAFFER_PRICE_CODE);
        return `Applied 10% to the eligible rental lines: saving £${deal.discount}, rental total £${cart.subtotal - deal.discount}. Already-discounted add-ons keep their existing price. Deposits and delivery are unchanged; checkout keeps any better membership discount.`;
      },
      /** "Show me your lighting" / "take me to the basket". */
      navigate_to: async ({ destination }: { destination: string }) => {
        const d = String(destination ?? "").toLowerCase().trim();
        instant();
        cart.close();

        const direct = ROUTES[d];
        if (direct) {
          router.push(direct, { scroll: direct !== "/gear" });
          if (direct === "/gear" && !await scrollToId("gear-toolbar", direct))
            return "Catalogue requested, but it has not finished loading on screen.";
          return `Opened ${d}.`;
        }
        const cat = CATEGORIES.find((c) => c.toLowerCase() === d || c.toLowerCase().startsWith(d));
        if (cat) {
          const route = `/gear?cat=${encodeURIComponent(cat)}`;
          router.push(route, { scroll: false });
          const shown = await scrollToId("gear-toolbar", route);
          return shown ? `Showing ${cat} on screen.` : `Requested ${cat}, but the catalogue has not finished loading on screen.`;
        }
        const route = `/gear?q=${encodeURIComponent(d)}`;
        router.push(route, { scroll: false });
        const shown = await scrollToId("gear-toolbar", route);
        return shown ? `Searching the catalogue for ${d}.` : `Search for ${d} requested, but the catalogue has not finished loading on screen.`;
      },

      /**
       * "Let's see what lenses you've got free that week" — filters the
       * catalogue on screen AND reports which of the results are actually
       * available, so Gaffer offers real options rather than reading out a grid
       * that might be half booked.
       */
      browse_for: async ({ item, category, start, end }: { item?: string; category?: string; start?: string; end?: string }) => {
        const cat = category
          ? CATEGORIES.find((c) => c.toLowerCase().startsWith(String(category).toLowerCase()))
          : undefined;
        const q = String(item ?? "").trim();
        const qs = new URLSearchParams();
        if (cat) qs.set("cat", cat);
        if (q) qs.set("q", q);
        cart.close();
        const hits = q ? await findMany(q, 4) : [];
        if (hits.length) qs.set("gaffer", "1");
        const route = `/gear?${qs.toString()}`;
        instant();
        router.push(route, { scroll: false });
        const shown = hits.length ? await suggest(hits.map((h) => h.id), route) : false;
        if (!hits.length) {
          /**
           * A category-only browse ("show me lighting") has no single item to
           * focus, so nothing ever scrolled — the customer was left looking at
           * the hero and assembly card while the actual, correctly filtered
           * results sat a full screen below the fold. Scroll to the toolbar
           * regardless of whether a specific item was found.
           */
          const shown = await scrollToId("gear-toolbar", route);
          return shown ? `Showing ${cat ?? "the catalogue"} on screen.` : "Catalogue requested, but it has not finished loading on screen.";
        }

        const w = resolveWindow(start, end);
        if (w.needsDates) {
          const options = hits.map(h => `${h.title} at £${h.daily} a day${h.minDays > 1 ? ` (${h.minDays}-day minimum)` : ""}`).join("; ");
          return `${shown ? "Catalogue options are on screen." : "Catalogue results are not finished loading on screen."} ${options}. Tell me the hire dates to check availability. Exact times are selected at checkout.`;
        }
        const free: string[] = [];
        const unconfirmed: string[] = [];
        const taken: string[] = [];
        const minimumPeriod: string[] = [];
        for (const h of hits) {
          const minimumDays = Number.isSafeInteger(h.minDays) && h.minDays > 0 ? h.minDays : 1;
          if (w.days < minimumDays) {
            minimumPeriod.push(`${h.title} has a ${minimumDays}-day minimum; these dates cover ${w.days} rental day${w.days === 1 ? "" : "s"}. Stock for a longer rental hasn't been checked.`);
            continue;
          }
          const a = await availabilityFor(h.id, w.startIso, w.endIso);
          (a.unknown ? unconfirmed : a.available >= 1 ? free : taken).push(`${h.title} at £${h.daily} a day. ${contentsText(h)}`);
        }
        if (unconfirmed.length) return `${shown ? "On screen now." : "Found options, but the catalogue has not finished loading on screen."} Catalogue options: ${unconfirmed.join("; ")}. Availability could not be confirmed just now. Exact times are selected at checkout, where stock is checked again.${minimumPeriod.length ? ` ${minimumPeriod.join(" ")}` : ""}`;
        if (!free.length && minimumPeriod.length && !taken.length) return `For ${w.startIso} to ${w.endIso}, ${minimumPeriod.join(" ")} Would you like to choose dates that meet the minimum?`;
        if (!free.length) return `Nothing matching ${q} is free ${w.startIso} to ${w.endIso}.${taken.length ? ` Booked: ${taken.join("; ")}.` : ""}${minimumPeriod.length ? ` ${minimumPeriod.join(" ")}` : ""}`;
        return (
          `${shown ? "On screen now." : "Found these options, but the catalogue has not finished loading on screen."} Free ${w.startIso} to ${w.endIso}: ${free.join("; ")}.` +
          (taken.length ? ` Already booked: ${taken.join("; ")}.` : "") +
          ` Exact pickup and return times are selected at checkout; availability is rechecked then.` +
          (minimumPeriod.length ? ` ${minimumPeriod.join(" ")} Would you like to check a longer period?` : "")
        );
      },

      /** Availability question without moving the customer off the page. */
      find_gear: async ({ item, start, end }: { item: string; start?: string; end?: string }) => {
        const hits = await findMany(item, 3);
        if (!hits.length) return `Nothing in the catalogue matches ${item}.`;
        const w = resolveWindow(start, end);
        if (w.needsDates) {
          const options = hits.map(h => `${h.title}, £${h.daily} a day${h.minDays > 1 ? ` (${h.minDays}-day minimum)` : ""}`).join("; ");
          return `I need the rental dates to check availability. Options: ${options}. What dates should I check? Exact pickup and return times are chosen at checkout.`;
        }
        const lines: string[] = [];
        for (const h of hits) {
          const minimumDays = Number.isSafeInteger(h.minDays) && h.minDays > 0 ? h.minDays : 1;
          if (w.days < minimumDays) {
            lines.push(`${h.title}, £${h.daily} a day — ${minimumDays}-day minimum; your dates cover ${w.days} day${w.days === 1 ? "" : "s"}. Availability for the longer period hasn't been checked.`);
            continue;
          }
          const a = await availabilityFor(h.id, w.startIso, w.endIso);
          lines.push(
            a.unknown
              ? `${h.title}, £${h.daily} a day (could not confirm stock just now; exact times are selected at checkout)`
              : a.available >= 1
                ? `${h.title}, £${h.daily} a day — ${a.available} free for those dates; final stock is rechecked at checkout`
                : `${h.title} — booked out for those dates`,
          );
        }
        return `For ${w.startIso} to ${w.endIso}: ${lines.join("; ")}. ` +
          hits.map(h=>`Contents for "${h.title}": ${contentsText(h)}`).join(' ');
      },

      /**
       * "Let's have a look at what we've got" — the recommendation tool.
       *
       * Filters the real catalogue page to what was asked for, highlights the
       * shortlist and scrolls the top pick into view, then reports back what is
       * on screen with prices and what is and isn't in the case. Bare items are
       * offered before sets: the catalogue is overwhelmingly combos, so asking
       * for "a Sony camera" otherwise buries the bodies under
       * body-plus-lens-plus-tripod listings.
       */
      recommend_gear: async ({ item, category }: { item?: string; category?: string }) => {
        cart.close();
        const q = String(item ?? "").trim();
        const cat = category
          ? CATEGORIES.find((c) => c.toLowerCase().startsWith(String(category).toLowerCase()))
          : undefined;

        let res: any;
        try {
          res = await convex.query(api.voiceCatalog.recommend, {
            q: q || undefined,
            category: cat,
            cartListingIds: cart.items.map(item => item.listingId as any),
            limit: 6,
          });
        } catch {
          return "Couldn't pull the catalogue up just now.";
        }

        const picks = [...(res.standalone ?? []), ...(res.bundles ?? [])];
        if (!picks.length) return `Nothing in the catalogue matches ${q || cat || "that"}.`;

        // put them on the real page, filtered the same way
        const qs = new URLSearchParams();
        if (res.category) qs.set("cat", res.category);
        if (res.brand) qs.set("q", res.brand);
        else if (q) qs.set("q", q);
        qs.set("gaffer", "1");
        const route = `/gear?${qs.toString()}`;
        instant();
        cart.close();
        router.push(route, { scroll: false });
        const shown = await suggest(picks.map((p: any) => p.id), route);

        const line = (p: any) => `${p.title} at £${p.daily} a day. ${p.fitNeedsConfirmation ? "Exact camera/rig fit still needs checking. " : ""}${contentsText(p)}`;

        const parts: string[] = [];
        if (res.standalone?.length)
          parts.push(`On their own: ${res.standalone.slice(0, 3).map(line).join(". ")}.`);
        if (res.bundles?.length)
          parts.push(`With extras included: ${res.bundles.slice(0, 3).map(line).join(". ")}.`);
        return (
          `${shown ? `${picks.length} on screen and highlighted` : "Catalogue requested but screen is still loading"}. ${parts.join(" ")} ` +
          `Offer the bare item first unless they asked for a set, and say what isn't included.`
        );
      },

      /** "That one" — lights the tile up without touching the basket. */
      select_item: async ({ item }: { item: string }) => {
        const hit = await findOne(item);
        if (!hit) return `Couldn't find ${item} on screen.`;
        cart.close();
        const route = `/gear?q=${encodeURIComponent(hit.title)}&gaffer=1`;
        instant();
        router.push(route, { scroll: false });
        await suggest([hit.id], route);
        const shown = await focus(hit.id, undefined, route);
        return shown ? `Highlighted ${hit.title} on screen.` : `Found ${hit.title}, but the screen is still loading.`;
      },

      /** "Let me show you the FX3" — opens the actual product page. */
      show_gear: async ({ item }: { item: string }) => {
        cart.close();
        const hit = await findOne(item);
        if (!hit) return `Couldn't find ${item} to show.`;
        instant();
        router.push(`/gear/${hit.slug}`);
        const full = await convex.query(api.catalog.getListingBySlug,{slug:hit.slug});
        return `Showing ${hit.title} on screen, £${hit.daily} a day. ${contentsText(full)}`;
      },

      /**
       * "Shall I put that in your basket?" — checks it's actually free, lights
       * the tile up, then adds it a beat later so the customer watches the pick
       * land rather than a number changing off screen.
       *
       * Refuses rather than adding a line that can't be fulfilled: the basket
       * page gates checkout on the same availability data, so an unavailable
       * line is a dead end the customer would only discover later.
       */
      add_to_basket: async ({ item, start, end }: { item: string; start?: string; end?: string }) => {
        const hit = await findOne(item);
        if (!hit) return `Couldn't find ${item} to add.`;
        if (cart.has(hit.id)) return `${hit.title} is already in the basket.`;

        // Wrong-lens guard: don't book the 28-70 body when they asked for the
        // 24-70 one. Check before anything goes in the basket.
        const lens = await lensMismatch(item, hit);
        if (lens) {
          return lens.better
            ? `Careful — "${hit.title}" comes with the ${hit.lensFocal ?? "kit"} lens, not the ` +
                `${lens.wanted} they asked for. There is a separate listing with the ${lens.wanted}: ` +
                `"${lens.better.title}" at £${lens.better.daily} a day. Confirm which one they want, ` +
                `then add that one by name.`
            : `Careful — "${hit.title}" comes with the ${hit.lensFocal ?? "kit"} lens, not the ` +
                `${lens.wanted}. We don't have that body bundled with a ${lens.wanted}; offer the ` +
                `${lens.wanted} as a separate hire alongside it, or this bundle as it is.`;
        }

        const { startIso, endIso, days, needsDates, inheritedDates } = resolveWindow(start, end);
        if (needsDates) {
          if (String(start ?? "").trim() || String(end ?? "").trim())
            return `I need both the first and return dates for ${hit.title}; I haven't added it or checked stock. Exact pickup and return times are selected at checkout.`;
          if (catalogOnlyLines.current.some(line => line.listingId === hit.id)) return `${hit.title} is already in the proposed kit; it has no dates or availability check yet.`;
          const next = [...catalogOnlyLines.current, {
            listingId: hit.id,
            title: hit.title,
            slug: hit.slug,
            heroImage: hit.heroImage ?? null,
          }];
          catalogOnlyLines.current = next;
          setCatalogOnlyLinesView(next);
          return `Added ${hit.title} to a proposed kit. It has no dates yet, so I haven't checked availability or quoted a price. I can email a private link with the real listing photo; checkout will collect dates before checking stock and price.`;
        }
        const minimumDays = Number.isSafeInteger(hit.minDays) && hit.minDays > 0 ? hit.minDays : 1;
        if (days < minimumDays) {
          return `${hit.title} has a ${minimumDays}-day minimum. These dates cover ${days} rental day${days === 1 ? "" : "s"}, so I haven't added it or changed your dates. Would you like to choose dates covering at least ${minimumDays} days?`;
        }
        const stock = await availabilityFor(hit.id, startIso, endIso);

        if (stock.unknown || stock.unknownBasket)
          return "I couldn't confirm availability for every item in the proposed basket, so I haven't added anything. Please try again.";

        if (stock.unavailableBasket?.some(id => id !== hit.id))
          return "At least one item already in the basket is unavailable for its selected dates, so I haven't added anything. Please review the basket first.";

        if (!stock.unknown && stock.available < 1) {
          const alternatives = await alternativesFor(hit, startIso, endIso);
          const line = `${hit.title} is booked out ${startIso} to ${endIso}, so I haven't added it.`;
          return alternatives.items.length
            ? `${line} Free instead: ${alternatives.items.map((a) => `${a.title} at £${a.daily} a day`).join("; ")}. ${alternatives.unknown ? "I couldn't confirm other alternatives just now." : "Want one of those?"}`
            : `${line} ${alternatives.unknown ? "I couldn't confirm whether any other items are free just now — shall I try different dates?" : `Nothing else in ${hit.category} is free then either — shall I try different dates?`}`;
        }

        if (!hit.pricing || !Number.isFinite(hit.pricing.daily) || hit.pricing.daily <= 0)
          return "I couldn't confirm the current rental price for " + hit.title + ", so I haven't added it. Please try again.";
        let quotedLineTotal: number;
        let basketRentalTotal: number;
        let sameDayFee = 0;
        try {
          const proposedItems = [
            ...cart.items.map(item => ({
              listingId: item.listingId as any,
              title: item.title,
              start: dayMs(item.start),
              end: dayMs(item.end),
              pickupTime: item.pickupTime || undefined,
              returnTime: item.returnTime || undefined,
              qty: 1,
              total: item.total,
              deposit: item.deposit,
              offerType: item.offerType,
            })),
            {
              listingId: hit.id as any,
              title: hit.title,
              start: dayMs(startIso),
              end: dayMs(endIso),
              qty: 1,
              total: 0,
              deposit: hit.deposit ?? 0,
            },
          ];
          const quoteResult = await convex.action(api.checkout.priceQuote, {
            items: proposedItems,
            token: account.token && account.me ? account.token : undefined,
            customerEmail: account.me?.email ?? "",
            selectedMembership: cart.membership
              ? { tier: cart.membership.tier, intro: cart.membership.intro }
              : undefined,
            useAccountCredit: false,
            fulfilment: "pickup",
            promoCode: cart.promo ?? undefined,
            protection: "verify",
          });
          const candidateLine = quoteResult.items?.[proposedItems.length - 1];
          quotedLineTotal = Number(candidateLine?.total);
          const subtotal = Number(quoteResult.subtotal);
          const totalReduction = Number(quoteResult.totalReduction);
          sameDayFee = Number(quoteResult.sameDayFee ?? 0);
          basketRentalTotal = (Math.round(subtotal * 100) - Math.round(totalReduction * 100) + Math.round(sameDayFee * 100)) / 100;
          if (quoteResult.items?.length !== proposedItems.length || !Number.isFinite(quotedLineTotal) || quotedLineTotal < 0 ||
              !Number.isFinite(subtotal) || subtotal < 0 || !Number.isFinite(totalReduction) || totalReduction < 0 ||
              !Number.isFinite(sameDayFee) || sameDayFee < 0 || !Number.isFinite(basketRentalTotal) || basketRentalTotal < 0)
            throw new Error("Invalid complete basket quote.");
        } catch {
          return "I couldn't confirm the complete basket price, so I haven't added anything. Please try again.";
        }
        const q = { total: quotedLineTotal, perDay: Math.round((quotedLineTotal / days) * 100) / 100 };

        // the pick lands on screen first, the basket a moment later
        focus(hit.id);
        await new Promise((r) => setTimeout(r, 1000));

        cart.add({
          listingId: hit.id,
          slug: hit.slug,
          title: hit.title,
          heroImage: hit.heroImage ?? null,
          start: startIso,
          end: endIso,
          days,
          perDay: q.perDay,
          total: q.total,
          deposit: hit.deposit ?? 0,
        });
        if (catalogOnlyLines.current.some(line => line.listingId === hit.id)) {
          const next = catalogOnlyLines.current.filter(line => line.listingId !== hit.id);
          catalogOnlyLines.current = next;
          setCatalogOnlyLinesView(next);
        }
        /**
         * The drawer's backdrop is a full-screen black/65 overlay — opening it
         * right on top of the add covered the highlighted, dimmed-around card
         * before the confirm had time to register as anything more than a
         * hover flicker. This beat lets the pick actually land in view first;
         * the glow (2.6s total) is still visible once the drawer slides over.
         */
        await new Promise((r) => setTimeout(r, 450));
        cart.open();
        return (
          `Added ${hit.title}` +
          (hit.includesLens && hit.lensFocal ? ` (includes the ${hit.lensFocal} lens)` : "") +
          `, ${startIso} to ${endIso}, ${days} day${days > 1 ? "s" : ""}. ` +
          `The complete basket rental subtotal after current pricing and any valid promo is £${basketRentalTotal.toFixed(2)}${sameDayFee > 0 ? `, including a £${sameDayFee.toFixed(2)} same-day booking fee` : ""} before optional account credit, security, delivery, or a separate membership fee. ` +
          `Basket is now ${cart.count + 1} item${cart.count ? "s" : ""}. ` +
          // Say the dates back. A misheard date is the single most expensive
          // thing to get wrong here and the least likely to be noticed.
          `${inheritedDates ? "I used the same dates already in the basket. " : ""}Read the dates back to them to confirm. Exact pickup and return times are selected at checkout. ` +
          (stock.unknown ? "Date availability could not be confirmed just now; checkout will recheck stock before payment. " : "Availability was checked for those dates; checkout will recheck stock for the selected times. ")
        );
      },

      /** Same-category substitutes that are genuinely free for those dates. */
      suggest_alternatives: async ({ item, start, end }: { item: string; start?: string; end?: string }) => {
        const basketItem=cart.items.find(i=>i.title.toLowerCase()===String(item).trim().toLowerCase());
        if(basketItem){const rows=await convex.query(api.cartReplacements.forCart,{items:cart.items.map(i=>({key:i.key,listingId:i.listingId as any,start:dayMs(i.start),end:dayMs(i.end),pickupTime:i.pickupTime,returnTime:i.returnTime})),limit:10});if(rows.status!=="ready")return "Rental Manager stock is refreshing, so I cannot confirm whether this item is available. Keep the original item and return time unchanged for now.";const alts=rows.results[basketItem.key];return alts?`${basketItem.title} is unavailable for ${basketItem.start} to ${basketItem.end}. Available alternatives: ${alts.map(c=>`${c.title} (£${c.total})`).join("; ")||"none"}. Use Show more replacements on the cart or ask which they prefer before switching.`:"This basket item is currently available. Ask before changing it.";}
        const hit = await findOne(item);
        if (!hit) return `Couldn't find ${item} to match against.`;
        const { startIso, endIso } = resolveWindow(start, end);
        if (!startIso || !endIso) return `What hire dates should I check for ${hit.title}? I haven't checked availability yet.`;
        const alternatives = await alternativesFor(hit, startIso, endIso);
        if (!alternatives.items.length) return alternatives.unknown
          ? `I couldn't confirm whether other ${hit.category} items are free ${startIso} to ${endIso}. Please try checking again.`
          : `Nothing else in ${hit.category} is free ${startIso} to ${endIso}.`;
        return `Instead of ${hit.title}: ${alternatives.items.map((a) => `${a.title} at £${a.daily} a day`).join("; ")}.${alternatives.unknown ? " I couldn't confirm other alternatives just now." : ""}`;
      },

      remove_from_basket: async ({ item }: { item: string }) => {
        const needle = String(item ?? "").toLowerCase();
        const line = cart.items.find(
          (i) => i.title.toLowerCase().includes(needle) || i.slug.includes(needle),
        );
        if (!line) {
          const proposed = catalogOnlyLines.current.find(i => i.title.toLowerCase().includes(needle) || i.slug.includes(needle));
          if (!proposed) return `Nothing matching ${item} in the basket.`;
          const next = catalogOnlyLines.current.filter(i => i.listingId !== proposed.listingId);
          catalogOnlyLines.current = next;
          setCatalogOnlyLinesView(next);
          return `Removed ${proposed.title} from the proposed kit.`;
        }
        cart.remove(line.key);
        return `Removed ${line.title}. Basket is now ${cart.count - 1} items.`;
      },

      /**
       * File the enquiry. This is the one that makes taking someone's details
       * mean something.
       *
       * Without it Gaffer collected names, numbers and requirements on a call
       * and they evaporated when the socket closed — nothing in the inbox,
       * nothing in anyone's email. This lands it in the same contact inbox the
       * website form feeds, and alerts the owner by email and Telegram, using
       * the path the phone line already uses.
       *
       * Call it before the call ends, even if a follow-up email was also sent:
       * the customer's copy and the owner's copy are different jobs.
       */
      log_enquiry: async ({ kind, name, phone, email, message }: {
        kind?: string; name?: string; phone?: string; email?: string; message: string;
      }) => {
        const detail = String(message ?? "").trim();
        if (!detail) return "Tell me what to write down first.";

        const me: any = (account as any)?.me ?? null;
        const who = String(name ?? "").trim() || me?.name || "Voice caller";
        const addr = String(email ?? "").trim() || me?.email || undefined;
        // booking | inquiry | issue | callback — anything else is an inquiry
        const k = ["booking", "inquiry", "issue", "callback"].includes(String(kind))
          ? String(kind)
          : "inquiry";

        try {
          await convex.mutation(api.voice.lead, {
            kind: k,
            name: who,
            phone: phone ? String(phone) : undefined,
            email: addr,
            message: detail,
          });
          return (
            `Logged it as a ${k} for ${who}${addr ? ` (${addr})` : ""} — the team has it now ` +
            `and will pick it up.`
          );
        } catch {
          return "Couldn't file that just now — take their email and use send_follow_up instead.";
        }
      },

      /**
       * "I'll email that over" — puts the outcome of the call in writing.
       *
       * The reply-to is threaded, so when the customer answers that email it
       * comes back into this same conversation rather than as an orphan in the
       * owner's inbox. If they have an account it lands in their chat and Gaffer
       * answers it there.
       */
      send_follow_up: async ({ email, name, summary, subject }: { email?: string; name?: string; summary: string; subject?: string }) => {
        // A signed-in caller has already told us their address — don't make them
        // say it out loud again.
        const to = String(email ?? "").trim() || ((account as any)?.me?.email ?? "");
        if (!to) return "I need an email address before I can send that — what's the best one?";
        if (!summary?.trim()) return "Tell me what to put in it first.";
        try {
          return await convex.action(api.followUp.send, {
            email: to,
            name: name ?? (account as any)?.me?.name ?? undefined,
            summary: String(summary),
            subject: subject ? String(subject) : undefined,
          });
        } catch {
          return "Couldn't get that email away just now — I'll flag it for the team instead.";
        }
      },

      /**
       * "Want an account? Then I can just answer you in your chat."
       *
       * The pitch is the point: a registered customer gets a thread Gaffer
       * replies in directly, instead of waiting on email round-trips.
       */
      email_checkout_cart: async ({email}:{email?:string}) => {
        const to=(email??account.me?.email??"").trim().toLowerCase();
        if(!to)return "Ask for their email address and permission to email the discussed cart.";
        const snapshot=cartShareSnapshot(cart.items);
        if(!snapshot.items.length)return "The basket is empty. Add the selected catalogue items first.";
        try{const result=await emailCartLink(to,snapshot.signature,snapshot.lines,account.me?.email===to?account.token??undefined:undefined);
          if(currentCartShareSignature()!==snapshot.signature)return "The earlier kit was emailed, but its selection changed while sending. Review the current kit before sending another link.";
          if(result.alreadySent)return `That kit was already emailed to ${to}; I’ve avoided sending a duplicate. I can send an updated kit if you change the basket.`;
          const hasUndated = snapshot.items.some(line => !line.start || !line.end);
          return hasUndated
            ? `The private kit link was emailed to ${to}. It includes ${snapshot.items.length} selected item${snapshot.items.length === 1 ? "" : "s"} with real listing photos. The link asks for dates before checking price or availability; it does not reserve gear or take payment.`
            : `The discussed cart was emailed to ${to}. Its private link restores the items and selected dates; availability is rechecked and unavailable items show replacements. It does not reserve gear or take payment.`;
        }catch(e){return e instanceof Error?e.message:"The cart email could not be sent.";}
      },
      switch_unavailable: async ({item,replacement}:{item:string;replacement:string}) => {
        const source=cart.items.find(i=>i.title.toLowerCase()===String(item).trim().toLowerCase());
        if(!source)return "Name the exact unavailable basket item before switching it.";
        const rows=await convex.query(api.cartReplacements.forCart,{items:cart.items.map(i=>({key:i.key,listingId:i.listingId as any,start:dayMs(i.start),end:dayMs(i.end),pickupTime:i.pickupTime,returnTime:i.returnTime})),limit:100});
        if(rows.status!=="ready")throw new Error("Rental Manager stock is refreshing. Try the replacement again once availability has refreshed.");
        const choice=rows.results[source.key]?.find(i=>i.title.toLowerCase()===String(replacement).trim().toLowerCase());
        if(!choice)return "That replacement is not currently available for this basket. Use check_basket for the current alternatives.";
        cart.switchItem(source.key,{...choice,start:source.start,end:source.end,pickupTime:source.pickupTime,returnTime:source.returnTime});return `Switched ${source.title} to ${choice.title}, keeping ${source.start} to ${source.end}. Recheck the basket before checkout.`;
      },
      setup_account: async ({email,name,phone}:{email:string;name:string;phone:string}) => {
        if(!email?.trim()||!name?.trim()||!phone?.trim())return "Ask for their name, phone number and email address, and confirm they want an account.";
        try{const to=email.trim().toLowerCase(),snapshot=cartShareSnapshot(cart.items),signature=snapshot.signature;
          if(snapshot.items.length)await emailCartLink(to,signature,snapshot.lines);
          if(currentCartShareSignature()!==signature)return "Your kit changed while preparing the account. Please review it and ask me to continue again.";
          const cartKey=snapshot.items.length&&emailedCart.current?.email===to?emailedCart.current.shareKey:undefined;
          const result=await convex.action(api.accountCodes.request,{email:to,name,phone,purpose:"setup",cartKey});
          router.push(`/account/setup?challenge=${result.challenge}`);
          if(currentCartShareSignature()!==signature)return "The email code entry page is open. The kit changed while the code was requested; review it after signing in. Never share the code or password.";
          return `The email code entry page is open. Ask them to enter the one-time code themselves, then choose a new password. Never ask them to say or send you the code or password.${cartKey ? " Their saved kit will reopen after setup." : ""} An existing profile is preserved.`;
        }catch(e){return e instanceof Error?e.message:"Account setup could not start.";}
      },
      reset_password: async ({email}:{email:string}) => {
        if(!email?.trim())return "Ask for the account email address.";
        try{const result=await convex.action(api.accountCodes.request,{email,purpose:"reset"});router.push(`/account/setup?purpose=reset&challenge=${result.challenge}`);return "Forgot password is open. If an eligible account uses this address, a code was emailed. Ask them to enter the code themselves and choose a new password. Never ask them to share either.";}catch(e){return e instanceof Error?e.message:"Password reset could not start.";}
      },
      offer_account: async () => {
        if ((account as any)?.me) {
          instant();
          router.push("/account");
          return "They're already signed in — their chat is open on screen.";
        }
        instant();
        router.push("/account/setup");
        return (
          "Sign-up is on screen. Tell them it takes a moment and means I can answer them directly " +
          "in their own chat instead of going back and forth by email."
        );
      },

      /** "I'll pick this up in your chat" — only useful once they're signed in. */
      open_chat: async () => {
        if (!(account as any)?.me)
          return "They're not signed in, so there's no chat yet — offer them an account, or take an email address.";
        instant();
        router.push("/account#chat");
        return "Their chat is on screen — anything they send there comes to me.";
      },

      /** Quick peek — the drawer, without leaving the page. */
      show_basket: async () => {
        cart.open();
        if (!cart.count) return catalogOnlyLines.current.length
          ? `The dated basket is empty. Proposed kit: ${catalogOnlyLines.current.map(item => item.title).join(", ")}. Dates, prices and availability are not set; email_checkout_cart can send a private link to complete those details.`
          : "Basket is empty.";
        return `Basket: ${cart.items.map((i) => i.title).join(", ")}. Rental total ${await rentalSummary()}.`;
      },

      /**
       * First confirmation step: the full basket breakdown page, where dates,
       * line prices and the deposit are all visible. Checkout is the *second*
       * confirmation — don't jump straight there.
       */
      review_basket: async () => {
        if (!cart.count) return catalogOnlyLines.current.length
          ? "These items are only a proposed kit, not a dated basket. I haven't checked price or availability; use email_checkout_cart to send a private link where dates can be added."
          : "Basket is empty — nothing to review yet.";
        instant();
        cart.close();
        router.push("/cart");
        const [bad, compat] = await Promise.all([basketProblems(), compatWarnings()]);
        const summary =
          `Basket breakdown is on screen: ${cart.items.length} line${cart.items.length > 1 ? "s" : ""}, ` +
          `${await rentalSummary()}. ${securitySummary()}` +
          speakCompat(compat);
        if (!bad) return summary + " Availability could not be confirmed just now. Please try again before checkout.";
        return bad.length
          ? `${summary} ${await replacementBrief()}`
          : `${summary} Availability looks clear for the selected dates. Exact pickup and return times are selected at checkout, where stock is checked again. Happy to go through to checkout?`;
      },

      /** "Is everything in there actually available?" — unit-aware, shared stock included. */
      check_basket: async () => {
        if (!cart.count) return catalogOnlyLines.current.length
          ? "The proposed kit has no dates, so I can't check availability or quote a total yet. Use email_checkout_cart to send a private link for date selection."
          : "Basket is empty.";
        const bad = await basketProblems();
        if (!bad) return "Availability could not be confirmed just now. Please try again; nothing has been marked unavailable.";
        if (!bad.length) return `All ${cart.items.length} line${cart.items.length > 1 ? "s look" : " looks"} available for the selected dates. Exact times are selected at checkout and stock is rechecked before payment.`;
        return (
          `${bad.map((b) => `${b.title} (${b.start} to ${b.end})`).join(" and ")} ` +
          `${bad.length > 1 ? "aren't" : "isn't"} available for those dates. ` +
          await replacementBrief()
        );
      },

      /**
       * "Anything else that goes with this?" — the same contextual add-on
       * engine the cart page itself uses (convex/offers.ts), so the discount
       * and the reason are never invented: an ND filter only comes up because
       * there's a lens or camera in the basket and no filter yet, a tripod
       * only because there's something to lock off and no tripod yet, and the
       * percentage off is the one figure checkout will actually honour.
       */
      suggest_addons: async () => {
        if (!cart.count) return "Basket is empty — nothing to suggest add-ons for yet.";
        let offers: any[] = [];
        try {
          offers = await convex.query(api.offers.forCart, {
            items: cart.items.map((i) => ({ listingId: i.listingId as any, start: dayMs(i.start), end: dayMs(i.end), total: i.total })),
          });
        } catch {
          return "Couldn't pull up add-on offers just now.";
        }
        if (!offers.length) return "Nothing extra suggested for what's in the basket right now.";
        const lines = offers
          .map((o: any) => `${o.title} at ${o.pct}% off — £${o.total} for ${o.days} day${o.days > 1 ? "s" : ""} (${o.reason})`)
          .join("; ");
        return `On screen: ${lines}. Offer these naturally, don't read out all of them like a list — add whichever they want.`;
      },

      /**
       * Add one of the offers suggest_addons just named. Re-checks the offer
       * rather than trusting what was said a turn or two ago — the basket may
       * have changed since — and carries offerType through so checkout
       * applies the real discount rather than the full price.
       */
      add_addon: async ({ type }: { type: string }) => {
        if (!cart.count) return "Basket is empty — nothing to add an offer to yet.";
        let offers: any[] = [];
        try {
          offers = await convex.query(api.offers.forCart, {
            items: cart.items.map((i) => ({ listingId: i.listingId as any, start: dayMs(i.start), end: dayMs(i.end), total: i.total })),
          });
        } catch {
          return "Couldn't check that offer just now.";
        }
        const want = String(type ?? "").toLowerCase().replace(/[^a-z-]/g, "");
        const hit = offers.find((o: any) => o.offerType.startsWith(want)) ?? offers.find((o: any) => o.title.toLowerCase().includes(want));
        if (!hit) return `That offer isn't available for what's in the basket right now.`;
        if (cart.has(hit.listingId)) return `${hit.title} is already in the basket.`;

        const iso = (m: number) => new Date(m).toISOString().slice(0, 10);
        focus(hit.listingId);
        await new Promise((r) => setTimeout(r, 1000));
        cart.add({
          listingId: hit.listingId,
          slug: hit.slug,
          title: hit.title,
          heroImage: hit.heroImage ?? null,
          start: iso(hit.start),
          end: iso(hit.end),
          days: hit.days,
          perDay: hit.perDay,
          total: hit.total,
          deposit: hit.deposit ?? 0,
          offerType: hit.offerType,
        });
        await new Promise((r) => setTimeout(r, 450));
        cart.open();
        return `Added ${hit.title} at ${hit.pct}% off — £${hit.total} for ${hit.days} day${hit.days > 1 ? "s" : ""}. Basket is now ${cart.count + 1} items.`;
      },

      /** "Just take the ones that aren't available off." */
      remove_unavailable: async () => {
        const bad = await basketProblems();
        if (!bad) return "Availability could not be confirmed, so nothing was removed. Check the selected dates again; exact times are selected at checkout.";
        if (!bad.length) return "Nothing in the basket needs removing — it looks available for the selected dates.";
        for (const line of bad) cart.remove(line.key);
        const left = cart.items.length - bad.length;
        return (
          `Took ${bad.map((b) => b.title).join(" and ")} off. ` +
          (left > 0 ? `${left} line${left > 1 ? "s" : ""} left. Exact times are selected at checkout and stock is rechecked then.` : "That empties the basket.")
        );
      },

      go_to_checkout: async () => {
        if (!cart.count) return catalogOnlyLines.current.length
          ? "These items are a proposed kit, not in the dated basket. I haven't checked price or availability; send the private date-entry link with email_checkout_cart before checkout."
          : "Basket is empty — nothing to check out yet.";
        const signature = voiceCartReviewSignature(cart, reviewContext);
        const bad = await basketProblems();
        if (voiceCartReviewSignature(currentCart.current, currentReviewContext.current) !== signature) return "Your basket changed while I checked it. Please review it and ask me to check again.";
        if (bad?.length)
          return (
            `Can't check out yet — ${bad.map((b) => b.title).join(" and ")} ` +
            `${bad.length > 1 ? "aren't" : "isn't"} available for those dates. ` +
            await replacementBrief()
          );

        /**
         * First ask shows the breakdown; only a second one goes to checkout.
         * Time-specific stock is checked there after the renter chooses times.
         *
         * Enforced here rather than in the agent's instructions because the
         * agent has no review_basket tool registered — it only knows
         * go_to_checkout, so asking it to "review first" could never work. This
         * makes the checkout button itself the two-step: nobody reaches payment
         * without having seen dates, line prices and the deposit, and without
         * availability having been checked at that moment.
         */
        if (reviewed.current !== signature) {
          instant();
          cart.close();
          router.push("/cart");
          const compat = await compatWarnings();
          const lines = cart.items
            .map((i) => `${i.title}, ${i.start} to ${i.end}, £${i.total}`)
            .join("; ");
          const summary = await rentalSummary();
          if (voiceCartReviewSignature(currentCart.current, currentReviewContext.current) !== signature) { reviewed.current = null; return "Your basket changed while I prepared the breakdown. Please review it and ask me to check again."; }
          reviewed.current = signature;
          return (
            `Full breakdown is on screen.${bad?.length === 0 ? " Availability looks clear for the selected dates." : " I couldn't confirm date availability just now."}${speakCompat(compat)} ${lines}. ` +
            `That's ${summary}. ${securitySummary()} Exact pickup and return times are selected at checkout; stock is rechecked for those times before payment. ` +
            `Read it back to them, then ask if they're happy to go through to payment — ` +
            `call go_to_checkout again only once they say yes.`
          );
        }

        const summary = await rentalSummary();
        if (voiceCartReviewSignature(currentCart.current, currentReviewContext.current) !== signature) { reviewed.current = null; return "Your basket changed while I prepared checkout. Please review it and ask me to check again."; }
        instant();
        cart.close();
        router.push("/checkout");
        return `Taking them to checkout, ${summary}. ${securitySummary()} Choose exact pickup and return times there; stock and the final price are rechecked before payment.`;
      },
    }),
    [router, cart, account, convex, findOne, findMany, focus, availabilityFor, resolveWindow, alternativesFor, basketProblems, lensMismatch, suggest, rentalSummary, replacementBrief, securitySummary, catalogOnlyLinesView],
  );

  /**
   * Context handed to the agent at session start.
   *
   * This is how Gaffer greets a signed-in customer by name and knows what's
   * already in their basket, instead of asking for details the site already
   * holds. Phone callers get the same agent with these left empty.
   */
  const dynamicVariables = useMemo(() => {
    const me: any = (account as any)?.me ?? null;
    return {
      today: londonToday(),
      signed_in: me ? "yes" : "no",
      customer_name: me?.name ?? "",
      customer_email: me?.email ?? "",
      membership_tier: me?.membershipActive ? (me?.membershipTier ?? "") : "",
      basket_count: String(cart.count),
      basket_items: cart.items.map((i) => `${i.title} (${i.days}d, £${i.total})`).join("; "),
      proposed_kit_items: catalogOnlyLinesView.map(item => item.title).join("; "),
      basket_availability: cartAlternatives===undefined&&cart.count ? "checking" : cartAlternatives?.status==="refresh_required" ? "Rental Manager stock is refreshing; availability is unknown. Do not claim any basket item is available or unavailable yet." : cart.items.map(i=>!i.pickupTime||!i.returnTime?`${i.title}: exact times chosen at checkout; final availability check pending`:cartAlternatives?.status==="ready"&&Object.prototype.hasOwnProperty.call(cartAlternatives.results,i.key)?`${i.title}: availability unconfirmed; possible alternatives: ${cartAlternatives.results[i.key].map(c=>`${c.title} £${c.total}`).join(", ")||"none"}`:`${i.title}: availability unconfirmed; use check_basket`).join("; "),
      basket_subtotal: String(cart.subtotal),
      current_page: typeof window !== "undefined" ? window.location.pathname : "",
    };
  }, [account, cart, cartAlternatives, catalogOnlyLinesView]);

  return { clientTools, dynamicVariables, noteCustomerMessage, resetPriceRequest, noteAgentAlignment, noteAgentMessage, resetSpokenFocus };
}
