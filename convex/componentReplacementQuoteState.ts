import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { replacementCatalogItems, replacementStockSelection, replacementCustomerOffer } from "./lib/componentReplacementQuoteFields";
import { resolveReplacementStock } from "./componentReplacementPreview";
import { repriceRentalLines } from "./lib/catalogPricing";
import { replacementCatalogFingerprint, replacementStockFingerprint } from "../shared/componentReplacementStockFingerprint";
import { availableCreditRows } from "./lib/checkoutCredit";
import { checkoutBenefitAccount } from "./lib/rentalBenefitAccount";
import { londonMonth, studioDeliveryAvailable } from "./lib/memberDelivery";
import { replacementMembershipFingerprint } from "../shared/componentReplacementMembership";
import { deliveryPricingSettings } from "./lib/deliverySettings";
import { ASSESSMENT_SECURITY_POLICY_VERSION, cardLimitForPolicy } from "../shared/rentalSecurity";
import { agreementRequestFingerprint, assertCurrentAgreement, DELIVERY_TERMS_VERSION } from "../shared/rentalAgreement";
import { agreementsForSecurityPolicy } from "../src/lib/legal";
import { physicalAllocationValuePence } from "./lib/rentalExposure";
import { issueTransactionComponentAllocation } from "./lib/bookingComponentAllocation";

const QUOTE_LIFETIME_MS = 15 * 60 * 1000;

async function currentStock(ctx: any, stockInput: any) {
  const resolved = await resolveReplacementStock(ctx, stockInput);
  if (!resolved.kitStockAvailable || !resolved.providedBasketStockAvailable) throw Error("The replacement or basket stock changed. Review it again.");
  return resolved;
}

async function currentCatalog(ctx: any, items: any[]) {
  const prices = await repriceRentalLines(ctx, items);
  if (prices.some(price => !price)) throw Error("The basket pricing changed. Review it again.");
  return prices;
}

async function assertCurrentEquipment(ctx: any, record: any) {
  const index = record.replacementIndex, items = record.catalogItems, selection = record.stockInput;
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length || selection.quantity !== 1 || selection.otherItems.some((item: any) => item.qty !== 1))
    throw Error("The replacement basket is invalid.");
  const project = (item: any) => ({ listingId: item.listingId, start: item.start, end: item.end, pickupTime: item.pickupTime ?? null, returnTime: item.returnTime ?? null });
  if (agreementRequestFingerprint(project(items[index])) !== agreementRequestFingerprint(project(selection)) ||
      agreementRequestFingerprint(items.filter((_: any, itemIndex: number) => itemIndex !== index).map(project)) !== agreementRequestFingerprint(selection.otherItems.map(project)))
    throw Error("The replacement basket is invalid.");
  const resolved = await currentStock(ctx, selection);
  if (replacementStockFingerprint(selection, resolved) !== record.stockFingerprint) throw Error("The replacement or basket changed. Review it again.");
  if (!resolved.componentNames || record.offer?.originalComponentName !== resolved.componentNames.original || record.offer?.replacementComponentName !== resolved.componentNames.replacement) throw Error("The replacement names changed. Review it again.");
  const prices = await currentCatalog(ctx, items);
  if (replacementCatalogFingerprint(items, prices) !== record.catalogFingerprint) throw Error("The basket pricing changed. Review it again.");
  if (prices.some((price: any, itemIndex: number) => itemIndex !== index && (!Number.isFinite(price.deposit) || price.deposit < 0 || !Number.isSafeInteger(Math.round(price.deposit * 100)))))
    throw Error("The equipment security value is invalid.");
  const valuePence = prices.reduce((sum: number, price: any, itemIndex: number) => sum + (itemIndex === index ? resolved.allocation.replacementValuePence : Math.round(price.deposit * 100)), 0);
  if (!Number.isSafeInteger(valuePence) || valuePence < 0 || valuePence !== record.replacementValuePence ||
      Math.round(cardLimitForPolicy(record.securityPolicyVersion, valuePence / 100) * 100) !== record.savedCardLimitPence)
    throw Error("The equipment security value changed. Review the quote again.");
  return resolved;
}

