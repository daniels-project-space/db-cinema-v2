import { availableCreditRows,creditPlan,creditKind } from "./lib/checkoutCredit";
import { referralEligibility,availableReferralReward } from "./lib/referrals";
import { SINGLE_BENEFIT_VERSION } from "../shared/rentalBenefits";
import { SECURITY_POLICY_VERSION, depositChargeFor } from "../shared/rentalSecurity";
import { unlockLoyalty, loyaltyProgress } from "./lib/loyalty";
import { creditDebit,usableCredit } from "./lib/creditLedger";
import { safeRepeatRental,repeatRentalFingerprint } from "./lib/repeatRental";
import { reviewContext } from "./lib/reviewContext";
import { studioDeliveryAvailable, londonMonth } from "./lib/memberDelivery";
import { paidDepositExempt, membershipActiveNow } from "../shared/membership";
import { checkoutMembershipCredit, membershipSignupOffer } from "../shared/checkoutMembershipCredit";
import { stopMatchingRecovery, linkMatchingRecovery } from "./lib/checkoutRecovery";
import { rentalBillingLines } from "./lib/rentalBillingLines";
import { assertRentalInventory } from "./lib/rentalInventory";
import { confirmedRentalRefundPence } from "./lib/rentalPaymentPlan";
import { rentalPaymentSources } from "./lib/rentalPaymentSources";
import { postRentalMessage } from "./lib/rentalChat";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { peak, type Iv } from "./availability";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { VERIFICATION_REUSE_DAYS, validReuse, verificationDetail, verificationUpdateMessage } from "./lib/verificationReuse";
import { assertCreditOffer } from "./lib/rentalCreditPolicy";
import { rentalCancellationStart, cancelKind,CANCELLATION_CREDIT_DAYS } from "../src/lib/cancellationPolicy";
import { LEGAL_VERSION } from "../src/lib/legal";
import { assertAgreementBeforeRelease, snapshotAgreement, readAgreementSnapshot, agreementRequestFingerprint as fingerprintAgreement } from "../shared/rentalAgreement";


/** Only an attested Stripe create rejection may release an unbound checkout.
 * Network/unknown responses remain pending for provider reconciliation. */
export const checkoutCreationRejected=internalMutation({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
 const b=await ctx.db.get(bookingId);if(!b||b.status!=="pending_payment"||b.stripeCheckoutSessionId||b.stripePaymentIntentId)return;
 await releaseReferral(ctx,b);
 await ctx.db.patch(b._id,{status:"cancelled",cancelledAt:Date.now()});
 const reservations=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",b._id)).collect();for(const r of reservations)if(r.status==="hold")await ctx.db.patch(r._id,{status:"cancelled",holdExpiresAt:undefined});
 if(b.membershipCheckoutId){const m=await ctx.db.get(b.membershipCheckoutId);if(m&&["creating","open"].includes(m.state))await ctx.db.patch(m._id,{state:"expired"});}
}});


const lineItem = v.object({
  listingId: v.id("listings"),
  title: v.string(),
  start: v.number(),
  end: v.number(),
  qty: v.number(),
  lineTotal: v.number(),
  dailyRate: v.optional(v.number()),
});

async function availableCreditFor(ctx: any, accountId: any): Promise<number> {
  const acct = await ctx.db.get(accountId);
  if (!acct) return 0;
  const now = Date.now();
  const credits = await ctx.db.query("credits")
    .withIndex("by_account", (q: any) => q.eq("accountId", accountId)).collect();
  const balance = credits.filter((c: any) => c.status === "active" && c.expiresAt > now)
    .reduce((n: number, c: any) => n + usableCredit(c), 0);
  const pending = await ctx.db.query("bookings")
    .withIndex("by_guestEmail", (q: any) => q.eq("guestEmail", acct.email.trim().toLowerCase())).collect();
  const reserved = pending.filter((b: any) => b.status === "pending_payment")
    .reduce((n: number, b: any) => n + (b.creditApplied ?? 0) - (b.membershipCreditApplied ?? 0), 0);
  const frozen = credits.filter((c:any)=>c.status === "active").reduce((n:number,c:any)=>n+(c.revokedPendingPence??0)/100,0);
  return Math.max(0, balance - Math.max(0,reserved-frozen));
}

export const availableCheckoutCredit = internalQuery({
  args: {accountId:v.id("accounts"),kind:v.optional(v.union(v.literal("refund"),v.literal("earned")))},
  handler:async(ctx,{accountId,kind})=>kind ? (await availableCreditRows(ctx,accountId)).filter((r:any)=>r.kind===kind).reduce((n:number,r:any)=>n+r.availablePence,0)/100 : availableCreditFor(ctx,accountId),
});

async function releaseReferral(ctx:any,b:any){
 if(b.referralRedemptionId){const r=await ctx.db.get(b.referralRedemptionId);if(r&&["reserved","paid"].includes(r.state))await ctx.db.patch(r._id,{state:"void"});}
 if(b.referralRewardId){const r=await ctx.db.get(b.referralRewardId);if(r?.state==="available"&&r.reservedBookingId===b._id)await ctx.db.patch(r._id,{reservedBookingId:undefined});}
}

