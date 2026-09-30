import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import { depositFor } from "./pricing";
import { tierByKey, FREE_ACCESSORY_TYPES } from "./membership";

export type RentalPriceInput = {
  items: {
    listingId: Id<"listings">;
    title: string;
    start: number;
    end: number;
    qty: number;
    total: number;
    deposit: number;
    offerType?: string;
  }[];
  token?: string;
  customer: { email: string };
  fulfilment: "pickup" | "delivery";
  address?: string;
  deliveryPostcode?: string;
  deliveryFee?: number;
  promoCode?: string;
  protection?: "verify" | "deposit";
};

type PricedItem = RentalPriceInput["items"][number] & { dailyRate: number };
export type RentalPrice = {
  items: PricedItem[];
  customerEmail: string;
  acct: any;
  month: string;
  freedCount: number;
  subtotal: number;
  replacementSum: number;
  protection: "verify" | "deposit";
  depositHoldAmount: number;
  depositAmount: number;
  appliedCode?: string;
  totalReduction: number;
  reductionLabel?: string;
  quotedDeliveryFee: number;
  deliveryFee: number;
  totalBeforeCredit: number;
  creditApplied: number;
  totalDue: number;
};

const postcodeFromAddress = (address: string) =>
  address.toUpperCase().match(/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/)?.[0].replace(/\s/g, "") ?? "";

/** One authoritative calculation for the on-page quote and Stripe checkout. */
export async function calculateRentalPrice(ctx: ActionCtx, a: RentalPriceInput): Promise<RentalPrice> {
  if (!a.items.length || a.items.some((item) => item.qty !== 1 || !Number.isSafeInteger(item.start) ||
      !Number.isSafeInteger(item.end) || item.end < item.start))
    throw new Error("Each rental line must be one item with valid dates. Please refresh your basket.");

  const repriced: any[] = await ctx.runQuery(internal.catalog.repriceLines, {
    items: a.items.map((i) => ({ listingId: i.listingId, start: i.start, end: i.end, offerType: i.offerType })),
  });
  const items: PricedItem[] = a.items.map((it, idx) => {
    const r = repriced[idx];
    if (!r) throw new Error(`"${it.title}" is no longer available.`);
    return { ...it, title: r.title, total: r.total, deposit: r.deposit, dailyRate: r.dailyRate };
  });
  const subtotal = items.reduce((n, i) => n + i.total, 0);
  const protection = a.protection ?? "verify";
  const replacementSum = items.reduce((n, i) => n + i.deposit, 0);
  const depositHoldAmount = depositFor(protection, replacementSum);
  const depositAmount = Math.round(depositHoldAmount * 50) / 100;

  const customerEmail = a.customer.email.trim().toLowerCase();
  const acct: any = a.token ? await ctx.runQuery(internal.accounts._byToken, { token: a.token }) : null;
  if (acct && customerEmail !== acct.email.trim().toLowerCase())
    throw new Error("Use your signed-in account email for this booking, or sign out to book as a guest.");
  const member = acct?.membershipActive ? tierByKey(acct.membershipTier) : null;
  const month = new Date().toISOString().slice(0, 7);
  const allowance = member?.freeAccessories ?? 0;
  const used = acct?.freeAccessoryMonth === month ? acct?.freeAccessoryUsed ?? 0 : 0;
  const creditsLeft = Math.max(0, allowance - used);
  const freed = new Set<number>();
  let freeAccessoryValue = 0;
  if (creditsLeft > 0) {
    const types: Record<string, string> = await ctx.runQuery(api.catalog.itemTypes, { ids: items.map((i) => i.listingId) });
    const eligible = items.map((it, i) => ({ i, it }))
      .filter((x) => !x.it.offerType && FREE_ACCESSORY_TYPES.includes(types[x.it.listingId] ?? ""))
      .sort((x, y) => y.it.total - x.it.total)
      .slice(0, creditsLeft);
    for (const e of eligible) {
      freed.add(e.i);
      freeAccessoryValue += e.it.total;
    }
  }
  const freedCount = freed.size;
  const discountable = items.filter((i, idx) => !i.offerType && !freed.has(idx))
    .reduce((n, i) => n + i.total, 0);
  let promoDiscount = 0;
  let appliedCode: string | undefined;
  if (a.promoCode) {
    const res: any = await ctx.runQuery(api.promo.validate, {
      code: a.promoCode,
      eligibleSubtotal: discountable,
      rentalSubtotal: subtotal,
      tier: acct?.membershipTier ?? undefined,
      membershipActive: !!acct?.membershipActive,
      email: customerEmail,
    });
    if (res?.valid) {
      promoDiscount = res.discount;
      appliedCode = res.code;
    }
  }
  const reminderDiscount = acct?.marketingEmails ? Math.round(discountable * 0.05) : 0;
  const memberDiscount = member ? Math.round(discountable * member.pct / 100) : 0;
  let discount = promoDiscount;
  let discountLabel = appliedCode?.toUpperCase();
  if (reminderDiscount > discount) {
    discount = reminderDiscount;
    discountLabel = "Reminder member −5%";
    appliedCode = undefined;
  }
  if (memberDiscount > discount) {
    discount = memberDiscount;
    discountLabel = `${member!.name} member −${member!.pct}%`;
    appliedCode = undefined;
  }
  const totalReduction = discount + freeAccessoryValue;
  const reductionLabel = freeAccessoryValue > 0
    ? discount > 0 ? "Member perks" : `${freedCount} free accessor${freedCount > 1 ? "ies" : "y"}`
    : discountLabel;

  let quotedDeliveryFee = 0;
  if (a.fulfilment === "delivery") {
    const postcode = postcodeFromAddress(a.deliveryPostcode ?? "");
    if (!postcode || postcode !== postcodeFromAddress(a.address ?? "") || (a.address ?? "").trim().length < 10)
      throw new Error("Enter the full delivery address with the same postcode used for the quote.");
    const quote: any = await ctx.runAction(api.delivery.quote, {
      postcode, listingIds: items.map((item) => item.listingId),
    });
    if (!quote.ok || !Number.isSafeInteger(quote.fee) || quote.fee < 0)
      throw new Error(quote.ok ? "Delivery is unavailable for this address." : quote.reason);
    quotedDeliveryFee = quote.fee;
    if (a.deliveryFee !== undefined && Math.round(a.deliveryFee * 100) !== Math.round(quotedDeliveryFee * 100))
      throw new Error("Your delivery quote has changed. Please refresh it before paying.");
  }
  const deliveryFee = member?.freeDelivery && a.fulfilment === "delivery" ? 0 : quotedDeliveryFee;
  const totalBeforeCredit = subtotal + deliveryFee + depositAmount - totalReduction;
  const availableCredit = acct
    ? await ctx.runQuery(internal.bookings.availableCheckoutCredit, { accountId: acct._id }) : 0;
  const creditApplied = Math.min(availableCredit, Math.max(0, totalBeforeCredit - depositAmount));

  return {
    items, customerEmail, acct, month, freedCount, subtotal, replacementSum, protection,
    depositHoldAmount, depositAmount, appliedCode, totalReduction, reductionLabel,
    quotedDeliveryFee, deliveryFee, totalBeforeCredit, creditApplied, totalDue: totalBeforeCredit - creditApplied,
  };
}