async function assertCurrentCredit(ctx: any, quote: { ownerKey: string; creditAccountId?: any; creditRefundPence: number; creditEarnedPence: number }) {
  if (!Number.isSafeInteger(quote.creditRefundPence) || quote.creditRefundPence < 0 || !Number.isSafeInteger(quote.creditEarnedPence) || quote.creditEarnedPence < 0)
    throw Error("The account credit quote is invalid.");
  if (!quote.creditAccountId) {
    if (!quote.ownerKey.startsWith("guest:") || quote.creditRefundPence || quote.creditEarnedPence) throw Error("The account credit quote is invalid.");
    return;
  }
  if (quote.ownerKey !== `account:${quote.creditAccountId}`) throw Error("The account credit quote is invalid.");
  const account = await ctx.db.get(quote.creditAccountId);
  if (!account || account.blockedAt != null) throw Error("The rental account is unavailable.");
  const rows = await availableCreditRows(ctx, quote.creditAccountId);
  const refund = rows.filter((row: any) => row.kind === "refund").reduce((sum: number, row: any) => sum + row.availablePence, 0);
  const earned = rows.filter((row: any) => row.kind === "earned").reduce((sum: number, row: any) => sum + row.availablePence, 0);
  if (refund !== quote.creditRefundPence || earned !== quote.creditEarnedPence) throw Error("The account credit changed. Review the quote again.");
}

async function assertCurrentMembership(ctx: any, quote: { creditAccountId?: any; offer?: {customerEmail:string}; membershipFingerprint: string; studioMonth?: string; studioAvailable?: boolean }) {
  const account = quote.creditAccountId ? await checkoutBenefitAccount(ctx, await ctx.db.get(quote.creditAccountId)) : null;
  if (account && (!quote.offer || account.email.trim().toLowerCase() !== quote.offer.customerEmail.trim().toLowerCase())) throw Error("The rental account does not match the replacement offer.");
  if (replacementMembershipFingerprint(account) !== quote.membershipFingerprint) throw Error("Membership benefits changed. Review the quote again.");
  if ((quote.studioMonth === undefined) !== (quote.studioAvailable === undefined)) throw Error("The delivery benefit quote is invalid.");
  if (quote.studioMonth !== undefined && (!account || quote.studioMonth !== londonMonth() ||
      await studioDeliveryAvailable(ctx, account, quote.studioMonth) !== quote.studioAvailable))
    throw Error("Delivery benefits changed. Review the quote again.");
}

async function assertCurrentDeliverySettings(ctx: any, quote: { deliverySettings?: { marginPct: number; maxKm: number } }) {
  if (!quote.deliverySettings) return;
  const current = deliveryPricingSettings(await ctx.db.query("settings").first());
  if (current.marginPct !== quote.deliverySettings.marginPct || current.maxKm !== quote.deliverySettings.maxKm)
    throw Error("Delivery pricing changed. Review the quote again.");
}

export async function assertReplacementQuoteAtBooking(ctx: any, proof: { quoteId: any; pricingDigest: string; guestOwnerDigest?: string }, accountId?: any) {
  if (!/^[a-f0-9]{64}$/.test(proof.pricingDigest) || (accountId && proof.guestOwnerDigest !== undefined) ||
      (!accountId && (typeof proof.guestOwnerDigest !== "string" || !/^[a-f0-9]{64}$/.test(proof.guestOwnerDigest))))
    throw Error("Invalid replacement quote ownership.");
  const quote = await ctx.db.get(proof.quoteId);
  const ownerKey = accountId ? `account:${accountId}` : `guest:${proof.guestOwnerDigest}`;
  if (!quote || quote.ownerKey !== ownerKey) throw Error("Replacement quote is not available for this checkout.");
  if (quote.expiresAt <= Date.now()) throw Error("The replacement quote expired. Request a new quote.");
  if (quote.pricingDigest !== proof.pricingDigest) throw Error("The replacement quote changed. Request a new quote.");
  const resolved = await assertCurrentEquipment(ctx, quote);
  await assertCurrentCredit(ctx, quote);
  await assertCurrentMembership(ctx, quote);
  await assertCurrentDeliverySettings(ctx, quote);
  return { ...quote, resolved };
}