export const createPending = internalMutation({
  args: {
    pricingVersion:v.optional(v.string()),benefitKind:v.optional(v.string()),
    refundCreditApplied:v.optional(v.number()),earnedCreditApplied:v.optional(v.number()),
    referralCode:v.optional(v.string()),referralRewardId:v.optional(v.id("referral_rewards")),
    customerEmail: v.string(),
    customerName: v.optional(v.string()),
    phone: v.optional(v.string()),
    fulfilment: v.union(v.literal("pickup"), v.literal("delivery")),
    address: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    deliveryFee: v.number(),
    lineItems: v.array(lineItem),
    subtotal: v.number(),
    depositAmount: v.number(),
    depositHoldAmount: v.optional(v.number()),
    securityPolicyVersion: v.optional(v.string()),
    promoCode: v.optional(v.string()),
    discount: v.optional(v.number()),
    total: v.number(),
    expectedTotalDue: v.number(),
    membershipCreditApplied: v.optional(v.number()),
    membershipSignupOfferSaving: v.optional(v.number()),
    weekendSaving: v.optional(v.number()),
    loyaltySaving: v.optional(v.number()),
    quotedDeliveryFee: v.optional(v.number()),
    creditAccountId: v.optional(v.id("accounts")),
    deliveryBenefitMonth: v.optional(v.string()),
    securityWaiverReason: v.optional(v.string()),
    membershipCheckoutId: v.optional(v.id("membership_checkouts")),
    accountAccessRequired: v.optional(v.boolean()),
    repeatSourceBookingId: v.optional(v.id("bookings")),
    repeatSourceFingerprint: v.optional(v.string()),
    currency: v.string(),
    agreementName: v.optional(v.string()),
    agreementRequestId: v.optional(v.string()),
    securityHoldConsent: v.optional(v.boolean()),
    laterChargeConsent: v.optional(v.boolean()),
    agreementDocs: v.optional(
      v.array(v.object({ kind: v.string(), version: v.string() })),
    ),
    protection: v.optional(v.string()),
    idVerifyStatus: v.optional(v.string()),
    verificationProvider: v.optional(v.string()),
    pickupTime: v.optional(v.string()),
    returnTime: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const newAgreement = a.agreementDocs?.some(d => d.version === LEGAL_VERSION);
    const agreementRequestFingerprint = a.agreementRequestId ? fingerprintAgreement(a) : undefined;
    if (newAgreement && !a.agreementRequestId) throw Error("An agreement acceptance attempt is required.");
    if (a.agreementRequestId) {
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(a.agreementRequestId)) throw Error("Invalid acceptance attempt.");
      const previous = await ctx.db.query("bookings").withIndex("by_agreement_request", q => q.eq("agreementRequestId", a.agreementRequestId)).unique();
      if (previous) {
        if (previous.agreementRequestFingerprint !== agreementRequestFingerprint) throw Error("This acceptance attempt already belongs to different booking particulars. Review and accept again.");
        if (previous.status !== "pending_payment") throw Error("This acceptance attempt has already completed or closed. Use the existing booking.");
        return {bookingId:previous._id,creditApplied:previous.creditApplied??0,reused:true,sessionId:previous.stripeCheckoutSessionId};
      }
    }
    if(a.securityPolicyVersion && a.securityPolicyVersion!==SECURITY_POLICY_VERSION)throw Error("Unsupported security policy.");
    const single=a.pricingVersion===SINGLE_BENEFIT_VERSION;
    if(a.pricingVersion&&!single)throw Error("Unsupported pricing version.");
    const account=a.creditAccountId?await ctx.db.get(a.creditAccountId):null;
    let friend:any=null,reward:any=null;
    if(single){
      if((a.earnedCreditApplied??0)>0&&a.benefitKind!=="earned_credit")throw Error("Earned credit cannot stack with another benefit.");
      if(a.benefitKind==="earned_credit"&&((a.discount??0)!==(a.membershipSignupOfferSaving??0)||a.deliveryFee!==(a.quotedDeliveryFee??a.deliveryFee)))throw Error("Only one price benefit can apply, plus the one-time joining credit.");
      if(["referral_friend","referral_reward"].includes(a.benefitKind??"")){
        const value = a.securityPolicyVersion === SECURITY_POLICY_VERSION ? (await Promise.all(a.lineItems.map(line=>ctx.db.get(line.listingId)))).reduce((n,item,i)=>n+(item?.depositAmount??0)*a.lineItems[i].qty,0) : undefined;
        const normalDeposit = value === undefined ? Math.round((a.depositHoldAmount??0)*50)/100 : depositChargeFor(a.protection === "deposit" ? "deposit" : "verify",value);
        if(a.securityWaiverReason||a.depositAmount!==normalDeposit)throw Error("Referral offers require normal upfront security.");
        if(a.benefitKind==="referral_friend"){
          friend=await referralEligibility(ctx,account,a.referralCode??"");if(!friend.valid)throw Error(friend.reason);
          if(Math.round(((a.discount??0)-(a.membershipSignupOfferSaving??0))*100)!==Math.round(Math.min(10,a.subtotal)*100))throw Error("Referral price changed.");
        }else{
          reward=await availableReferralReward(ctx,account);
          if(!reward||reward._id!==a.referralRewardId||Math.round(((a.discount??0)-(a.membershipSignupOfferSaving??0))*100)!==Math.round(a.subtotal*40))throw Error("Your referral reward is no longer available.");
        }
      }
    }
    const customerEmail = a.customerEmail.trim().toLowerCase();
    if (!customerEmail) throw new Error("Customer email is required.");
    if (a.creditAccountId) {
      const creditAccount = await ctx.db.get(a.creditAccountId);
      if (!creditAccount || creditAccount.email.trim().toLowerCase() !== customerEmail)
        throw new Error("Account credit belongs to a different customer.");
    }
    const customerAccount = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", customerEmail)).first();
    if (customerAccount?.blockedAt != null) throw Error("This account is blocked. Contact DB Cinema Rentals.");
    if (a.deliveryBenefitMonth) {
      const account = a.creditAccountId ? await ctx.db.get(a.creditAccountId) : null;
      if (a.deliveryBenefitMonth !== londonMonth() || a.fulfilment !== "delivery" || a.deliveryFee !== 0 || !await studioDeliveryAvailable(ctx, account, a.deliveryBenefitMonth, !!(a.membershipCheckoutId && (await ctx.db.get(a.membershipCheckoutId))?.tier === "studio")))
        throw Error("Your included London delivery has already been reserved. Review the updated total before paying.");
    }
    if (a.membershipCheckoutId) {
      const checkout = await ctx.db.get(a.membershipCheckoutId);
      if (!checkout || checkout.accountId !== a.creditAccountId || checkout.state !== "creating" || checkout.expiresAt <= Date.now()) throw Error("Membership checkout reservation expired.");
      if (a.securityWaiverReason === "new_paid_membership") throw Error("Membership added at checkout cannot waive this rental’s security payment.");
    } else if (a.securityWaiverReason === "new_paid_membership") throw Error("A paid membership checkout is required for this security benefit.");
    if (a.securityWaiverReason === "safe_repeat_kit") {
      const source=a.repeatSourceBookingId?await ctx.db.get(a.repeatSourceBookingId):null;
      const account=a.creditAccountId?await ctx.db.get(a.creditAccountId):null;
      if(!source||!safeRepeatRental(source,account,a.lineItems)||repeatRentalFingerprint(await reviewContext(ctx,source))!==a.repeatSourceFingerprint)throw Error("Your repeat-rental security benefit changed. Refresh checkout before paying.");
    }
    if (a.securityWaiverReason === "paid_membership" && !paidDepositExempt(a.creditAccountId ? await ctx.db.get(a.creditAccountId) : null))
      throw Error("Your paid membership changed. Refresh the security payment before paying.");
    let customer = await ctx.db
      .query("customers")
      .withIndex("by_email", (q) => q.eq("email", customerEmail))
      .first();
    if (!customer) {
      const id = await ctx.db.insert("customers", {
        email: customerEmail,
        name: a.customerName,
        phone: a.phone,
      });
      customer = await ctx.db.get(id);
    }

    if ((a.loyaltySaving ?? 0) > 0) {
      const loyaltyAccount = a.creditAccountId ? await ctx.db.get(a.creditAccountId) : null;
      if (!loyaltyAccount || a.membershipCheckoutId || membershipActiveNow(loyaltyAccount) || !(await loyaltyProgress(ctx,loyaltyAccount)).eligible)
        throw Error("Your Encore benefit changed. Review the updated rental total.");
      const expectedLoyalty = single ? Math.round(a.subtotal*(await loyaltyProgress(ctx,loyaltyAccount)).percent)/100 : Math.round((a.subtotal-(a.discount??0)+a.loyaltySaving!)*10)/100;
      if (Math.round(expectedLoyalty*100) !== Math.round(a.loyaltySaving!*100)) throw Error("Your Encore rental saving changed.");
    }
    // ── store-credit reservation (transactional, double-spend-safe) ──
    // Cap to the account's available balance MINUS credit already reserved by its other pending
    // checkouts, so two concurrent checkouts can't both spend the same credit (each serializable
    // mutation sees the other's reservation). An aborted/deleted pending booking releases its
    // reservation automatically; the actual decrement still happens on confirm.
    let allocations:any[]|undefined;
    let creditApplied = 0;
    if(single){
      const refund=a.refundCreditApplied??0,earned=a.earnedCreditApplied??0;
      if(![refund,earned].every(n=>Number.isFinite(n)&&n>=0)||refund+earned>a.total-a.depositAmount)throw Error("Invalid credit allocation.");
      if((refund+earned)>0&&!a.creditAccountId)throw Error("Account credit requires an account.");
      allocations=a.creditAccountId?await creditPlan(ctx,a.creditAccountId,refund,earned):[];
      creditApplied=Math.round((refund+earned)*100)/100;
    }
    if (!single && a.creditAccountId) {
      const available = await availableCreditFor(ctx, a.creditAccountId);
      creditApplied = Math.min(available, Math.max(0, a.total - a.depositAmount));
    }
    let membershipCreditApplied = 0;
    if (a.membershipCheckoutId) {
      const checkout = (await ctx.db.get(a.membershipCheckoutId))!;
      if (checkout.bookingId) throw Error("Membership credit is already reserved for another rental.");
      const account = await ctx.db.get(checkout.accountId);
      const primaryReduction=(a.discount??0)-(a.membershipSignupOfferSaving??0);
      const expectedOffer = Math.min(membershipSignupOffer(checkout.tier,checkout.intro,a.subtotal+(a.quotedDeliveryFee??a.deliveryFee),!!(account?.membershipSignupOfferUsed || account?.starterRentalOfferUsed)),Math.max(0,a.subtotal-primaryReduction));
      if ((a.membershipSignupOfferSaving ?? 0) !== expectedOffer) throw Error("Your Membership welcome offer changed. Review the updated total before paying.");
      const immediate = checkoutMembershipCredit(checkout.tier, checkout.intro,
        Math.round(Math.max(0, a.subtotal - (a.discount ?? 0) - creditApplied) * 100), account?.membershipCreditDebtPence);
      membershipCreditApplied = single&&a.benefitKind!=="earned_credit"?0:immediate.appliedPence / 100;
    }
    if (Math.round((a.membershipCreditApplied ?? 0) * 100) !== Math.round(membershipCreditApplied * 100))
      throw Error("Your first-month credit changed. Review the updated total before paying.");
    creditApplied = Math.round((creditApplied + membershipCreditApplied) * 100) / 100;
    if (!a.membershipCheckoutId && (a.membershipSignupOfferSaving ?? 0) > 0) throw Error("A paid membership checkout is required for this offer.");
    const chargedTotal = a.total - creditApplied;
    // Credit can be spent in another checkout between the preview and this mutation.
    // Reject atomically before a booking or Stripe session is created.
    if (Math.round(chargedTotal * 100) !== Math.round(a.expectedTotalDue * 100))
      throw new Error("Your available credit changed. Review the updated total before paying.");

    const acceptedAt = Date.now();
    const agreementSnapshot = newAgreement ? snapshotAgreement(a, acceptedAt, chargedTotal, creditApplied) : undefined;
    const bookingId = await ctx.db.insert("bookings", {
      pricingVersion:a.pricingVersion,benefitKind:a.benefitKind,
      refundCreditApplied:a.refundCreditApplied,earnedCreditApplied:a.earnedCreditApplied,creditAllocations:allocations,
      referralCode:friend?.code,referralRewardId:reward?._id,
      customerId: customer!._id,
      guestEmail: customerEmail,
      status: "pending_payment",
      lineItems: a.lineItems,
      fulfilment: a.fulfilment,
      address: a.address,
      billingAddress: a.billingAddress,
      deliveryFee: a.deliveryFee,
      subtotal: a.subtotal,
      discount: a.discount ?? 0,
      promoCode: a.promoCode,
      depositAmount: a.depositAmount,
      depositHoldAmount: a.depositHoldAmount,
      securityPolicyVersion: a.securityPolicyVersion,
      depositHoldStatus: a.depositHoldAmount ? "awaiting_payment" : undefined,
      total: chargedTotal,
      creditApplied,
      membershipCreditApplied,
      membershipSignupOfferSaving: a.membershipSignupOfferSaving,
      deliveryBenefitMonth: a.deliveryBenefitMonth,
      deliveryBenefitAccountId: a.deliveryBenefitMonth ? a.creditAccountId : undefined,
      securityWaiverReason: a.securityWaiverReason,
      membershipCheckoutId: a.membershipCheckoutId,
      accountAccessRequired: a.accountAccessRequired,
      repeatSourceBookingId: a.repeatSourceBookingId,
      repeatSourceFingerprint: a.repeatSourceFingerprint,
      rentalPaidPence: a.membershipCheckoutId ? Math.round(chargedTotal * 100) : undefined,
      currency: a.currency,
      agreementName: a.agreementName,
      agreementSignedAt: a.agreementName ? acceptedAt : undefined,
      agreementSnapshot,
      agreementRequestId: a.agreementRequestId,
      agreementRequestFingerprint,
      securityHoldConsentAt: a.securityHoldConsent ? Date.now() : undefined,
      laterChargeConsentAt: a.laterChargeConsent ? Date.now() : undefined,
      agreementDocs: a.agreementDocs,
      protection: a.protection,
      idVerifyStatus: a.idVerifyStatus ?? "required",
      verificationProvider: a.verificationProvider,
      verificationUpdatedAt: Date.now(),
      pickupTime: a.pickupTime,
      returnTime: a.returnTime,
    });
    if(friend){const redemptionId=await ctx.db.insert("referral_redemptions",{referrerAccountId:friend.referrerAccountId,friendAccountId:account!._id,bookingId,code:friend.code,discount:a.discount??0,state:"reserved",createdAt:Date.now()});await ctx.db.patch(bookingId,{referralRedemptionId:redemptionId});}
    if(reward)await ctx.db.patch(reward._id,{reservedBookingId:bookingId});
    if (a.membershipCheckoutId) await ctx.db.patch(a.membershipCheckoutId, {bookingId, membershipSignupOfferSaving:a.membershipSignupOfferSaving, initialCreditAppliedPence:Math.round(membershipCreditApplied * 100)});
    await linkMatchingRecovery(ctx,customerEmail,a.lineItems,bookingId);
    return { bookingId, creditApplied };
  },
});

/** Soft holds: reserve the units for a TTL while the renter is at checkout, so
 *  two people can't grab the last unit at once. Released on confirm or by cron. */
export const placeHolds = internalMutation({
  args: { bookingId: v.id("bookings"), ttlMs: v.number() },
  handler: async (ctx, { bookingId, ttlMs }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) return;
    const now = Date.now();
    const expires = now + ttlMs;
    const ACTIVE = new Set(["confirmed", "active", "hold"]);

    // Gather this booking's demand per physical unit (BOM-aware) + the rows to insert.
    const demandByUnit = new Map<string, { ivs: Iv[]; title: string }>();
    const toInsert: { unitId: any; listingId: any; start: number; end: number; qty: number }[] = [];
    for (const li of booking.lineItems) {
      const listing = await ctx.db.get(li.listingId);
      if (!listing) continue;
      for (const comp of listing.components) {
        const uid = String(comp.inventoryUnitId);
        const qty = (comp.qty || 1) * (li.qty || 1);
        const d = demandByUnit.get(uid) ?? { ivs: [], title: li.title };
        d.ivs.push({ start: li.start, end: li.end, qty });
        demandByUnit.set(uid, d);
        toInsert.push({ unitId: comp.inventoryUnitId, listingId: li.listingId, start: li.start, end: li.end, qty });
      }
    }

    // ATOMIC, unit-aware re-check: existing ACTIVE (non-expired) reservations + this booking's
    // demand must not exceed owned stock for ANY shared unit. This runs inside the serializable
    // hold-insert mutation, so two concurrent checkouts for the last unit cannot both pass
    // (closes the action-level TOCTOU), and it catches cross-listing shared-unit demand.
    for (const [uid, d] of demandByUnit) {
      const unit: any = await ctx.db.get(uid as any);
      const owned = unit?.quantityOwned ?? 1;
      const lo = Math.min(...d.ivs.map((i) => i.start));
      const hi = Math.max(...d.ivs.map((i) => i.end));
      const existing: Iv[] = [];
      const rows = await ctx.db.query("reservations")
        .withIndex("by_unit", (q) => q.eq("inventoryUnitId", uid as any)).collect();
      for (const r of rows) {
        if (!ACTIVE.has(r.status) || r.start > hi || r.end < lo || r.bookingId === bookingId) continue;
        if (r.status === "hold" && (r.holdExpiresAt ?? 0) < now) {
          const pendingBooking = r.bookingId ? await ctx.db.get(r.bookingId) : null;
          if (pendingBooking?.status !== "pending_payment") continue;
        }
        existing.push({ start: r.start, end: r.end, qty: r.qty || 1 });
      }
      if (peak([...existing, ...d.ivs]) > owned) {
        throw new Error(`"${d.title}" was just taken for those dates — please adjust your dates or remove it.`);
      }
    }

    // All clear → place the soft holds.
    for (const ins of toInsert) {
      await ctx.db.insert("reservations", {
        inventoryUnitId: ins.unitId,
        listingId: ins.listingId,
        bookingId,
        start: ins.start,
        end: ins.end,
        qty: ins.qty,
        source: "site",
        status: "hold",
        holdExpiresAt: expires,
      });
    }
  },
});

