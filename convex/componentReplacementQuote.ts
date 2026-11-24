"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { calculateRentalPrice, normalizeReplacementRentalTimes } from "./lib/rentalPrice";
import { replacementStockFingerprint } from "../shared/componentReplacementStockFingerprint";
import { agreementsForSecurityPolicy } from "../src/lib/legal";
import { DELIVERY_TERMS_VERSION } from "../shared/rentalAgreement";
import { replacementCustomerOffer } from "./lib/componentReplacementQuoteFields";
import { ASSESSMENT_SECURITY_POLICY_VERSION } from "../shared/rentalSecurity";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export const issue = internalAction({
  args: { input: v.any(), requestId: v.string(), guestCapability: v.optional(v.string()) },
  handler: async (ctx, { input, requestId, guestCapability }): Promise<any> => {
    if (!input || !Array.isArray(input.items) || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw Error("Invalid replacement quote request.");
    input = normalizeReplacementRentalTimes(input);
    const price = await calculateRentalPrice(ctx, input);
    if (!price.componentReplacementPricingEvidence || !price.componentReplacementCatalogFingerprint || !price.componentReplacementCreditBalances || !price.componentReplacementMembershipFingerprint || input.token && !price.acct) throw Error("The replacement quote is unavailable.");
    if (price.acct && guestCapability !== undefined) throw Error("Use one quote ownership method.");
    if (!price.acct && (typeof guestCapability !== "string" || !/^[a-f0-9]{64}$/.test(guestCapability))) throw Error("A secure guest checkout capability is required.");
    const ownerKey = price.acct ? `account:${price.acct._id}` : `guest:${digest(guestCapability!)}`;
    const indexes = input.items.flatMap((item: any, index: number) => item.componentReplacement ? [index] : []);
    if (indexes.length !== 1) throw Error("The replacement quote is unavailable.");
    const index = indexes[0], line = input.items[index], priced = price.items[index], allocation = priced?.resolvedComponentAllocation;
    if (!allocation || !priced.resolvedPhysicalDemands || !priced.resolvedComponentNames?.original || !priced.resolvedComponentNames?.replacement) throw Error("The replacement quote is unavailable.");
    const stockInput = { listingId: line.listingId, ...line.componentReplacement, start: line.start, end: line.end, quantity: line.qty,
      ...(line.pickupTime ? { pickupTime: line.pickupTime } : {}), ...(line.returnTime ? { returnTime: line.returnTime } : {}),
      otherItems: input.items.filter((_: any, otherIndex: number) => otherIndex !== index).map((item: any) => ({ listingId: item.listingId, start: item.start, end: item.end, qty: item.qty,
        ...(item.pickupTime ? { pickupTime: item.pickupTime } : {}), ...(item.returnTime ? { returnTime: item.returnTime } : {}) })) };
    const stockFingerprint = replacementStockFingerprint(stockInput, { basePricePence: Math.round(priced.total * 100) - allocation.priceAdjustmentPence, allocation, componentNames: priced.resolvedComponentNames, physicalDemands: priced.resolvedPhysicalDemands, deliverySpec: priced.resolvedDeliverySpec ?? null });
    const catalogItems = input.items.map((item: any) => ({ listingId: item.listingId, start: item.start, end: item.end, ...(item.pickupTime ? { pickupTime: item.pickupTime } : {}), ...(item.returnTime ? { returnTime: item.returnTime } : {}) }));
    const money = (amount: number) => { const result = Math.round(amount * 100); if (!Number.isSafeInteger(result) || result < 0) throw Error("The replacement quote amounts need review."); return result; };
    const cancellationProtectionEnabled = process.env.CANCELLATION_PROTECTION_POLICY_ENABLED === "true" && price.securityPolicyVersion === ASSESSMENT_SECURITY_POLICY_VERSION;
    const documents: {kind:string;version:string;title:string}[] = agreementsForSecurityPolicy(price.securityPolicyVersion, cancellationProtectionEnabled).map(({ kind, version, title }) => ({ kind, version, title }));
    if (input.fulfilment === "delivery") documents.push({ kind: "delivery-disclaimer", version: DELIVERY_TERMS_VERSION, title: "Delivery arrangements" });
    const offer = { version: 1 as const, currency: "GBP" as const, customerEmail: price.customerEmail, ...(input.customer.name ? {customerName:input.customer.name} : {}), ...(input.customer.billingAddress ? {billingAddress:input.customer.billingAddress} : {}), items: price.items.map(item => ({ listingId: item.listingId, title: item.title, start: item.start, end: item.end, ...(item.pickupTime ? {pickupTime:item.pickupTime} : {}), ...(item.returnTime ? {returnTime:item.returnTime} : {}), quantity: item.qty, totalPence: money(item.total) })),
      replacementIndex: index, originalComponentId: allocation.originalUnitId, replacementComponentId: allocation.replacementUnitId, originalComponentName: priced.resolvedComponentNames.original, replacementComponentName: priced.resolvedComponentNames.replacement,
      subtotalPence: money(price.subtotal), discountPence: money(price.totalReduction), deliveryPence: money(price.deliveryFee), sameDayFeePence: money(price.sameDayFee), membershipFeePence: money(price.membershipFee), creditPence: money(price.creditApplied), totalDuePence: money(price.combinedTotalDue), savedCardLimitPence: money(price.savedCardLimit), securityPaymentPence: money(price.depositAmount), securityHoldPence: money(price.depositHoldAmount), securityPolicyVersion: price.securityPolicyVersion, ...(price.securityWaiverReason ? {securityWaiverReason:price.securityWaiverReason} : {}), protection:price.protection, cancellationProtectionEnabled, fulfilment: input.fulfilment,
      ...(input.fulfilment === "delivery" ? { deliveryLegs:input.deliveryLegs ?? "round_trip", ...(input.address ? {deliveryAddress:input.address} : {}), ...(input.deliveryPostcode ? {deliveryPostcode:input.deliveryPostcode} : {}) } : {}), ...(input.pickupTime ? {pickupTime:input.pickupTime} : {}), ...(input.returnTime ? {returnTime:input.returnTime} : {}), documents };
    return ctx.runMutation((internal as any).componentReplacementQuoteState.issue, { ownerKey, requestId, offer, pricingDigest: digest(price.componentReplacementPricingEvidence.fingerprint), stockInput, stockFingerprint, catalogItems, catalogFingerprint: price.componentReplacementCatalogFingerprint,
      replacementIndex: index, securityPolicyVersion: price.securityPolicyVersion, replacementValuePence: Math.round(price.replacementSum * 100), savedCardLimitPence: Math.round(price.savedCardLimit * 100),
      ...(price.acct ? { creditAccountId: price.acct._id } : {}), creditRefundPence: price.componentReplacementCreditBalances.refundPence, creditEarnedPence: price.componentReplacementCreditBalances.earnedPence,
      membershipFingerprint: price.componentReplacementMembershipFingerprint, ...(price.componentReplacementStudioCheck ? { studioMonth: price.componentReplacementStudioCheck.month, studioAvailable: price.componentReplacementStudioCheck.available } : {}),
      ...(price.componentReplacementDeliverySettings ? { deliverySettings: price.componentReplacementDeliverySettings } : {}) });
  },
});

export const acceptOffer = internalAction({
  args: { quoteId: v.id("component_replacement_quotes"), token: v.optional(v.string()), guestCapability: v.optional(v.string()), presentedOffer: replacementCustomerOffer, accepted: v.literal(true) },
  handler: async (ctx, { quoteId, token, guestCapability, presentedOffer, accepted }): Promise<{acceptedAt:number;reused:boolean}> => {
    if (!!token === !!guestCapability) throw Error("Use one quote ownership method.");
    let ownerKey: string;
    if (token) {
      const account = await ctx.runQuery(internal.accounts._byToken, { token });
      if (!account || account.blockedAt != null) throw Error("The rental account is unavailable.");
      ownerKey = `account:${account._id}`;
    } else {
      if (!guestCapability || !/^[a-f0-9]{64}$/.test(guestCapability)) throw Error("A secure guest checkout capability is required.");
      ownerKey = `guest:${digest(guestCapability)}`;
    }
    return ctx.runMutation((internal as any).componentReplacementQuoteState.acceptOffer, { quoteId, ownerKey, presentedOffer, accepted });
  },
});