export async function authorizeAcceptedReplacementForBooking(ctx: any, proof: { quoteId: any; pricingDigest: string; guestOwnerDigest?: string }, booking: any) {
  const quote = await assertReplacementQuoteAtBooking(ctx, proof, booking.accountId);
  const offer = quote.offer, physical = quote.resolved.allocation;
  if (!offer || !quote.acceptedAt || quote.acceptedOfferFingerprint !== agreementRequestFingerprint(offer) || !quote.acceptedAllocation) throw Error("Review and accept the replacement offer before booking.");
  if (!offer.customerName?.trim() || !offer.billingAddress?.trim() || !offer.pickupTime || !offer.returnTime) throw Error("Complete the booking details and review the replacement offer.");
  const fresh = { version: "component-allocation-v1", id: String(proof.quoteId), replacementValuePence: physical.replacementValuePence,
    ...(physical.extensionAdjustmentPence ? { extensionAdjustmentPence: physical.extensionAdjustmentPence } : {}),
    components: quote.resolved.physicalDemands.map((demand: any) => ({ inventoryUnitId: demand.inventoryUnitId, qty: demand.qty })) };
  if (agreementRequestFingerprint(fresh) !== agreementRequestFingerprint(quote.acceptedAllocation) || await physicalAllocationValuePence(ctx, quote.acceptedAllocation, 1) !== physical.replacementValuePence) throw Error("The replacement allocation changed. Review it again.");
  const money = (value: any) => typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : NaN;
  const items = (booking.lineItems ?? []).map((line: any) => ({ listingId: line.listingId, title: line.title, start: line.start, end: line.end, ...(line.pickupTime ? {pickupTime:line.pickupTime} : {}), ...(line.returnTime ? {returnTime:line.returnTime} : {}), quantity: line.qty, totalPence: money(line.lineTotal) }));
  const documents = (booking.agreementDocs ?? []).map(({kind,version}: any) => ({kind,version}));
  if (agreementRequestFingerprint(items) !== agreementRequestFingerprint(offer.items) ||
      agreementRequestFingerprint(documents) !== agreementRequestFingerprint(offer.documents.map(({kind,version}: any) => ({kind,version}))) ||
      booking.customerEmail?.trim().toLowerCase() !== offer.customerEmail || (booking.customerName ?? undefined) !== offer.customerName || (booking.billingAddress ?? undefined) !== offer.billingAddress ||
      booking.fulfilment !== offer.fulfilment || (booking.fulfilment === "delivery" && ((booking.deliveryLegs ?? "round_trip") !== offer.deliveryLegs || (booking.address ?? undefined) !== offer.deliveryAddress)) ||
      (booking.pickupTime ?? undefined) !== offer.pickupTime || (booking.returnTime ?? undefined) !== offer.returnTime ||
      booking.securityPolicyVersion !== offer.securityPolicyVersion || (booking.securityWaiverReason ?? undefined) !== offer.securityWaiverReason || booking.protection !== offer.protection || !!booking.cancellationProtectionEnabled !== offer.cancellationProtectionEnabled ||
      money(booking.subtotal) !== offer.subtotalPence || money(booking.discount ?? 0) !== offer.discountPence || money(booking.deliveryFee) !== offer.deliveryPence || money(booking.sameDayFee ?? 0) !== offer.sameDayFeePence ||
      money((booking.refundCreditApplied ?? 0) + (booking.earnedCreditApplied ?? 0) + (booking.membershipCreditApplied ?? 0)) !== offer.creditPence ||
      booking.expectedCheckoutAmountPence !== offer.totalDuePence || money(booking.savedCardLimit ?? 0) !== offer.savedCardLimitPence || money(booking.depositAmount) !== offer.securityPaymentPence || money(booking.depositHoldAmount ?? 0) !== offer.securityHoldPence)
    throw Error("The booking differs from the accepted replacement offer. Review it again.");
  assertCurrentAgreement({name:booking.agreementName,securityHoldConsent:booking.securityHoldConsent,laterChargeConsent:booking.laterChargeConsent,deliveryAccepted:booking.deliveryAccepted,deliveryLegs:booking.deliveryLegs,documents:booking.agreementDocs,securityPolicyVersion:booking.securityPolicyVersion,cancellationProtectionEnabled:booking.cancellationProtectionEnabled},booking.fulfilment);
  return issueTransactionComponentAllocation(ctx, quote.replacementIndex, booking.lineItems[quote.replacementIndex], quote.acceptedAllocation);
}