export const releaseExpiredHolds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const holds = await ctx.db
      .query("reservations")
      .withIndex("by_status", (q) => q.eq("status", "hold"))
      .collect();
    let n = 0;
    for (const h of holds)
      if ((h.holdExpiresAt ?? 0) < now) {
        const booking = h.bookingId ? await ctx.db.get(h.bookingId) : null;
        // A pending payment can already be paid at Stripe while its webhook is
        // delayed. Only the Stripe reconciliation action may close that booking.
        if (booking?.status === "pending_payment") continue;
        await ctx.db.delete(h._id);
        n++;
      }
    return { released: n };
  },
});

/** Provider reconciliation reads these without trusting a booking's age as payment evidence. */
export const pendingCheckoutSessions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "pending_payment"))
      .collect();
    return rows.map((b) => ({
      bookingId: b._id,
      sessionId: b.stripeCheckoutSessionId ?? null,
      createdAt: b._creationTime,
    }));
  },
});

/** Called only after Stripe says the session is terminal and unpaid, or no
 * session was ever bound and the checkout action never returned a URL. */
export const expireUnpaidPending = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.optional(v.string()) },
  handler: async (ctx, { bookingId, sessionId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking || (booking.activeAdditionId || booking.activeExtensionId) || booking.status !== "pending_payment" ||
        (booking.stripeCheckoutSessionId ?? undefined) !== sessionId) return false;
    const res = await ctx.db.query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId)).collect();
    for (const hold of res) if (hold.status === "hold") await ctx.db.delete(hold._id);
    if (booking.membershipCheckoutId) {
      const member=await ctx.db.get(booking.membershipCheckoutId);
      if(member && ["creating","open"].includes(member.state)) await ctx.db.patch(member._id,{state:"expired"});
    }
    await releaseReferral(ctx,booking);
    await ctx.db.patch(bookingId, { status: "cancelled", cancelledAt: Date.now(), checkoutExpiredAt: Date.now() });
    return true;
  },
});

export const confirm = internalMutation({
  args: { bookingId: v.id("bookings"), paymentIntentId: v.optional(v.string()) },
  handler: async (ctx, { bookingId, paymentIntentId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) throw new Error("booking not found");
    await stopMatchingRecovery(ctx,booking.guestEmail??"",booking.lineItems,bookingId);
    if (booking.cancellationDecision || booking.status === "cancelled" || booking.status === "returned")
      return { closed: true, duplicatePayment: false };
    if (booking.status === "confirmed" || booking.status === "active") {
      if(paymentIntentId&&booking.stripePaymentIntentId&&paymentIntentId!==booking.stripePaymentIntentId)return {closed:true,duplicatePayment:true};
      return { already: true };
    }
    if ((booking.membershipCreditApplied ?? 0) > 0) {
      const grant = booking.membershipCreditGrantId ? await ctx.db.get(booking.membershipCreditGrantId) : null;
      if (!grant || grant.initialCreditAppliedPence !== Math.round(booking.membershipCreditApplied! * 100))
        throw Error("The paid first-month credit receipt has not settled yet.");
    }
    // Email ownership must be proved before an automatically created account gains a session.
    if (booking.accountAccessRequired || !await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", booking.guestEmail ?? "")).first())
      await ctx.scheduler.runAfter(0, internal.accountAccess.sendForRental, { bookingId });
    // clear this booking's soft holds before writing the real reservations
    const holds = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    for (const h of holds) if (h.status === "hold") await ctx.db.delete(h._id);
    await ctx.db.patch(bookingId, {
      status: "confirmed",
      stripePaymentIntentId: paymentIntentId,
    });
    const membershipAccount = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", booking.guestEmail ?? "")).first();
    if(membershipAccount&&!membershipAccount.firstRentalPaidAt)await ctx.db.patch(membershipAccount._id,{firstRentalPaidAt:Date.now()});
    if (membershipAccount?.membershipPerksPendingBookingId === bookingId)
      await ctx.db.patch(membershipAccount._id,{membershipPerksPendingBookingId:undefined});
    // write the reservation ledger (source:site) per BOM component
    for (const li of booking.lineItems) {
      const listing = await ctx.db.get(li.listingId);
      if (!listing) continue;
      for (const comp of listing.components) {
        await ctx.db.insert("reservations", {
          inventoryUnitId: comp.inventoryUnitId,
          listingId: li.listingId,
          bookingId,
          start: li.start,
          end: li.end,
          qty: comp.qty * li.qty,
          source: "site",
          status: "confirmed",
        });
      }
    }
    // record promo redemption (enforces one-time / once-a-month limits)
    if (booking.promoCode && booking.guestEmail) {
      await ctx.db.insert("promo_redemptions", {
        email: booking.guestEmail.trim().toLowerCase(),
        code: booking.promoCode,
        at: Date.now(),
      });
    }
    // decrement any store credit applied at checkout — only now that payment has succeeded (FIFO by expiry)
    if (booking.creditApplied && booking.creditApplied > 0 && booking.guestEmail) {
      const acct = await ctx.db
        .query("accounts")
        .withIndex("by_email", (q) => q.eq("email", booking.guestEmail!.trim().toLowerCase()))
        .first();
      if (acct) {
        const now = Date.now();
        const rows = (
          await ctx.db.query("credits").withIndex("by_account", (q) => q.eq("accountId", acct._id)).collect()
        )
          // Credit was reserved while valid at checkout. The provider webhook may
          // arrive after its expiry, so consume that reservation rather than
          // silently giving a discount without using the credit.
          .filter((c) => c.status === "active" && c.createdAt <= booking._creationTime &&
            c.expiresAt > booking._creationTime && c.remaining > 0)
          .sort((a, b) => a.expiresAt - b.expiresAt);
        // The first invoice grant spends its reserved portion atomically. Only
        // pre-existing account credits are consumed by the ordinary FIFO ledger.
        let need = booking.creditApplied - (booking.membershipCreditApplied ?? 0);
        let debtPence = 0;
        const frozenRows=booking.creditAllocations ? await Promise.all(booking.creditAllocations.map(async allocation=>({credit:await ctx.db.get(allocation.creditId),amount:allocation.amount}))) : rows.map(credit=>({credit,amount:credit.remaining}));
        for (const entry of frozenRows) {
          const c=entry.credit;
          if(!c||c.accountId!==acct._id||c.remaining<entry.amount)throw Error("Reserved credit source changed.");
          if (need <= 0) break;
          const take = Math.min(entry.amount, need);
          const debit = creditDebit(c,take); debtPence += debit.debtPence;
          await ctx.db.patch(c._id, debit.patch);
          need -= take;
        }
        if (debtPence) await ctx.db.patch(acct._id,{membershipCreditDebtPence:(acct.membershipCreditDebtPence??0)+debtPence});
      }
    }
    if(booking.referralRedemptionId){
      const r=await ctx.db.get(booking.referralRedemptionId);
      if(r?.state==="reserved"){await ctx.db.patch(r._id,{state:"paid",paidAt:Date.now()});await ctx.db.patch(r.friendAccountId,{referralFirstUsedAt:Date.now()});}
    }
    if(booking.referralRewardId){
      const r=await ctx.db.get(booking.referralRewardId);
      if(r?.state==="available"&&r.reservedBookingId===bookingId){await ctx.db.patch(r._id,{state:"used",usedBookingId:bookingId,usedAt:Date.now()});await ctx.db.patch(r.accountId,{referralRewardUsedAt:Date.now()});}
    }
    await ctx.scheduler.runAfter(0, internal.referralPayments.attest, {bookingId});
    await ctx.scheduler.runAfter(0, internal.notify.bookingAlert, { bookingId });
    await ctx.scheduler.runAfter(0, internal.invoice.invoiceEmail, { bookingId });
    await ctx.scheduler.runAfter(0, internal.chat.postBookingMessages, { bookingId });
    await ctx.scheduler.runAfter(0, internal.didit.reuseVerification, { bookingId });
    await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId });
    return { already: false };
  },
});

export const bindCheckoutSession = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string() },
  handler: async (ctx, { bookingId, sessionId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.status !== "pending_payment") throw new Error("Checkout is no longer pending.");
    if (b.stripeCheckoutSessionId && b.stripeCheckoutSessionId !== sessionId)
      throw new Error("Checkout session already exists.");
    await ctx.db.patch(bookingId, { stripeCheckoutSessionId: sessionId });
  },
});

/** Booking context for the chat assistant (resolves the owning account). */
export const getForChat = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const acct = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()))
      .first();
    return {
      accountId: acct?._id ?? null,
      lineItems: b.lineItems,
      fulfilment: b.fulfilment,
      address: b.address ?? null,
      pickupTime: b.pickupTime ?? null,
    };
  },
});

/** Attach a paid add-on to an existing booking (instant upsell checkout). */
/** Backwards-compatible fulfilment for sessions created before owner-only proposals. */
export const attachAddon = internalMutation({
 args:{bookingId:v.id("bookings"),listingId:v.id("listings"),title:v.string(),start:v.number(),end:v.number(),total:v.number(),sessionId:v.string(),paymentIntentId:v.string()},
 handler:async(ctx,a)=>{
  const prior=await ctx.db.query("rental_additions").withIndex("by_session",q=>q.eq("sessionId",a.sessionId)).first();
  if(prior)return {closed:prior.status!=="applied",already:true};
  const b=await ctx.db.get(a.bookingId);
  if(!b||!["confirmed","active"].includes(b.status)||b.cancellationDecision||b.returnDecision||(b.activeAdditionId || b.activeExtensionId))return {closed:true};
  const listing=await ctx.db.get(a.listingId);if(!listing)return {closed:true};
  const line={listingId:a.listingId,title:listing.title,start:a.start,end:a.end,qty:1,lineTotal:a.total,dailyRate:listing.pricing.daily};
  if(!Number.isFinite(a.total)||a.total<=0||a.start%86400000!==0||a.end%86400000!==0)return {closed:true};
  try{await assertRentalInventory(ctx,[...b.lineItems,line],b._id);}catch{return {closed:true};}
  const now=Date.now();
  await ctx.db.insert("rental_additions",{...line,bookingId:b._id,requestId:`legacy-${a.sessionId}`,securityCharge:0,holdTotal:b.depositHoldAmount??0,status:"applied",reason:"Legacy paid item addition",createdAt:now,updatedAt:now,sessionId:a.sessionId,paymentIntentId:a.paymentIntentId});
  await ctx.db.patch(b._id,{lineItems:[...b.lineItems,line],subtotal:b.subtotal+a.total,total:b.total+a.total});
  for(const comp of listing.components)await ctx.db.insert("reservations",{inventoryUnitId:comp.inventoryUnitId,listingId:a.listingId,bookingId:b._id,start:a.start,end:a.end,qty:comp.qty,source:"site",status:b.status==="active"?"active":"confirmed"});
  const account=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",(b.guestEmail??"").trim().toLowerCase())).first();
  if(account)await postRentalMessage(ctx,{accountId:account._id,bookingId:b._id,sender:"system",text:`Added to your rental: ${listing.title}. Rental charge £${a.total.toFixed(2)}.`});
  await ctx.scheduler.runAfter(0,internal.rmv2_webhook.push,{bookingId:b._id});
  return {closed:false};
 }
});

export const adminList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) {
      return { authorized: false as const, items: [] };
    }
    const rows = await ctx.db.query("bookings").order("desc").take(100);
    const items = rows.map((b) => ({
      _id: b._id,
      status: b.status,
      guestEmail: b.guestEmail,
      lineItems: b.lineItems,
      fulfilment: b.fulfilment,
      address: b.address,
      subtotal: b.subtotal,
      depositAmount: b.depositAmount,
      depositHoldAmount: b.depositHoldAmount ?? 0,
      depositHoldStatus: b.depositHoldStatus ?? null,
      depositHoldExpiresAt: b.depositHoldExpiresAt ?? null,
      depositHoldRenewalStatus: b.depositHoldRenewalStatus ?? null,
      lateFeeAmount: b.lateFeeAmount ?? 0,
      lateFeeWaivedAmount: b.lateFeeWaivedAmount ?? 0,
      lateFeeStatus: b.lateFeeStatus ?? null,
      lateFeeBreakdown: b.lateFeeBreakdown ?? [],
      lateFeePaidFromHold: b.lateFeePaidFromHold ?? 0,
      lateFeePaidFromCard: b.lateFeePaidFromCard ?? 0,
      lateFeeReceiptEmailStatus: b.lateFeeReceiptEmailStatus ?? null,
      total: b.total,
      depositRefunded: b.depositRefunded ?? false,
      depositKept: b.depositKept ?? 0,
      depositRefundAmount: b.depositRefundAmount ?? 0,
      damageNoticeSentAt: b.damageNoticeSentAt ?? null,
      returnedAt: b.returnedAt ?? null,
      actualReturnedAt: b.actualReturnedAt ?? null,
      returnDecision: b.returnDecision ?? null,
      returnTime: b.returnTime ?? null,
      returnStatementEmailStatus: b.returnStatementEmailStatus ?? null,
      idVerifyStatus: b.idVerifyStatus ?? "required",
      verificationProvider: b.verificationProvider ?? "stripe",
      diditSessionId: b.diditSessionId ?? null,
      verificationNote: b.verificationNote ?? null,
      verificationUpdatedAt: b.verificationUpdatedAt ?? null,
      agreementName: b.agreementName ?? null,
      promoCode: b.promoCode ?? null,
      discount: b.discount ?? 0,
      at: b._creationTime,
    }));
    return { authorized: true as const, items };
  },
});

export const adminSetStatus = mutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    status: v.union(
      v.literal("confirmed"),
      v.literal("active"),
    ),
  },
  handler: async (ctx, { token, bookingId, status }) => {
    await assertAdmin(ctx, token, "bookings.adminSetStatus");
    const booking = await ctx.db.get(bookingId);
    if (!booking) throw new Error("Booking not found");
    if(booking.returnDecision)throw Error("Return settlement is in progress; finish it before changing this rental.");
    if((booking.activeAdditionId || booking.activeExtensionId))throw Error("Finish or withdraw the item addition or approved extension before handover.");
    if(booking.cancellationDecision)throw Error("Cancellation is in progress; resume its settlement before changing this rental.");
    if (["cancelled", "returned"].includes(booking.status) && booking.status !== status)
      throw new Error("A closed booking cannot be reopened by changing its status.");
    if (booking.status === "pending_payment")
      throw new Error("Payment must be confirmed by Stripe before this booking is confirmed.");
    if (status === "active" && (booking.idVerifyStatus !== "verified" || (Math.min(booking.verificationExpiresAt ?? ((booking.idVerifiedAt ?? 0) + VERIFICATION_REUSE_DAYS * 86400000), booking.documentExpiresAt ?? Infinity) <= Date.now())))
      throw new Error("Identity and address verification must be approved before handover.");
    if (status === "active" && booking.depositHoldAmount &&
        (booking.depositHoldStatus !== "held" || (booking.depositHoldExpiresAt ?? 0) <= Date.now()))
      throw new Error("The card hold must be active before handover.");
    if (status === "active") assertAgreementBeforeRelease(booking);
    await ctx.db.patch(bookingId, { status, ...(status === "active" ? { pickedUpAt: booking.pickedUpAt ?? Date.now(), deliveryBenefitConsumed: !!booking.deliveryBenefitMonth } : {}) });
    await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId });
  },
});

export const getForRefund = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      paymentSources:await rentalPaymentSources(ctx,b),
      paymentIntentId: b.stripePaymentIntentId ?? null,
      depositAmount: b.depositAmount,
      depositHoldAmount: b.depositHoldAmount ?? 0,
      depositHoldStatus: b.depositHoldStatus ?? null,
      depositHoldIntentId: b.stripeDepositIntentId ?? null,
      depositHoldPreviousIntentIds: b.depositHoldPreviousIntentIds ?? [],
      lineItems: b.lineItems,
      returnTime: b.returnTime ?? null,
      guestEmail: b.guestEmail ?? null,
      returnDecision: b.returnDecision ?? null,
      depositRefunded: b.depositRefunded ?? false,
      depositKept: b.depositKept ?? 0,
      depositRefundAmount: b.depositRefundAmount ?? 0,
      damageNoticeSentAt: b.damageNoticeSentAt ?? null,
    };
  },
});

export const beginReturnDecision = internalMutation({
  args: { bookingId: v.id("bookings"), actualReturnedAt: v.number(), damageKept: v.number(), damageNote: v.optional(v.string()), chargeLate: v.boolean(), lateWaiverReason: v.optional(v.string()) },
  handler: async (ctx, { bookingId, actualReturnedAt, damageKept, damageNote, chargeLate, lateWaiverReason }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || !["confirmed", "active", "returned"].includes(b.status)) throw new Error("Booking is not available for return.");
    if((b.activeAdditionId || b.activeExtensionId))throw Error("Finish or withdraw the item addition or approved extension before returning this rental");
    if(b.cancellationDecision)throw Error("Cancellation settlement is in progress; resume it first.");
    const refundJobs=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
    if(refundJobs.some(r=>r.status==="prepared"||r.status==="pending"))throw Error("Wait for the rental refund to settle before recording the return.");
    const saved = b.returnDecision;
    if (saved) {
      if (saved.actualReturnedAt !== actualReturnedAt || saved.damageKept !== damageKept ||
          (saved.damageNote ?? "") !== (damageNote ?? "") || saved.chargeLate !== chargeLate ||
          (saved.lateWaiverReason ?? "") !== (lateWaiverReason ?? ""))
        throw new Error("A return settlement is already in progress with different amounts. Resume the saved decision or contact support before changing it.");
      return;
    }
    await ctx.db.patch(bookingId, { returnDecision: { actualReturnedAt, damageKept, damageNote, chargeLate, lateWaiverReason, startedAt: Date.now() } });
  },
});

export const markDamageNoticeSent = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (b?.returnDecision && !b.damageNoticeSentAt)
      await ctx.db.patch(bookingId, { damageNoticeSentAt: Date.now() });
  },
});

export const holdContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      status: b.status,
      amount: b.depositHoldAmount ?? 0,
      intentId: b.stripeDepositIntentId ?? null,
      holdStatus: b.depositHoldStatus ?? null,
    };
  },
});

export const setHold = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    intentId: v.optional(v.string()),
    status: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { bookingId, intentId, status, expiresAt }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || !b.depositHoldAmount) return;
    if (b.stripeDepositIntentId && intentId && b.stripeDepositIntentId !== intentId)
      throw new Error("A different hold is already linked to this booking");
    await ctx.db.patch(bookingId, {
      stripeDepositIntentId: intentId ?? b.stripeDepositIntentId,
      depositHoldStatus: status,
      depositHoldExpiresAt: expiresAt,
    });
  },
});

export const renewalCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const confirmed = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "confirmed")).order("desc").take(1000);
    const active = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "active")).order("desc").take(1000);
    return [...confirmed, ...active]
      .filter((b) => (b.depositHoldPreviousIntentIds?.length ?? 0) > 0 ||
        (b.depositHoldAmount && b.depositHoldStatus === "held" && b.stripeDepositIntentId &&
        (b.depositHoldExpiresAt ?? 0) <= now + 24 * 3600000 &&
        Math.max(...b.lineItems.map((li) => li.end)) >= now - 30 * 86400000))
      .map((b) => b._id);
  },
});

export const renewalContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      status: b.status, guestEmail: b.guestEmail ?? null,
      amount: b.depositHoldAmount ?? 0, oldIntentId: b.stripeDepositIntentId ?? null,
      expiresAt: b.depositHoldExpiresAt ?? null,
      renewalIntentId: b.depositHoldRenewalIntentId ?? null,
      renewalStatus: b.depositHoldRenewalStatus ?? null,
      renewalAt: b.depositHoldRenewalAt ?? null,
      previousIntentIds: b.depositHoldPreviousIntentIds ?? [],
    };
  },
});

export const claimRenewal = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    const now = Date.now();
    if (!b || b.activeAdditionId || b.cancellationDecision || b.returnDecision || !["confirmed", "active"].includes(b.status) || !b.depositHoldAmount || b.depositHoldStatus !== "held" || !b.stripeDepositIntentId ||
      (b.depositHoldExpiresAt ?? 0) > now + 24 * 3600000 ||
      ["requires_action", "failed"].includes(b.depositHoldRenewalStatus ?? "") ||
      (b.depositHoldRenewalStatus === "starting" && (b.depositHoldRenewalAt ?? now) > now - 15 * 60000)) return false;
    await ctx.db.patch(bookingId, { depositHoldRenewalStatus: "starting", depositHoldRenewalAt: now });
    return true;
  },
});

export const setRenewalResult = internalMutation({
  args: { bookingId: v.id("bookings"), oldIntentId: v.string(), status: v.string(), intentId: v.optional(v.string()) },
  handler: async (ctx, { bookingId, oldIntentId, status, intentId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.stripeDepositIntentId !== oldIntentId) return;
    await ctx.db.patch(bookingId, { depositHoldRenewalStatus: status, depositHoldRenewalIntentId: intentId, depositHoldRenewalAt: Date.now() });
  },
});