export const issue = internalMutation({
  args: { ownerKey: v.string(), requestId: v.string(), offer: replacementCustomerOffer, pricingDigest: v.string(), stockInput: replacementStockSelection, stockFingerprint: v.string(), catalogItems: replacementCatalogItems, catalogFingerprint: v.string(), replacementIndex: v.number(), securityPolicyVersion: v.string(), replacementValuePence: v.number(), savedCardLimitPence: v.number(), creditAccountId: v.optional(v.id("accounts")), creditRefundPence: v.number(), creditEarnedPence: v.number(), membershipFingerprint: v.string(), studioMonth: v.optional(v.string()), studioAvailable: v.optional(v.boolean()), deliverySettings: v.optional(v.object({ marginPct: v.number(), maxKm: v.number() })) },
  handler: async (ctx, args) => {
    if (!/^(account:[a-zA-Z0-9_-]+|guest:[a-f0-9]{64})$/.test(args.ownerKey) ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId) || !/^[a-f0-9]{64}$/.test(args.pricingDigest))
      throw Error("Invalid replacement quote request.");
    if (args.offer.replacementIndex !== args.replacementIndex || args.offer.savedCardLimitPence !== args.savedCardLimitPence || args.offer.securityPolicyVersion !== args.securityPolicyVersion ||
        args.offer.originalComponentId !== args.stockInput.originalMasterItemId || args.offer.replacementComponentId !== args.stockInput.replacementMasterItemId ||
        [args.offer.subtotalPence, args.offer.discountPence, args.offer.deliveryPence, args.offer.sameDayFeePence, args.offer.membershipFeePence, args.offer.creditPence, args.offer.totalDuePence, args.offer.savedCardLimitPence, args.offer.securityPaymentPence, args.offer.securityHoldPence].some(amount => !Number.isSafeInteger(amount) || amount < 0))
      throw Error("Invalid customer replacement offer.");
    await assertCurrentEquipment(ctx, args);
    await assertCurrentCredit(ctx, args);
    await assertCurrentMembership(ctx, args);
    await assertCurrentDeliverySettings(ctx, args);
    const previous = await ctx.db.query("component_replacement_quotes")
      .withIndex("by_owner_request", q => q.eq("ownerKey", args.ownerKey).eq("requestId", args.requestId)).unique();
    const now = Date.now();
    if (previous) {
      if (previous.pricingDigest !== args.pricingDigest || agreementRequestFingerprint(previous.offer) !== agreementRequestFingerprint(args.offer) || previous.stockFingerprint !== args.stockFingerprint || previous.catalogFingerprint !== args.catalogFingerprint || previous.creditRefundPence !== args.creditRefundPence || previous.creditEarnedPence !== args.creditEarnedPence || previous.membershipFingerprint !== args.membershipFingerprint || previous.studioMonth !== args.studioMonth || previous.studioAvailable !== args.studioAvailable || previous.deliverySettings?.marginPct !== args.deliverySettings?.marginPct || previous.deliverySettings?.maxKm !== args.deliverySettings?.maxKm) throw Error("The replacement quote changed. Request a new quote.");
      if (previous.expiresAt <= now) throw Error("The replacement quote expired. Request a new quote.");
      return { quoteId: previous._id, expiresAt: previous.expiresAt, offer: previous.offer, reused: true };
    }
    const expiresAt = now + QUOTE_LIFETIME_MS;
    const quoteId = await ctx.db.insert("component_replacement_quotes", { ...args, createdAt: now, expiresAt });
    return { quoteId, expiresAt, offer: args.offer, reused: false };
  },
});