export const replaceHold = internalMutation({
  args: { bookingId: v.id("bookings"), oldIntentId: v.string(), newIntentId: v.string(), expiresAt: v.number() },
  handler: async (ctx, { bookingId, oldIntentId, newIntentId, expiresAt }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.cancellationDecision || b.returnDecision || b.stripeDepositIntentId !== oldIntentId || !["confirmed", "active"].includes(b.status)) return false;
    await ctx.db.patch(bookingId, {
      stripeDepositIntentId: newIntentId,
      depositHoldStatus: "held",
      depositHoldExpiresAt: expiresAt,
      depositHoldRenewalIntentId: undefined,
      depositHoldRenewalStatus: "renewed",
      depositHoldRenewalAt: Date.now(),
      depositHoldPreviousIntentIds: [...(b.depositHoldPreviousIntentIds ?? []), oldIntentId],
    });
    return true;
  },
});

export const clearPreviousHold = internalMutation({
  args: { bookingId: v.id("bookings"), intentId: v.string() },
  handler: async (ctx, { bookingId, intentId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return;
    await ctx.db.patch(bookingId, {
      depositHoldPreviousIntentIds: (b.depositHoldPreviousIntentIds ?? []).filter((id) => id !== intentId),
    });
  },
});

/** Mark a booking returned + flip its reservations to returned (frees the inventory ledger). */
export const markReturnedStatus = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return;
    if (b.status !== "returned") await ctx.db.patch(bookingId, { status: "returned" });
    if (b.guestEmail) await unlockLoyalty(ctx,b.guestEmail);
    const res = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    for (const r of res) if (r.status !== "returned") await ctx.db.patch(r._id, { status: "returned" });
    await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId });
  },
});

/** Record that the deposit was released (depositKept = amount retained for damage). */
export const markDepositReleased = internalMutation({
  args: { bookingId: v.id("bookings"), kept: v.number(), refunded: v.number(), capturedFromHold: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, { bookingId, kept, refunded, capturedFromHold, note }) => {
    await ctx.db.patch(bookingId, { depositRefunded: true, depositKept: kept, depositRefundAmount: refunded, depositHoldCapturedForDamage: capturedFromHold, depositDeductionNote: note, returnedAt: Date.now() });
  },
});

const lateLine = v.object({ title: v.string(), days: v.number(), dailyRate: v.number(), amount: v.number() });

export const recordLateFee = internalMutation({
  args: { bookingId: v.id("bookings"), actualReturnedAt: v.number(), amount: v.number(), breakdown: v.array(lateLine), waivedAmount: v.optional(v.number()), waiverReason: v.optional(v.string()) },
  handler: async (ctx, { bookingId, actualReturnedAt, amount, breakdown, waivedAmount, waiverReason }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.actualReturnedAt) return;
    await ctx.db.patch(bookingId, {
      actualReturnedAt,
      lateFeeAmount: amount,
      lateFeeWaivedAmount: waivedAmount,
      lateFeeWaiverReason: waiverReason,
      lateFeeBreakdown: breakdown,
      lateFeeStatus: amount > 0 ? "notice_pending" : waivedAmount ? "waived" : "none",
    });
    const customer = b.customerId ? await ctx.db.get(b.customerId) : null;
    const refundJobs=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
    const issuedAt = Date.now();
    await ctx.db.patch(bookingId, {
      returnStatement: {
        number: `DBC-R-${String(bookingId).toUpperCase()}`, issuedAt, actualReturnedAt,
        agreedReturnTime: b.returnTime,
        supplierName: process.env.BUSINESS_LEGAL_NAME || "Db Cinema Rentals",
        supplierAddress: process.env.BUSINESS_INVOICE_ADDRESS || undefined,
        customerName: customer?.name || undefined,
        customerEmail: b.guestEmail ?? "",
        billingAddress: b.billingAddress ?? b.address,
        lineItems: rentalBillingLines(b),
        subtotal: b.subtotal, discount: b.discount ?? 0, deliveryFee: b.deliveryFee ?? 0,
        creditApplied: b.creditApplied ?? 0, checkoutPaid: b.total, rentalRefunded:confirmedRentalRefundPence(refundJobs)/100,
        securityPaid: b.depositAmount, securityRefunded: b.depositRefundAmount ?? 0,
        holdStatus: b.depositHoldStatus,
        damageTotal: b.depositKept ?? 0, damageFromHold: b.depositHoldCapturedForDamage ?? 0,
        damageNote: b.depositDeductionNote,
        lateAssessed: amount, lateWaived: waivedAmount ?? 0, lateBreakdown: breakdown,
      },
      returnStatementEmailStatus: "pending",
    });
    if (amount > 0) await ctx.scheduler.runAfter(0, internal.lateFees.sendNotice, { bookingId });
    await ctx.scheduler.runAfter(0, internal.referralPayments.attest, {bookingId});
    await ctx.scheduler.runAfter(0, internal.invoice.returnSettlementEmail, { bookingId });
  },
});

export const lateFeeContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      status: b.status, guestEmail: b.guestEmail ?? null,
      lateFeeAmount: b.lateFeeAmount ?? 0, lateFeeStatus: b.lateFeeStatus ?? null,
      lateFeeBreakdown: b.lateFeeBreakdown ?? [], lateFeeNoticeAt: b.lateFeeNoticeAt ?? null,
      stripePaymentIntentId: b.stripePaymentIntentId ?? null,
      actualReturnedAt: b.actualReturnedAt ?? null,
      agreedReturnTime: b.returnTime ?? null,
      agreedReturns: b.lineItems.map(li => ({ title: li.title, end: li.end, time: li.returnTime === undefined ? b.returnTime ?? null : li.returnTime })),
      stripeDepositIntentId: b.stripeDepositIntentId ?? null,
      depositHoldAmount: b.depositHoldAmount ?? 0,
      depositKept: b.depositKept ?? 0,
      lateFeePaidFromHold: b.lateFeePaidFromHold ?? 0,
      lateFeePaidFromCard: b.lateFeePaidFromCard ?? 0,
      lateFeeIntentId: b.lateFeeIntentId ?? null,
    };
  },
});

/** A bank challenge can finish after the renter closes the page. Reconcile its
 * existing PaymentIntent only; never create a second charge. */
export const pendingLateAuthentications = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "returned"))
      .order("desc").take(1000);
    return rows.filter((b) => b.lateFeeIntentId &&
      ["requires_action", "processing"].includes(b.lateFeeStatus ?? ""))
      .map((b) => b._id);
  },
});

export const settleAuthenticatedLateCharge = internalMutation({
  args: {
    bookingId: v.id("bookings"), intentId: v.string(), status: v.string(),
    paidFromCard: v.number(), note: v.optional(v.string()),
  },
  handler: async (ctx, { bookingId, intentId, status, paidFromCard, note }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.status !== "returned" || b.lateFeeIntentId !== intentId ||
      !["requires_action", "processing"].includes(b.lateFeeStatus ?? "")) return false;
    if (!Number.isFinite(paidFromCard) || paidFromCard < 0 ||
      paidFromCard > Math.max(0, (b.lateFeeAmount ?? 0) - (b.lateFeePaidFromHold ?? 0)))
      throw new Error("Late charge settlement amount is invalid.");
    if (status === b.lateFeeStatus && paidFromCard === (b.lateFeePaidFromCard ?? 0)) return false;
    await ctx.db.patch(bookingId, {
      lateFeeStatus: status,
      lateFeePaidFromCard: paidFromCard,
      lateFeeNote: note?.slice(0, 400),
      lateFeeReceiptEmailStatus: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.lateFees.sendCollectionResult, { bookingId });
    return true;
  },
});

export const claimLateNotice = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || !b.lateFeeAmount || !(
      ["notice_pending", "notice_failed"].includes(b.lateFeeStatus ?? "") ||
      (b.lateFeeStatus === "sending_notice" && (b.lateFeeNoticeAttemptAt ?? 0) < Date.now() - 15 * 60000)
    )) return false;
    await ctx.db.patch(bookingId, { lateFeeStatus: "sending_notice", lateFeeNoticeAttemptAt: Date.now() });
    return true;
  },
});

export const markLateNotice = internalMutation({
  args: { bookingId: v.id("bookings"), sent: v.boolean() },
  handler: async (ctx, { bookingId, sent }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.lateFeeStatus !== "sending_notice") return;
    await ctx.db.patch(bookingId, {
      lateFeeStatus: sent ? "notice_sent" : "notice_failed",
      lateFeeNoticeAt: sent ? Date.now() : undefined,
    });
  },
});

export const dueLateFees = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "returned")).order("desc").take(1000);
    const now = Date.now();
    return rows.filter((b) =>
      b.lateFeeStatus === "notice_pending" || b.lateFeeStatus === "notice_failed" ||
      (b.lateFeeStatus === "sending_notice" && (b.lateFeeNoticeAttemptAt ?? 0) <= now - 15 * 60000) ||
      (b.lateFeeStatus === "notice_sent" && (b.lateFeeNoticeAt ?? now) <= now - 7 * 86400000) ||
      (b.lateFeeStatus === "charging" && (b.lateFeeChargingAt ?? now) <= now - 15 * 60000),
    ).map((b) => ({ bookingId: b._id, status: b.lateFeeStatus }));
  },
});

export const claimLateCharge = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (b?.actualReturnedAt && Date.now() > b.actualReturnedAt + 30 * 86400000) {
      await ctx.db.patch(bookingId, { lateFeeStatus: "expired", lateFeeNote: "30-day collection window elapsed" });
      return false;
    }
    if (!b || b.status !== "returned" || !["notice_sent", "charging"].includes(b.lateFeeStatus ?? "") || !b.lateFeeAmount ||
      !b.lateFeeNoticeAt || b.lateFeeNoticeAt > Date.now() - 7 * 86400000) return false;
    if (b.lateFeeStatus === "charging" && (b.lateFeeChargingAt ?? Date.now()) > Date.now() - 15 * 60000) return false;
    await ctx.db.patch(bookingId, { lateFeeStatus: "charging", lateFeeChargingAt: Date.now() });
    return true;
  },
});

export const markLateCharge = internalMutation({
  args: { bookingId: v.id("bookings"), status: v.string(), intentId: v.optional(v.string()), note: v.optional(v.string()), paidFromHold: v.number(), paidFromCard: v.number() },
  handler: async (ctx, { bookingId, status, intentId, note, paidFromHold, paidFromCard }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.lateFeeStatus !== "charging") return;
    await ctx.db.patch(bookingId, {
      lateFeeStatus: status, lateFeeIntentId: intentId,
      lateFeeNote: note?.slice(0, 400),
      lateFeePaidFromHold: paidFromHold,
      lateFeePaidFromCard: paidFromCard,
      lateFeeReceiptEmailStatus: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.lateFees.sendCollectionResult, { bookingId });
  },
});

export const claimLateFeeReceiptEmail = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || !["pending", "failed", "sending"].includes(b.lateFeeReceiptEmailStatus ?? "") ||
      (b.lateFeeReceiptEmailStatus === "sending" && (b.lateFeeReceiptEmailAttemptAt ?? 0) > Date.now() - 15 * 60000)) return false;
    await ctx.db.patch(bookingId, { lateFeeReceiptEmailStatus: "sending", lateFeeReceiptEmailAttemptAt: Date.now() });
    return true;
  },
});

export const markLateFeeReceiptEmail = internalMutation({
  args: { bookingId: v.id("bookings"), sent: v.boolean() },
  handler: async (ctx, { bookingId, sent }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.lateFeeReceiptEmailStatus !== "sending") return;
    await ctx.db.patch(bookingId, { lateFeeReceiptEmailStatus: sent ? "sent" : "failed", lateFeeReceiptEmailedAt: sent ? Date.now() : undefined });
  },
});

export const dueLateFeeReceiptEmails = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "returned")).order("desc").take(1000);
    return rows.filter((b) => b.lateFeeReceiptEmailStatus === "pending" || b.lateFeeReceiptEmailStatus === "failed" ||
      (b.lateFeeReceiptEmailStatus === "sending" && (b.lateFeeReceiptEmailAttemptAt ?? 0) <= now - 15 * 60000))
      .map((b) => b._id);
  },
});

export const adminPauseLateFee = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), reason: v.string() },
  handler: async (ctx, { token, bookingId, reason }) => {
    await assertAdmin(ctx, token, "bookings.adminPauseLateFee");
    if (reason.trim().length < 5) throw new Error("Record the dispute or waiver reason.");
    const b = await ctx.db.get(bookingId);
    if (!b || !["notice_pending", "notice_failed", "notice_sent"].includes(b.lateFeeStatus ?? ""))
      throw new Error("This late charge can no longer be paused.");
    await ctx.db.patch(bookingId, { lateFeeStatus: "paused", lateFeeNote: reason.trim().slice(0, 400) });
    await ctx.scheduler.runAfter(0, internal.checkout.releasePausedLateHold, { bookingId });
  },
});

export const remindersFeed = internalQuery({
  args: {},
  handler: async (ctx) => {
    const confirmed = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "confirmed"))
      .collect();
    const active = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const returned = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "returned"))
      .collect();
    const out = [];
    for (const b of [...confirmed, ...active, ...returned]) {
      if (!b.guestEmail) continue;
      const acct = await ctx.db
        .query("accounts")
        .withIndex("by_email", (q) => q.eq("email", b.guestEmail!.trim().toLowerCase()))
        .first();
      out.push({
        _id: b._id,
        start: Math.min(...b.lineItems.map((li) => li.start)),
        end: Math.max(...b.lineItems.map((li) => li.end)),
        guestEmail: b.guestEmail,
        accountId: acct?._id ?? null,
        fulfilment: b.fulfilment,
        pickupTime: b.pickupTime ?? null,
        returnTime: b.returnTime ?? null,
        remindedPickup: b.remindedPickup ?? false,
        remindedReturn: b.remindedReturn ?? false,
        remindedReview: b.remindedReview ?? false,
        summary: b.lineItems.map((li) => `${li.title} · return ${new Date(li.end).toISOString().slice(0,10)}${(li.returnTime === undefined ? b.returnTime : li.returnTime) ? ` at ${(li.returnTime === undefined ? b.returnTime : li.returnTime)} London time` : ""}`).join("; "),
      });
    }
    return out;
  },
});

export const markReminded = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    which: v.union(v.literal("pickup"), v.literal("return"), v.literal("review")),
  },
  handler: async (ctx, { bookingId, which }) => {
    const patch =
      which === "pickup"
        ? { remindedPickup: true }
        : which === "return"
          ? { remindedReturn: true }
          : { remindedReview: true };
    await ctx.db.patch(bookingId, patch);
  },
});

/** Full receipt data stays internal; public status reads expose only their existing fields. */
export const receiptContext = internalQuery({
  args: {bookingId:v.id("bookings")},
  handler: async (ctx,{bookingId}) => ctx.db.get(bookingId),
});

export const get = query({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      _id: b._id,
      status: b.status,
      lineItems: b.lineItems,
      subtotal: b.subtotal,
      depositAmount: b.depositAmount,
      depositHoldAmount: b.depositHoldAmount ?? 0,
      depositHoldStatus: b.depositHoldStatus ?? null,
      deliveryFee: b.deliveryFee,
      total: b.total,
      currency: b.currency,
      fulfilment: b.fulfilment,
      guestEmail: b.guestEmail,
      idVerifyStatus: b.idVerifyStatus ?? "required",
      verificationProvider: b.verificationProvider ?? "stripe",
      verificationNote: b.verificationNote ?? null,
      agreementName: b.agreementName ?? null,
      agreementSignedAt: b.agreementSignedAt ?? null,
    };
  },
});

/** Invoice/receipt payload. Authorised by the server INVOICE_SECRET (for the email
 *  attachment fetch) OR a session token whose account owns the booking (customer download). */
export const invoiceData = query({
  args: { bookingId: v.id("bookings"), token: v.optional(v.string()), key: v.optional(v.string()) },
  handler: async (ctx, { bookingId, token, key }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    let ok = false;
    if (key && process.env.INVOICE_SECRET && key === process.env.INVOICE_SECRET) {
      ok = true;
    } else if (token) {
      const s = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", token)).first();
      const acct: any = s && (s.expiresAt ?? 0) > Date.now() ? await ctx.db.get(s.accountId) : null;
      if (acct && acct.email === (b.guestEmail ?? "").trim().toLowerCase()) ok = true;
    }
    if (!ok) return null;
    const customer: any = b.customerId ? await ctx.db.get(b.customerId) : null;
    const rentalRefunds=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
    const issuedCredit=b.creditIssuedId?await ctx.db.get(b.creditIssuedId):null;
    return {
      rentalRefunds:rentalRefunds.map(r=>({amount:r.amountPence/100,status:r.status,reason:r.reason})),
      cancellationRefund:b.refundAmount??0,accountCreditIssued:issuedCredit?.amount??0,
      number: `DBC-${String(b._id).slice(-8).toUpperCase()}`,
      agreementSnapshot: readAgreementSnapshot(b.agreementSnapshot),
      acceptedAgreementEvidence: {name:b.agreementName??null,signedAt:b.agreementSignedAt??null,documents:b.agreementDocs??[]},
      issuedAt: b._creationTime,
      supplierName: process.env.BUSINESS_LEGAL_NAME || "Db Cinema Rentals",
      supplierAddress: process.env.BUSINESS_INVOICE_ADDRESS || undefined,
      status: b.status,
      customerName: customer?.name ?? null,
      email: b.guestEmail ?? null,
      fulfilment: b.fulfilment,
      address: b.address ?? null,
      currency: b.currency ?? "GBP",
      lineItems: rentalBillingLines(b),
      subtotal: b.subtotal,
      discount: b.discount ?? 0,
      deliveryFee: b.deliveryFee ?? 0,
      creditApplied: b.creditApplied ?? 0,
      membershipCreditApplied: b.membershipCreditApplied ?? 0,
      depositAmount: b.depositAmount,
      total: b.total,
      promoCode: b.promoCode ?? null,
      returnStatement: b.returnStatement ? {...b.returnStatement,rentalRefunded:b.returnStatement.rentalRefunded??confirmedRentalRefundPence(rentalRefunds)/100} : null,
    };
  },
});

export const returnStatementContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if(!b?.returnStatement)return null;
    const refundJobs=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
    return {statement:{...b.returnStatement,rentalRefunded:b.returnStatement.rentalRefunded??confirmedRentalRefundPence(refundJobs)/100},status:b.returnStatementEmailStatus??"pending"};
  },
});

export const claimReturnStatementEmail = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b?.returnStatement || b.returnStatementEmailStatus === "sent" ||
      (b.returnStatementEmailStatus === "sending" && (b.returnStatementEmailAttemptAt ?? 0) > Date.now() - 15 * 60000)) return false;
    await ctx.db.patch(bookingId, { returnStatementEmailStatus: "sending", returnStatementEmailAttemptAt: Date.now() });
    return true;
  },
});

export const markReturnStatementEmail = internalMutation({
  args: { bookingId: v.id("bookings"), sent: v.boolean() },
  handler: async (ctx, { bookingId, sent }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.returnStatementEmailStatus !== "sending") return;
    await ctx.db.patch(bookingId, { returnStatementEmailStatus: sent ? "sent" : "failed", returnStatementEmailedAt: sent ? Date.now() : undefined });
  },
});

export const dueReturnStatementEmails = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "returned")).order("desc").take(1000);
    return rows.filter((b) => b.returnStatement &&
      (["pending", "failed"].includes(b.returnStatementEmailStatus ?? "") ||
        (b.returnStatementEmailStatus === "sending" && (b.returnStatementEmailAttemptAt ?? 0) <= now - 15 * 60000)))
      .map((b) => b._id);
  },
});

export const getIdentity = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      sessionId: b.stripeIdentitySessionId ?? null,
      status: b.idVerifyStatus ?? "required",
    };
  },
});

export const verificationAccess = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const customer = b.customerId ? await ctx.db.get(b.customerId) : null;
    return { guestEmail: b.guestEmail, status: b.status, verificationProvider: b.verificationProvider,
      idVerifyStatus: b.idVerifyStatus, diditSessionId: b.diditSessionId,
      renterName: b.agreementName || customer?.name, billingAddress: b.billingAddress };
  },
});

/** Oldest checked first so a failed provider request cannot starve other rentals. */
export const diditReconcileCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const confirmed = await ctx.db.query("bookings")
      .withIndex("by_verificationProvider_status", (q) => q.eq("verificationProvider", "didit").eq("status", "confirmed")).collect();
    const active = await ctx.db.query("bookings")
      .withIndex("by_verificationProvider_status", (q) => q.eq("verificationProvider", "didit").eq("status", "active")).collect();
    return [...confirmed, ...active]
      .filter((b) => !!b.diditSessionId && !!b.guestEmail)
      .sort((a, b) => (a.diditReconciledAt ?? 0) - (b.diditReconciledAt ?? 0))
      .slice(0, 50)
      .map((b) => ({ bookingId: b._id, sessionId: b.diditSessionId!, email: b.guestEmail! }));
  },
});

export const markDiditReconciled = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string(), attemptedAt: v.number() },
  handler: async (ctx, { bookingId, sessionId, attemptedAt }) => {
    const b = await ctx.db.get(bookingId);
    if (b?.diditSessionId === sessionId)
      await ctx.db.patch(bookingId, { diditReconciledAt: attemptedAt });
  },
});

export const setIdentity = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    sessionId: v.optional(v.string()),
    status: v.string(),
  },
  handler: async (ctx, { bookingId, sessionId, status }) => {
    const prev = (await ctx.db.get(bookingId))?.idVerifyStatus ?? "required";
    const patch: any = { idVerifyStatus: status, idVerifiedAt: status === "verified" ? Date.now() : undefined, verificationExpiresAt: status === "verified" ? Date.now() + VERIFICATION_REUSE_DAYS * 86400000 : undefined };
    if (sessionId) patch.stripeIdentitySessionId = sessionId;
    await ctx.db.patch(bookingId, patch);
    if (status === "verified") await markAccountVerified(ctx, bookingId);
    else await revokeReuse(ctx, bookingId);
    await verificationUpdateMessage(ctx, bookingId, prev, status);
    if (status !== prev && ["verified", "requires_input", "canceled"].includes(status))
      await ctx.scheduler.runAfter(0, internal.notify.verificationEmail, { bookingId, status });
  },
});