export const purgeExpired = internalMutation({
  args: {},
  handler: async ctx => {
    const expired = await ctx.db.query("component_replacement_quotes").withIndex("by_expiry", q => q.lte("expiresAt", Date.now() - 24 * 60 * 60 * 1000)).take(100);
    for (const quote of expired) await ctx.db.delete(quote._id);
    return { deleted: expired.length };
  },
});

export const acceptOffer = internalMutation({
  args: { quoteId: v.id("component_replacement_quotes"), ownerKey: v.string(), presentedOffer: replacementCustomerOffer, accepted: v.literal(true) },
  handler: async (ctx, { quoteId, ownerKey, presentedOffer }) => {
    const quote = await ctx.db.get(quoteId);
    if (!quote || quote.ownerKey !== ownerKey) throw Error("Replacement quote is not available for this checkout.");
    if (!quote.offer || agreementRequestFingerprint(quote.offer) !== agreementRequestFingerprint(presentedOffer)) throw Error("The replacement offer changed. Review it again.");
    const cancellationProtectionEnabled = process.env.CANCELLATION_PROTECTION_POLICY_ENABLED === "true" && quote.securityPolicyVersion === ASSESSMENT_SECURITY_POLICY_VERSION;
    if (quote.offer.cancellationProtectionEnabled !== cancellationProtectionEnabled) throw Error("The rental agreements changed. Review the new offer.");
    const documents: {kind:string;version:string;title:string}[] = agreementsForSecurityPolicy(quote.securityPolicyVersion, cancellationProtectionEnabled).map(({ kind, version, title }) => ({ kind, version, title }));
    if (quote.offer.fulfilment === "delivery") documents.push({ kind: "delivery-disclaimer", version: DELIVERY_TERMS_VERSION, title: "Delivery arrangements" });
    if (agreementRequestFingerprint(documents) !== agreementRequestFingerprint(quote.offer.documents)) throw Error("The rental agreements changed. Review the new offer.");
    const accountId = ownerKey.startsWith("account:") ? quote.creditAccountId : undefined;
    const guestOwnerDigest = ownerKey.startsWith("guest:") ? ownerKey.slice(6) : undefined;
    if (ownerKey.startsWith("account:") && (!accountId || ownerKey !== `account:${accountId}`)) throw Error("Invalid replacement quote ownership.");
    const checked = await assertReplacementQuoteAtBooking(ctx, { quoteId, pricingDigest: quote.pricingDigest, ...(guestOwnerDigest ? { guestOwnerDigest } : {}) }, accountId);
    const physical = checked.resolved.allocation;
    const components = checked.resolved.physicalDemands.map((demand: any) => ({ inventoryUnitId: demand.inventoryUnitId, qty: demand.qty }));
    if (physical.version !== "component-allocation-v1" || !Number.isSafeInteger(physical.replacementValuePence) || physical.replacementValuePence < 1 ||
        !components.length || components.length > 100 || new Set(components.map((component: any) => String(component.inventoryUnitId))).size !== components.length ||
        components.some((component: any) => !component.inventoryUnitId || !Number.isSafeInteger(component.qty) || component.qty < 1 || component.qty > 100))
      throw Error("The physical replacement allocation needs review.");
    const acceptedAllocation = { version: "component-allocation-v1" as const, id: String(quoteId), replacementValuePence: physical.replacementValuePence,
      ...(physical.extensionAdjustmentPence ? { extensionAdjustmentPence: physical.extensionAdjustmentPence } : {}), components };
    if (await physicalAllocationValuePence(ctx, acceptedAllocation, 1) !== physical.replacementValuePence) throw Error("The equipment security value changed. Review the quote again.");
    const fingerprint = agreementRequestFingerprint(quote.offer);
    if (quote.acceptedAt !== undefined) {
      if (quote.acceptedOfferFingerprint !== fingerprint || agreementRequestFingerprint(quote.acceptedAllocation) !== agreementRequestFingerprint(acceptedAllocation)) throw Error("The replacement offer changed. Review it again.");
      return { acceptedAt: quote.acceptedAt, reused: true };
    }
    const acceptedAt = Date.now();
    await ctx.db.patch(quoteId, { acceptedAt, acceptedOfferFingerprint: fingerprint, acceptedAllocation });
    return { acceptedAt, reused: false };
  },
});