/** Bind a Didit session to the paid booking before any result can be accepted. */
export const setDiditSession = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string() },
  handler: async (ctx, { bookingId, sessionId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.verificationProvider !== "didit" || !["confirmed", "active"].includes(b.status) ||
        !["required", "processing", "requires_input"].includes(b.idVerifyStatus ?? "required")) return false;
    if (b.diditSessionId !== sessionId) {
      await ctx.db.patch(bookingId, {
        diditSessionId: sessionId,
        diditEventId: undefined,
        diditEventAt: undefined,
        diditManualDecisionAt: undefined,
        diditReconciledAt: undefined,
        idVerifyStatus: "processing",
        verificationUpdatedAt: Date.now(),
      });
    }
    return true;
  },
});

/** Didit webhooks are signed in the node action. Never accept browser results. */
export const setDiditResult = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    sessionId: v.string(),
    eventId: v.string(),
    status: v.union(v.literal("processing"), v.literal("manual_review"), v.literal("verified"), v.literal("requires_input"), v.literal("rejected")),
    providerStatus: v.optional(v.string()),
    note: v.optional(v.string()),
    poaPostcodes: v.array(v.string()),
    eventAt: v.number(),
    documentExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { bookingId, sessionId, eventId, status, providerStatus, note, poaPostcodes, eventAt, documentExpiresAt }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.verificationProvider !== "didit" || b.diditSessionId !== sessionId) return false;
    if (b.diditEventId === eventId || (b.diditEventAt ?? 0) > eventAt ||
        (b.diditManualDecisionAt ?? 0) >= eventAt) return true;
    // The provider checks the bill and its holder. Also require its UK postcode
    // to match the address this renter supplied for the booking.
    const postcode = (s: string) => s.toUpperCase().match(/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/)?.[0].replace(/\s/g, "") ?? "";
    if (status === "verified" && (!postcode(b.billingAddress ?? "") || !poaPostcodes.length ||
        !poaPostcodes.every((p) => postcode(p) === postcode(b.billingAddress ?? "")))) {
      status = "manual_review";
      note = "The verified address does not match the booking address. Please contact us.";
    }
    // A deliberate admin approval can override a feature-level review. Didit
    // still sends top-level Approved with the original feature decisions; keep
    // that human decision, while allowing an actual later decline to revoke it.
    if (b.idVerificationSource === "manual" && b.idVerifyStatus === "verified" &&
        providerStatus === "Approved" && status === "manual_review") {
      await ctx.db.patch(bookingId, { diditEventId: eventId, diditEventAt: eventAt });
      return true;
    }
    if (b.idVerifyStatus === "verified" && status === "processing") {
      await ctx.db.patch(bookingId, { diditEventId: eventId, diditEventAt: eventAt });
      return true;
    }
    const previous = b.idVerifyStatus;
    const verifiedAt = status === "verified" ? (b.idVerifiedAt ?? Date.now()) : undefined;
    await ctx.db.patch(bookingId, {
      diditEventId: eventId,
      diditEventAt: eventAt,
      idVerifyStatus: status,
      idVerificationSource: "didit",
      documentExpiresAt,
      verificationExpiresAt: status === "verified" ? Math.min(verifiedAt! + VERIFICATION_REUSE_DAYS * 86400000, documentExpiresAt ?? Infinity) : undefined,
      idVerifiedAt: verifiedAt,
      verificationNote: note?.slice(0, 400),
      verificationUpdatedAt: Date.now(),
    });
    if (status === "verified") await markAccountVerified(ctx, bookingId);
    else if (["rejected", "requires_input", "manual_review"].includes(status)) await revokeReuse(ctx, bookingId);
    await verificationUpdateMessage(ctx, bookingId, previous, status);
    if (["confirmed", "active"].includes(b.status) && previous !== status && ["verified", "manual_review", "requires_input", "rejected"].includes(status))
      await ctx.scheduler.runAfter(0, internal.notify.verificationEmail, { bookingId, status });
    if (["confirmed", "active"].includes(b.status) && previous !== status && status === "manual_review")
      await ctx.scheduler.runAfter(0, internal.notify.verificationReviewAlert, { bookingId });
    return true;
  },
});

async function markAccountVerified(ctx: any, bookingId: any) {
  const b = await ctx.db.get(bookingId);
  if (!b?.guestEmail) return;
  const acct = await ctx.db
    .query("accounts")
    .withIndex("by_email", (q: any) => q.eq("email", b.guestEmail.trim().toLowerCase()))
    .first();
  if (acct) await ctx.db.patch(acct._id, { idVerified: true });
}

export const adminSetIdStatus = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), status: v.string(), note: v.string() },
  handler: async (ctx, { token, bookingId, status, note }) => {
    await assertAdmin(ctx, token, "bookings.adminSetIdStatus");
    const b = await ctx.db.get(bookingId);
    if (!b || !["confirmed", "active"].includes(b.status))
      throw new Error("Only a paid, open rental can receive a manual verification decision.");
    if (b.verificationProvider === "didit")
      throw new Error("Use the Didit review action so the provider and booking stay in sync.");
    const prev = b.idVerifyStatus ?? "required";
    if (!["verified", "requires_input", "rejected"].includes(status)) throw new Error("Invalid review decision");
    if (note.trim().length < 5) throw new Error("Record why the manual decision was made.");
    await ctx.db.patch(bookingId, {
      idVerifyStatus: status,
      idVerificationSource: "manual",
      verificationExpiresAt: status === "verified" ? Date.now() + VERIFICATION_REUSE_DAYS * 86400000 : undefined,
      idVerifiedAt: status === "verified" ? Date.now() : undefined,
      verificationUpdatedAt: Date.now(),
      verificationNote: note.trim().slice(0, 400),
    });
    if (status === "verified") await markAccountVerified(ctx, bookingId);
    else await revokeReuse(ctx, bookingId);
    await verificationUpdateMessage(ctx, bookingId, prev, status);
    if (status !== prev && ["verified", "requires_input", "canceled"].includes(status))
      await ctx.scheduler.runAfter(0, internal.notify.verificationEmail, { bookingId, status });
  },
});

/** Called only after the authenticated admin action has read and, when needed,
 * updated this exact Didit session. A signed webhook may arrive first. */
export const setDiditManualReview = internalMutation({
  args: {
    bookingId: v.id("bookings"), sessionId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("resubmit"), v.literal("decline")),
    note: v.string(),
  },
  handler: async (ctx, { bookingId, sessionId, decision, note }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.verificationProvider !== "didit" || b.diditSessionId !== sessionId ||
        !["confirmed", "active"].includes(b.status)) return false;
    const previous = b.idVerifyStatus ?? "required";
    if (decision === "approve" && !["manual_review", "rejected", "verified"].includes(previous)) return false;
    if (decision !== "approve" && !["manual_review", "rejected", "requires_input"].includes(previous)) return false;
    const status = decision === "approve" ? "verified" : decision === "resubmit" ? "requires_input" : "rejected";
    await ctx.db.patch(bookingId, {
      idVerifyStatus: status,
      idVerificationSource: "manual",
      diditManualDecisionAt: Date.now(),
      verificationExpiresAt: status === "verified" ? Date.now() + VERIFICATION_REUSE_DAYS * 86400000 : undefined,
      idVerifiedAt: status === "verified" ? Date.now() : undefined,
      verificationUpdatedAt: Date.now(),
      verificationNote: decision === "resubmit" ? "Please replace the requested verification document."
        : decision === "decline" ? "Identity and address verification was declined. Please contact us."
        : note.trim().slice(0, 400),
    });
    if (status === "verified") await markAccountVerified(ctx, bookingId);
    else await revokeReuse(ctx, bookingId);
    await verificationUpdateMessage(ctx, bookingId, previous, status);
    if (status !== previous)
      await ctx.scheduler.runAfter(0, internal.notify.verificationEmail, { bookingId, status });
    return true;
  },
});

// ── Customer self-service cancellation (Phase 3) ──────────────────
/** Read-only context the cancel action needs (ownership, amounts, window, site-only check). */
export const getForCancel = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const acct = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()))
      .first();
    const res = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    const refundJobs=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
    if(refundJobs.some(r=>r.status==="prepared"||r.status==="pending"))throw Error("A rental refund is still processing. Wait for settlement before cancellation.");
    return {
      paymentSources:await rentalPaymentSources(ctx,b),
      cancellationDecision:b.cancellationDecision??null,
      accountId: acct?._id ?? null,
      guestEmail: (b.guestEmail ?? "").trim().toLowerCase(),
      status: b.status,
      stripeCheckoutSessionId: b.stripeCheckoutSessionId ?? null,
      total: b.total,
      creditApplied: b.creditApplied ?? 0,
      membershipCreditApplied: b.membershipCreditApplied ?? 0,
      depositAmount: b.depositAmount,
      depositRefundAmount:b.depositRefundAmount??0,
      currency: b.currency ?? "GBP",
      stripePaymentIntentId: b.stripePaymentIntentId ?? null,
      stripeDepositIntentId: b.stripeDepositIntentId ?? null,
      depositHoldRenewalIntentId: b.depositHoldRenewalIntentId ?? null,
      depositHoldPreviousIntentIds: b.depositHoldPreviousIntentIds ?? [],
      cancelledAt: b.cancelledAt ?? null,
      earliestStart: b.lineItems.length ? Math.min(...b.lineItems.map((li) => li.start)) : null,
      siteOnly: res.every((r) => r.source === "site"), // never customer-cancel Hygglo-sourced rows
    };
  },
});

/** Freeze cancellation policy and order edits before any external payment call. */
export const prepareCancellation=internalMutation({args:{bookingId:v.id("bookings"),fullCreditOfferId:v.optional(v.id("rental_credit_offers"))},handler:async(ctx,{bookingId,fullCreditOfferId})=>{
 const b=await ctx.db.get(bookingId);if(b?.returnDecision)throw Error("Return settlement is in progress; finish it first");if((b?.activeAdditionId || b?.activeExtensionId))throw Error("Finish or withdraw the item addition or approved extension before cancellation");if(!b||!["confirmed","pending_payment"].includes(b.status))throw Error("Only an unstarted rental can be cancelled");
 if(!b.cancellationDecision && (["starting","processing"].includes(b.depositHoldRenewalStatus ?? "") ||
  (b.status === "confirmed" && b.depositHoldAmount && b.depositHoldStatus === "awaiting_payment"))) throw Error("Security hold setup or renewal is still processing. Please retry once it is resolved.");
 if(b.cancellationDecision){
  if(b.cancellationDecision.fullCreditOfferId !== fullCreditOfferId)throw Error("Another cancellation choice is already processing. Contact the team.");
  return b.cancellationDecision;
 }
 if(fullCreditOfferId){const offer=await ctx.db.get(fullCreditOfferId);assertCreditOffer(offer,b);if(offer?.status!=="offered")throw Error("Credit offer already settled");}
 const jobs=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
 if(jobs.some(r=>r.status==="prepared"||r.status==="pending"))throw Error("A refund is still processing");
 const kind=cancelKind(rentalCancellationStart(b),Date.now());
 const decision={kind,createdAt:Date.now(),...(fullCreditOfferId?{fullCreditOfferId}:{})};await ctx.db.patch(bookingId,{cancellationDecision:decision});return decision;
}});
export const recordCancellationQuote=internalMutation({args:{bookingId:v.id("bookings"),quote:v.object({mode:v.union(v.literal("none"),v.literal("refund"),v.literal("credit")),refundAmount:v.number(),creditAmount:v.number(),paymentIntentId:v.optional(v.string()),allocations:v.optional(v.array(v.object({paymentIntentId:v.string(),amountPence:v.number()})))})},handler:async(ctx,{bookingId,quote})=>{
 const b=await ctx.db.get(bookingId);if(!b?.cancellationDecision)throw Error("Cancellation has not been prepared");
 if(b.cancellationDecision.quote)return b.cancellationDecision.quote;
 await ctx.db.patch(bookingId,{cancellationDecision:{...b.cancellationDecision,quote}});return quote;
}});

/** Atomically finalise a cancellation: flip status, free the ledger, issue store credit if late,
 *  post a chat note, schedule the email. Idempotent (no-op if already cancelled). The Stripe
 *  refund itself is done by the action before calling this. */
export const _finalizeCancellation = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    accountId: v.optional(v.id("accounts")),
    mode: v.union(v.literal("none"), v.literal("refund"), v.literal("credit")),
    refundAmount: v.number(),
    creditAmount: v.number(),
    currency: v.string(),
    adminReason: v.optional(v.string()),
  },
  handler: async (ctx, { bookingId, accountId, mode, refundAmount, creditAmount, currency, adminReason }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return { ok: false as const };
    await stopMatchingRecovery(ctx,b.guestEmail??"",b.lineItems,bookingId);
    const membershipAccount = accountId ? await ctx.db.get(accountId) : await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",b.guestEmail??"")).first();
    if (membershipAccount?.membershipPerksPendingBookingId === bookingId)
      await ctx.db.patch(membershipAccount._id,{membershipPerksPendingBookingId:undefined});
    if (b.status === "cancelled") return { ok: true as const, already: true };

    let creditId: any = undefined;
    if (creditAmount > 0 && accountId) {
      const now = Date.now();
      const grant = b.membershipCreditGrantId ? await ctx.db.get(b.membershipCreditGrantId) : null;
      const restoredMembership = grant ? Math.min(Math.round(creditAmount * 100), Math.round((b.membershipCreditApplied ?? 0) * 100)) : 0;
      const account = await ctx.db.get(accountId);
      // Returning credit spent from a reversed membership first clears its
      // future-credit offset, rather than creating fresh unbacked credit.
      const offset = grant?.revokedPence ? Math.min(restoredMembership, account?.membershipCreditDebtPence ?? 0) : 0;
      if (offset && account) await ctx.db.patch(accountId,{membershipCreditDebtPence:(account.membershipCreditDebtPence ?? 0)-offset});
      const issue = (amountPence: number, linked: boolean, kind:"refund"|"earned"="earned", source?:any) => ctx.db.insert("credits", {
        kind,
        accountId,
        amount: amountPence / 100,
        remaining: amountPence / 100,
        currency,
        reason: `${b.cancellationDecision?.fullCreditOfferId ? "consented_full_credit" : mode === "refund" ? "restored_credit" : "late_cancellation"}:${bookingId}`,
        bookingId,
        createdAt: now,
        expiresAt: source?.expiresAt ?? now + CANCELLATION_CREDIT_DAYS * 86400000,
        status: "active",
        ...(source?.membershipGrantId ? {membershipInvoiceId:source.membershipInvoiceId,membershipGrantId:source.membershipGrantId} : linked && grant ? {membershipInvoiceId:grant.invoiceId,membershipGrantId:grant._id} : {}),
      });
      const ordinary = Math.round(creditAmount * 100)-restoredMembership;
      if (ordinary > 0){
        const oldSpent=Math.round(((b.creditApplied??0)-(b.membershipCreditApplied??0))*100);
        let restore=Math.min(ordinary,oldSpent);
        if(b.creditAllocations){
          for(const a of b.creditAllocations){
            const source=await ctx.db.get(a.creditId),take=Math.min(restore,Math.round(a.amount*100));
            if(take>0){
              const oldGrant=source?.membershipGrantId?await ctx.db.get(source.membershipGrantId):null;
              const currentAccount=await ctx.db.get(accountId),clear=oldGrant?.revokedPence?Math.min(take,currentAccount?.membershipCreditDebtPence??0):0;
              if(clear&&currentAccount)await ctx.db.patch(accountId,{membershipCreditDebtPence:(currentAccount.membershipCreditDebtPence??0)-clear});
              if(take>clear)creditId=await issue(take-clear,false,a.kind,source);
              restore-=take;
            }
          }
        }else if(restore>0){creditId=await issue(restore,false,"earned");restore=0;}
        const cash=ordinary-Math.min(ordinary,oldSpent);
        if(cash>0)creditId=await issue(cash,false,"refund");
      }
      if (restoredMembership > offset) creditId = await issue(restoredMembership-offset,!!grant && (grant.membershipRefundedPence ?? 0) < grant.paidMembershipPence);
    }
    if (b.membershipCheckoutId) {
      const member=await ctx.db.get(b.membershipCheckoutId);
      if(member && ["creating","open"].includes(member.state)) await ctx.db.patch(member._id,{state:"expired"});
    }
    await releaseReferral(ctx,b);
    await ctx.db.patch(bookingId, {
      status: "cancelled",
      cancelledAt: Date.now(),
      adminCancellationReason: adminReason,
      refundAmount,
      creditIssuedId: creditId,
      depositRefunded: b.cancellationDecision?.fullCreditOfferId ? (b.depositRefunded ?? false) : mode !== "none" ? true : (b.depositRefunded ?? false),
    });
    const res = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    for (const r of res) {
      if (r.status === "hold") await ctx.db.delete(r._id);
      else await ctx.db.patch(r._id, { status: "cancelled" });
    }
    if (accountId) {
      const note =
        mode === "credit"
          ? `Your booking was cancelled. £${refundAmount} is being returned to your card, and £${creditAmount} account credit (valid ${CANCELLATION_CREDIT_DAYS} days) has been added to your account.`
          : mode === "refund"
            ? `Your booking was cancelled. £${refundAmount} is being returned to your card.${creditAmount > 0 ? ` £${creditAmount} of previously used credit has been restored to your account for ${CANCELLATION_CREDIT_DAYS} days.` : ""}`
            : `Your booking was cancelled.`;
      await postRentalMessage(ctx,{accountId,bookingId,sender:"system",text:note});
    }
    await ctx.scheduler.runAfter(0, internal.notify.cancellationEmail, { bookingId, mode, refundAmount, creditAmount });
    await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId });
    return { ok: true as const, creditId };
  },
});

async function revokeReuse(ctx: any, sourceBookingId: any) {
  const source = await ctx.db.get(sourceBookingId);
  if (!source) return;
  const account = await ctx.db.query("accounts").withIndex("by_email", (q: any) => q.eq("email", (source.guestEmail ?? "").trim().toLowerCase())).first();
  if (account?.rentalVerification?.sourceBookingId === sourceBookingId) await ctx.db.patch(account._id, { rentalVerification: undefined, idVerified: false });
  const reused = await ctx.db.query("bookings").withIndex("by_verification_reused", (q: any) => q.eq("verificationReusedFrom", sourceBookingId)).collect();
  for (const b of reused) if (["confirmed", "active"].includes(b.status) && b.idVerifyStatus === "verified") {
    await ctx.db.patch(b._id, { idVerifyStatus: "requires_input", verificationExpiresAt: undefined, verificationReusedFrom: undefined, verificationNote: "Your previous verification changed. Please complete a new check before handover." });
    await verificationUpdateMessage(ctx, b._id, "verified", "requires_input");
  }
}
export const revokeVerificationReuse = internalMutation({ args: { sourceBookingId: v.id("bookings") }, handler: async (ctx, args) => revokeReuse(ctx, args.sourceBookingId) });
export const reuseVerificationCandidate = internalQuery({
  args: { bookingId: v.id("bookings") }, handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.status !== "confirmed" || b.verificationProvider !== "didit" || b.idVerifyStatus !== "required" || b.diditSessionId) return null;
    const account = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", (b.guestEmail ?? "").trim().toLowerCase())).first();
    if (!validReuse(account?.rentalVerification, b)) return null;
    const source = await ctx.db.get(account!.rentalVerification!.sourceBookingId);
    if (!source?.diditSessionId || source.idVerifyStatus !== "verified" || source.idVerificationSource !== "didit") return null;
    return { source };
  },
});
export const applyVerificationReuse = internalMutation({
  args: { bookingId: v.id("bookings"), sourceBookingId: v.id("bookings"), documentExpiresAt: v.number() },
  handler: async (ctx, { bookingId, sourceBookingId, documentExpiresAt }) => {
    const b = await ctx.db.get(bookingId), source = await ctx.db.get(sourceBookingId);
    if (!b || !source || b.status !== "confirmed" || b.verificationProvider !== "didit" || b.diditSessionId || b.idVerifyStatus !== "required" || source.idVerifyStatus !== "verified" || source.idVerificationSource !== "didit") return false;
    const account = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", (b.guestEmail ?? "").trim().toLowerCase())).first();
    const record = account?.rentalVerification;
    if (!record || record.sourceBookingId !== sourceBookingId || !validReuse(record, b) || documentExpiresAt <= Date.now() || documentExpiresAt <= Math.min(...b.lineItems.map(li => li.start))) return false;
    await ctx.db.patch(bookingId, { idVerifyStatus: "verified", idVerificationSource: "reused_didit", idVerifiedAt: record.verifiedAt,
      verificationExpiresAt: Math.min(record.expiresAt, documentExpiresAt), verificationReusedFrom: sourceBookingId,
      verificationNote: "Your recent identity and address verification was checked again and reused for this rental.", verificationUpdatedAt: Date.now() });
    await verificationUpdateMessage(ctx, bookingId, "required", "verified");
    return true;
  },
});
export const expireRentalVerifications = internalMutation({
  args: {}, handler: async (ctx) => {
    const rows = await ctx.db.query("bookings").withIndex("by_status", q => q.eq("status", "confirmed")).collect();
    for (const b of rows) if (b.idVerifyStatus === "verified" && b.verificationExpiresAt != null && b.verificationExpiresAt <= Date.now()) {
      await revokeReuse(ctx, b._id);
      await ctx.db.patch(b._id, { idVerifyStatus: "requires_input", diditSessionId: undefined, verificationReusedFrom: undefined,
        verificationExpiresAt: undefined, verificationNote: "Your verification expired. Complete a new check before handover." });
      await verificationUpdateMessage(ctx, b._id, "verified", "requires_input");
    }
  },
});

export const adminRequireReverification = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), note: v.string() },
  handler: async (ctx, { token, bookingId, note }) => {
    await assertAdmin(ctx, token, "bookings.adminRequireReverification");
    const b = await ctx.db.get(bookingId);
    if (!b || b.status !== "confirmed" || b.cancellationDecision || note.trim().length < 10) throw Error("An upcoming rental and a recorded reason are required.");
    if (b.verificationReusedFrom) await revokeReuse(ctx, b.verificationReusedFrom);
    await revokeReuse(ctx, bookingId);
    await ctx.db.patch(bookingId, { idVerifyStatus: "requires_input", verificationReusedFrom: undefined, verificationExpiresAt: undefined,
      diditSessionId: undefined, verificationNote: `A new check is required before handover: ${note.trim().slice(0, 300)}`, verificationUpdatedAt: Date.now() });
    await verificationUpdateMessage(ctx, bookingId, b.idVerifyStatus, "requires_input");
  },
});
