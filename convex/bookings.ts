import { queueOwnerNotification } from "./lib/adminPush";
import { authorizeAcceptedReplacementForBooking } from "./componentReplacementQuoteState";
import { assertActiveItemSwapReady, assertSwapStockReconciled, expireUnacceptedItemSwap } from "./lib/swapStockFence";
import { assertBookingClaimExecution, bookingClaimEnabled, recordBookingStockApplication, reviewOutstandingBookingClaim } from "./bookingStockClaims";
import { queueRestrictedIdentityCheck } from "./restrictedIdentityAlerts";
import { notifyRestrictedIdentityMatch, sameAccountApprovedDiditSource } from "./lib/restrictedIdentityMatch";
import { checkoutCreditSources, checkoutLineAllocation } from "../shared/checkoutLineAllocation";
import { bump } from "./rateLimit";
import {operatorCancellationCreditAllowed,operatorCancellationOptions} from "../shared/operatorCancellationCredit";
import {depositRefundProjection,depositRefundState,depositRefundStatementFields} from "../shared/depositRefundStatus";
import { depositReturnReceipt } from "./lib/depositReturnReceipt";
import { assertFirstOrderReservation, FIRST_ORDER_VOUCHER_CODE } from "./lib/firstOrderVoucher";
import { securityReturnPlan } from "./lib/rentalPaymentPlan";
import { rentalControlsSnapshot } from "./lib/rentalControlsSnapshot";
import { queueRentalEmail } from "./lib/rentalEmailQueue";
import {assertRentalAllocation} from "./lib/rentalAllocation";
import { bookingStockLines, rentalWindow } from "../shared/rentalWindow";
import { stockTimePrecision, stockWindow } from "./lib/stockWindows";
import { CHECKOUT_CARD_HOLD_POLICY, CHECKOUT_HOLD_POLICY, PICKUP_HOLD_RENEWAL_LEAD_MS, isCheckoutHoldPolicy, isPickupHoldPolicyVersion } from "../shared/pickupSecurity";
import { availableCreditRows,creditPlan,creditKind,checkoutCreditSpentPence,checkoutMembershipCreditSpentPence,reconcileReleasedCredit } from "./lib/checkoutCredit";
import { ensurePaidBookingAccount } from "./accountClaims";
import { referralEligibility,availableReferralReward } from "./lib/referrals";
import { CREDIT_FUNDING_VERSION, SINGLE_BENEFIT_VERSION } from "../shared/rentalBenefits";
import { ASSESSMENT_SECURITY_POLICY_VERSION, assessmentDepositFor, cardHoldFor, cardLimitForPolicy, CARD_HOLD_SECURITY_POLICY_VERSION, hasCashDepositPolicy, isCardHoldSecurityPolicy, SECURITY_POLICY_VERSION, REFUNDABLE_DEPOSIT_POLICY_VERSION, refundableDepositFor, depositChargeFor, savedCardChargeLimit, isSetupIntentSecurityPolicy, isImmediateClaimSecurityPolicy } from "../shared/rentalSecurity";
import { isSavedCardRental, assessmentConsentText, savedCardConsentText, assertSavedCardConsent, setupIntentConsentText, immediateClaimConsentText } from "../shared/savedCardSecurity";
import { loyaltyProgress } from "./lib/loyalty";
import { creditDebit,usableCredit } from "./lib/creditLedger";
import { releaseRentalCredit,restoreRentalCredit } from "./lib/rentalCreditFunding";
import { reviewContext } from "./lib/reviewContext";
import { studioDeliveryAvailable, londonMonth } from "./lib/memberDelivery";
import { hasFirstEligibleRentalConfirmation, membershipActiveNow } from "../shared/membership";
import { membershipRentalBenefitAccount } from "./lib/rentalBenefitAccount";
import { checkoutMembershipCredit, membershipSignupOffer } from "../shared/checkoutMembershipCredit";
import { tierByKey } from "./lib/membership";
import { checkoutAccessoryLineAllocation } from "../shared/checkoutAccessoryAllocation";
import { CHECKOUT_ACCESSORY_OFFER_LIMIT, checkoutAccessoryPercent, checkoutAccessoryTotals } from "../shared/checkoutAccessoryOffer";
import { stopMatchingRecovery, linkMatchingRecovery } from "./lib/checkoutRecovery";
import { rentalBillingLines } from "./lib/rentalBillingLines";
import { isLegacyStripeIdentity } from "../shared/identityProvider";
import { assertRenterExposure, renterExposure, replacementValues, attachRenterPerson } from "./lib/rentalExposure";
import { securityReady, verificationCanStart, verificationSessionCanOpen, verificationBookingOpen, diditSessionRefreshAllowed, renterVerificationNote, bookingVerificationExpired, verificationExpired, verificationValidUntil, verificationDeadlineAt, verificationWindowClosed, diditApprovalWithinVerificationWindow } from "../shared/verificationProgress";
import { assertDroneApproval, requiresDroneLicence, droneLicenceStatusForRental } from "./lib/droneVerification";
import { queueVerificationArchive, assertVerificationArchive } from "./verificationArchive";
import { adminSessionMigrationReady, assertAdminScopeSession } from "./adminAccountSessionV2";
import { retainVerificationArchiveLink } from "./lib/verificationArchiveLink";
import { bumpVerificationRetentionRevision } from "./lib/verificationRetentionRevision";
import { listingImages, listingRentalImages } from "./lib/catalogImages";
import { rentalRefundReference } from "../shared/rentalRefundReference";
import { accountForToken, ownedBooking } from "./lib/rentalChat";
import { assertRentalInventory, assertPhysicalRentalInventory, rentalInventoryDemands, type RentalInventoryCache } from "./lib/rentalInventory";
import { storedBookingComponents } from "./lib/bookingComponentAllocation";
import { CART_STOCK_SYNC_MAX_AGE_MS, isSharedStockSnapshotFresh } from "./lib/shared_stock_sync";
import { reservationPaymentUnresolved } from "./lib/reservationPayment";
import { confirmedRentalRefundPence } from "./lib/rentalPaymentPlan";
import { bookingRentalCollectedPence, rentalRefundAccounting } from "./lib/rentalRevenue";
import { rentalPaymentSources,rentalCreditSources } from "./lib/rentalPaymentSources";
import { postRentalMessage } from "./lib/rentalChat";
import { hasBookingDiditApproval, renterHandoverDetailsReady } from "./lib/renterRentalActionGate";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { belongsToRentalAccount, accountForRental } from "./lib/rentalAccount";
import { cleanRentalCompletionAt } from "./lib/membershipTrialActivation";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { approvedRequest, startRequest, finishRequest, cancellationRequestKey } from "./lib/rentalRequestExecution";
import { RENTAL_REQUEST_HISTORY_LIMIT, summarizeRentalRequests } from "./lib/rentalRequestStatus";
import { inspectionInput } from "./lib/returnInspectionFields";
import { returnInspectionSchedule } from "./lib/returnInspection";
import { archiveCaseConversation, bookingHasCaseArchive } from "./lib/chatCaseArchive";
import { CHAT_ATTACHMENT_LIMIT, isChatImageType } from "../shared/chatAttachmentPolicy";
import { RETURN_EVIDENCE_LINK_TTL_MS, returnEvidenceRecipientHash } from "../shared/returnEvidenceLink";
import { isRejectedPendingDiditBooking } from "./lib/paidCheckoutReceipt";
import { checkoutCreditFullyCoversDue, strictDepositWaiverReason, checkoutWaiverReason } from "./lib/strictDepositWaiver";
import { normalizeReturnInspection, sameReturnInspection } from "../shared/returnInspection";
import { lateFeeQuote } from "./lib/lateFee";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { VERIFICATION_REUSE_DAYS, validReuse, verificationDetail, verificationUpdateMessage, saveAccountDiditVerification, verificationReuseOwnerMatches } from "./lib/verificationReuse";
import { assertCreditOffer } from "./lib/rentalCreditPolicy";
import { rentalCancellationStart, bookingCancelKind,cancellationTimingBasis,CANCELLATION_CREDIT_DAYS,isNoRefundWithin48HoursCancellationVersion } from "../src/lib/cancellationPolicy";
import { LEGAL_VERSION, REFUNDABLE_DEPOSIT_LEGAL_VERSION, ASSESSMENT_DEPOSIT_LEGAL_VERSION, CANCELLATION_PROTECTION_LEGAL_VERSION, CARD_HOLD_LEGAL_VERSION, SETUP_INTENT_LEGAL_VERSION, SETUP_INTENT_LEGAL_VERSIONS, IMMEDIATE_CLAIM_LEGAL_VERSION, IMMEDIATE_CLAIM_LEGAL_VERSIONS } from "../src/lib/legal";
import { assertAgreementBeforeRelease, snapshotAgreement, readAgreementSnapshot, agreementRequestFingerprint as fingerprintAgreement } from "../shared/rentalAgreement";


/** Only an attested Stripe create rejection may release an unbound checkout.
 * Network/unknown responses remain pending for provider reconciliation. */
export const checkoutCreationRejected=internalMutation({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
 const b=await ctx.db.get(bookingId);if(!b||b.status!=="pending_payment"||b.stripeCheckoutSessionId||b.stripePaymentIntentId)return;
 await releaseReferral(ctx,b);
 await ctx.db.patch(b._id,{status:"cancelled",cancelledAt:Date.now()});
 await bumpVerificationRetentionRevision(ctx,b);
 await reconcileReleasedCredit(ctx,b);
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
  pickupTime:v.optional(v.union(v.string(),v.null())),
  returnTime:v.optional(v.union(v.string(),v.null())),
  checkoutAccessoryOffer:v.optional(v.boolean()),
  checkoutAccessoryOfferPercent:v.optional(v.number()),
  checkoutAccessoryOfferOriginalTotal:v.optional(v.number()),
  checkoutAccessoryOfferSaving:v.optional(v.number()),
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
  const reserved = pending.filter((b: any) => b.status === "pending_payment" || b.status === "pending_verification" && b.checkoutCreditState !== "spent" && !b.paidConfirmedAt)
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

/** Private lookup for an exact submitted checkout retry. No new booking,
 * stock or credit is created, and older attempts without this receipt keep
 * their existing reconciliation path. */
/** A saved Stripe URL is usable only while its exact stock allocation is still valid. */
async function checkoutStockReady(ctx: any, booking: any) {
  if(!booking || booking.status !== "pending_payment" || !booking.stockHoldFingerprint) return false;
  const holds = await ctx.db.query("reservations").withIndex("by_booking", (q: any)=>q.eq("bookingId",booking._id)).collect();
  const now=Date.now();
  if(!holds.length || holds.some((h:any)=>h.status!=="hold" || !h.holdExpiresAt || h.holdExpiresAt<=now)) return false;
  if(stockAllocationFingerprint(booking,holds)!==booking.stockHoldFingerprint) return false;
  try {await assertRentalInventory(ctx,bookingStockLines(booking),booking._id);return true;} catch {return false;}
}
export const assertCheckoutReservation = internalQuery({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
  if(!await checkoutStockReady(ctx,await ctx.db.get(bookingId))) throw Error("This checkout no longer has available stock. Return to your basket and choose available equipment before paying.");
  return true;
}});
/** The unpredictable acceptance ID is a recovery capability; disclose no booking particulars. */
export const recoveryStock = query({args:{requestId:v.string(),token:v.optional(v.string())},handler:async(ctx,a)=>{
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(a.requestId))return {ready:false};
  const b=await ctx.db.query("bookings").withIndex("by_agreement_request",q=>q.eq("agreementRequestId",a.requestId)).unique();
  if(a.token){const account=await accountForToken(ctx,a.token);if(!account || !b || b.accountId!==account._id)return {ready:false};}
  return {ready:await checkoutStockReady(ctx,b)};
}});

export const checkoutAttempt = internalQuery({
  args:{requestId:v.string(),checkoutInputFingerprint:v.string()},
  handler:async(ctx,a)=>{
    const b=await ctx.db.query("bookings").withIndex("by_agreement_request",q=>q.eq("agreementRequestId",a.requestId)).unique();
    if(!b?.checkoutInputFingerprint)return null;
    if(b.status!=="pending_payment")throw new ConvexError({code:"CHECKOUT_CLOSED",message:"This checkout has completed or closed. Open your existing booking, or refresh checkout and review a new attempt."});
    return {bookingId:b._id,sessionId:b.stripeCheckoutSessionId,membershipCheckoutId:b.membershipCheckoutId,
      securityWaiverReason:b.securityWaiverReason,fingerprintMatches:b.checkoutInputFingerprint===a.checkoutInputFingerprint};
  },
});

export const depositWaiverEligibility = internalQuery({
  args: {
    accountId: v.id("accounts"), replacementValuePence: v.number(), starts: v.array(v.number()),
    agreementName: v.optional(v.string()), billingAddress: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, replacementValuePence, starts, agreementName, billingAddress }) =>
    strictDepositWaiverReason(ctx, await ctx.db.get(accountId), replacementValuePence, starts, agreementName, billingAddress),
});

/** Re-check the exact waiver basis captured by a pending booking before an
 * unpaid Checkout URL is reused. Existing completed payments use their saved
 * agreement and never pass through this query. */
export const currentCheckoutWaiver = internalQuery({
  args:{bookingId:v.id("bookings")},
  handler:async(ctx,{bookingId})=>{
    const booking=await ctx.db.get(bookingId);
    if(!booking||booking.membershipCheckoutId||!(booking.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION||isCardHoldSecurityPolicy(booking.securityPolicyVersion)))return undefined;
    const values=booking.replacementValues;
    if(!Array.isArray(values)||!Array.isArray(booking.lineItems)||!booking.lineItems.length)return undefined;
    const valuePence=booking.lineItems.reduce((sum:number,line:any)=>{
      const value=values.find((row:any)=>row.listingId===line.listingId)?.unitPence;
      return typeof value==="number"&&Number.isSafeInteger(value)&&Number.isSafeInteger(line.qty)&&line.qty>0?sum+value*line.qty:NaN;
    },0);
    if(!Number.isSafeInteger(valuePence)||valuePence<=0)return undefined;
    const account=booking.accountId?await ctx.db.get(booking.accountId):null;
    return strictDepositWaiverReason(ctx,account,valuePence,booking.lineItems.map((line:any)=>line.start),booking.agreementName,booking.billingAddress);
  },
});

export const createPending = internalMutation({
  args: {
    pricingVersion:v.optional(v.string()),benefitKind:v.optional(v.string()),useAccountCredit:v.optional(v.boolean()),
    refundCreditApplied:v.optional(v.number()),earnedCreditApplied:v.optional(v.number()),
    referralCode:v.optional(v.string()),referralRewardId:v.optional(v.id("referral_rewards")),
    customerEmail: v.string(),
    customerName: v.optional(v.string()),
    phone: v.optional(v.string()),
    fulfilment: v.union(v.literal("pickup"), v.literal("delivery")),
    deliveryLegs: v.optional(v.union(v.literal("one_way"), v.literal("round_trip"))),
    address: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    deliveryFee: v.number(),
    sameDayFee: v.optional(v.number()),
    lineItems: v.array(lineItem),
    subtotal: v.number(),
    depositAmount: v.number(),
    depositHoldAmount: v.optional(v.number()),
    securityPolicyVersion: v.optional(v.string()),
    cancellationProtectionEnabled:v.optional(v.boolean()),
    savedCardLimit: v.optional(v.number()),
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
    expectedCheckoutAmountPence:v.optional(v.number()),
    membershipCheckoutId: v.optional(v.id("membership_checkouts")),
    accountAccessRequired: v.optional(v.boolean()),
    accountId: v.optional(v.id("accounts")),
    repeatSourceBookingId: v.optional(v.id("bookings")),
    repeatSourceFingerprint: v.optional(v.string()),
    currency: v.string(),
    agreementName: v.optional(v.string()),
    agreementRequestId: v.optional(v.string()),
    checkoutInputFingerprint: v.optional(v.string()),
    securityHoldConsent: v.optional(v.boolean()),
    laterChargeConsent: v.optional(v.boolean()),
    deliveryAccepted: v.optional(v.boolean()),
    agreementDocs: v.optional(
      v.array(v.object({ kind: v.string(), version: v.string() })),
    ),
    protection: v.optional(v.string()),
    idVerifyStatus: v.optional(v.literal("required")),
    verificationProvider: v.optional(v.literal("didit")),
    pickupTime: v.optional(v.string()),
    returnTime: v.optional(v.string()),
    replacementQuoteProof: v.optional(v.object({ quoteId: v.id("component_replacement_quotes"), pricingDigest: v.string(), guestOwnerDigest: v.optional(v.string()) })),
  },
  handler: async (ctx, a) => {
    if (a.replacementQuoteProof) {
      const transactionAllocation = await authorizeAcceptedReplacementForBooking(ctx, a.replacementQuoteProof, a);
      const draft = { customerEmail: a.customerEmail, accountId: a.accountId, status: "pending_payment", lineItems: a.lineItems };
      await assertRenterExposure(ctx, draft, a.lineItems, undefined, transactionAllocation);
      if (new Set(a.lineItems.map(line => String(line.listingId))).size !== a.lineItems.length) throw Error("This replacement basket needs a team check.");
      const values = await replacementValues(ctx, draft, a.lineItems, transactionAllocation);
      const equipmentValuePence = a.lineItems.reduce((sum, line) => sum + (values.find(value => value.listingId === line.listingId)?.unitPence ?? NaN) * line.qty, 0);
      if (!Number.isSafeInteger(equipmentValuePence) || Math.round(cardLimitForPolicy(a.securityPolicyVersion, equipmentValuePence / 100) * 100) !== Math.round((a.savedCardLimit ?? NaN) * 100)) throw Error("The replacement security value changed. Review it again.");
      const customerAccount = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", a.customerEmail.trim().toLowerCase())).first();
      const expectedWaiver = await checkoutWaiverReason(ctx, a, equipmentValuePence, customerAccount);
      if (a.securityWaiverReason !== expectedWaiver) throw Error("Your deposit eligibility changed; review checkout before paying.");
      throw Error("Component substitutions are not available at checkout.");
    }
    if (a.lineItems.some(line => Object.prototype.hasOwnProperty.call(line, "componentReplacement")))
      throw Error("Component substitutions are not available at checkout.");
    if(a.fulfilment === "pickup" && a.deliveryLegs !== undefined)throw Error("Pickup bookings cannot include a delivery option.");
    let previousAttempt:any=null;
    if(a.accountId){
      const owner=await ctx.db.get(a.accountId);
      if(!owner||owner.blockedAt!=null||owner.email!==a.customerEmail.trim().toLowerCase())throw Error("Rental account does not match the checkout customer.");
    }
    if(a.checkoutInputFingerprint&&!/^[a-f0-9]{64}$/.test(a.checkoutInputFingerprint))throw Error("Invalid checkout receipt.");
    const newAgreement = a.agreementDocs?.some(d => [LEGAL_VERSION,REFUNDABLE_DEPOSIT_LEGAL_VERSION,ASSESSMENT_DEPOSIT_LEGAL_VERSION,CANCELLATION_PROTECTION_LEGAL_VERSION,CARD_HOLD_LEGAL_VERSION,...SETUP_INTENT_LEGAL_VERSIONS,...IMMEDIATE_CLAIM_LEGAL_VERSIONS].includes(d.version));
    if ((hasCashDepositPolicy(a.securityPolicyVersion) || isCardHoldSecurityPolicy(a.securityPolicyVersion) || isSetupIntentSecurityPolicy(a.securityPolicyVersion)) && !newAgreement) throw Error("Review and accept the current security agreements before paying.");
    const agreementRequestFingerprint = a.agreementRequestId ? fingerprintAgreement(a) : undefined;
    if (newAgreement && !a.agreementRequestId) throw Error("An agreement acceptance attempt is required.");
    if (a.agreementRequestId) {
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(a.agreementRequestId)) throw Error("Invalid acceptance attempt.");
      const previous = await ctx.db.query("bookings").withIndex("by_agreement_request", q => q.eq("agreementRequestId", a.agreementRequestId)).unique();
      if (previous) {
        if (previous.status !== "pending_payment") throw Error("This acceptance attempt has already completed or closed. Use the existing booking.");
        previousAttempt=previous;
        if (previous.agreementRequestFingerprint !== agreementRequestFingerprint)
          return {bookingId:previous._id,creditApplied:previous.creditApplied??0,reused:true,staleCheckout:true,sessionId:previous.stripeCheckoutSessionId};
      }
    }
    if(a.securityPolicyVersion===REFUNDABLE_DEPOSIT_POLICY_VERSION && a.securityWaiverReason)throw Error("The refundable deposit cannot be waived by membership or a prior rental.");
    if(a.securityPolicyVersion && a.securityPolicyVersion!==SECURITY_POLICY_VERSION && !(a.securityPolicyVersion===REFUNDABLE_DEPOSIT_POLICY_VERSION && process.env.REFUNDABLE_DEPOSIT_POLICY_ENABLED==="true") && !(a.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION && process.env.ASSESSMENT_SECURITY_POLICY_ENABLED==="true") && !(a.securityPolicyVersion===CARD_HOLD_SECURITY_POLICY_VERSION && process.env.CARD_HOLD_SECURITY_POLICY_ENABLED==="true") && !(isSetupIntentSecurityPolicy(a.securityPolicyVersion) && process.env.SETUP_INTENT_SECURITY_POLICY_ENABLED==="true"))throw Error("Unsupported security policy.");
    if(a.cancellationProtectionEnabled && (process.env.CANCELLATION_PROTECTION_POLICY_ENABLED!=="true"||a.securityPolicyVersion!==ASSESSMENT_SECURITY_POLICY_VERSION))throw Error("The cancellation protection policy is not enabled.");
    const creditFunding=a.pricingVersion===CREDIT_FUNDING_VERSION;
    const single=a.pricingVersion===SINGLE_BENEFIT_VERSION||creditFunding;
    if(a.pricingVersion&&!single)throw Error("Unsupported pricing version.");
    const account=a.creditAccountId?await ctx.db.get(a.creditAccountId):null;
    const accessoryOfferIndexes=a.lineItems.flatMap((line,index)=>line.checkoutAccessoryOffer?[index]:[]);
    if(accessoryOfferIndexes.length>CHECKOUT_ACCESSORY_OFFER_LIMIT)throw Error("Choose up to three checkout accessories.");
    const discountEligibleSubtotal=Math.round(a.lineItems.reduce((sum,line)=>sum+(line.checkoutAccessoryOffer?0:line.lineTotal),0)*100)/100;
    const accessoryOfferPercent=accessoryOfferIndexes.length?checkoutAccessoryPercent(discountEligibleSubtotal):null;
    if(accessoryOfferIndexes.length&&accessoryOfferPercent===null)throw Error("Checkout accessories need at least £150 of compatible equipment in your basket.");
    for(const line of a.lineItems){
      if(!line.checkoutAccessoryOffer){
        if(line.checkoutAccessoryOfferPercent!==undefined||line.checkoutAccessoryOfferOriginalTotal!==undefined||line.checkoutAccessoryOfferSaving!==undefined)
          throw Error("Invalid checkout accessory offer details.");
        continue;
      }
      if(line.checkoutAccessoryOfferPercent!==accessoryOfferPercent||line.checkoutAccessoryOfferOriginalTotal===undefined||line.checkoutAccessoryOfferSaving===undefined)
        throw Error("The checkout accessory offer changed. Review the updated basket before paying.");
      const computed=checkoutAccessoryTotals(line.checkoutAccessoryOfferOriginalTotal,accessoryOfferPercent!);
      if(Math.round(computed.total*100)!==Math.round(line.lineTotal*100)||Math.round(computed.saving*100)!==Math.round(line.checkoutAccessoryOfferSaving*100))
        throw Error("The checkout accessory offer changed. Review the updated basket before paying.");
    }
    let friend:any=null,reward:any=null;
    if(single){
      if(!creditFunding&&(a.earnedCreditApplied??0)>0&&a.benefitKind!=="earned_credit")throw Error("Earned credit cannot stack with another benefit.");
      if(a.benefitKind==="earned_credit"&&((a.discount??0)!==(a.membershipSignupOfferSaving??0)||a.deliveryFee!==(a.quotedDeliveryFee??a.deliveryFee)))throw Error("Only one price benefit can apply, plus the one-time joining credit.");
      if(["referral_friend","referral_reward"].includes(a.benefitKind??"")){
        const cardHoldPolicy=isCardHoldSecurityPolicy(a.securityPolicyVersion),setupIntentPolicy=isSetupIntentSecurityPolicy(a.securityPolicyVersion);
        const value = isSavedCardRental(a) || cardHoldPolicy ? (await Promise.all(a.lineItems.map(line=>ctx.db.get(line.listingId)))).reduce((n,item,i)=>n+(item?.depositAmount??0)*a.lineItems[i].qty,0) : undefined;
        const normalDeposit = setupIntentPolicy||cardHoldPolicy?0:a.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION && value !== undefined ? a.securityWaiverReason?0:assessmentDepositFor(value) : hasCashDepositPolicy(a.securityPolicyVersion) && value !== undefined ? refundableDepositFor(value) : value === undefined ? Math.round((a.depositHoldAmount??0)*50)/100 : depositChargeFor(a.protection === "deposit" ? "deposit" : "verify",value);
        const normalHold=cardHoldPolicy&&value!==undefined?(a.securityWaiverReason?0:cardHoldFor(value)):undefined;
        if((a.securityPolicyVersion!==ASSESSMENT_SECURITY_POLICY_VERSION&&!cardHoldPolicy&&a.securityWaiverReason)||a.depositAmount!==normalDeposit||(normalHold!==undefined&&a.depositHoldAmount!==normalHold))throw Error("Referral offers require normal upfront security.");
        if(a.benefitKind==="referral_friend"){
          friend=await referralEligibility(ctx,account,a.referralCode??"");if(!friend.valid)throw Error(friend.reason);
          if(Math.round(((a.discount??0)-(a.membershipSignupOfferSaving??0))*100)!==Math.round(Math.min(10,discountEligibleSubtotal)*100))throw Error("Referral price changed.");
        }else{
          reward=await availableReferralReward(ctx,account);
          if(!reward||reward._id!==a.referralRewardId||Math.round(((a.discount??0)-(a.membershipSignupOfferSaving??0))*100)!==Math.round(discountEligibleSubtotal*40))throw Error("Your referral reward is no longer available.");
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
    if (a.promoCode?.toLowerCase() === FIRST_ORDER_VOUCHER_CODE && (!a.accountId || a.accountId !== customerAccount?._id))
      throw Error("Sign in to use your first-order voucher.");
    await assertFirstOrderReservation(ctx, customerAccount, a.promoCode);
    if (a.promoCode?.toLowerCase() === FIRST_ORDER_VOUCHER_CODE &&
      ((a.membershipSignupOfferSaving ?? 0) !== 0 || (!creditFunding && ((a.membershipCreditApplied ?? 0) !== 0 || (a.earnedCreditApplied ?? 0) !== 0)) ||
       (a.weekendSaving ?? 0) !== 0 || (a.loyaltySaving ?? 0) !== 0 || a.deliveryBenefitMonth || (a.benefitKind && a.benefitKind !== "promo") || a.referralCode || a.referralRewardId ||
       Math.round((a.discount ?? 0) * 100) > Math.round(discountEligibleSubtotal * 10)))
      throw Error("DB10OFF cannot stack with other discounts or earned-credit benefits.");
    if (a.deliveryBenefitMonth) {
      const account = a.creditAccountId ? await ctx.db.get(a.creditAccountId) : null;
      if (a.deliveryBenefitMonth !== londonMonth() || a.fulfilment !== "delivery" || a.deliveryFee !== 0 || !await studioDeliveryAvailable(ctx, account, a.deliveryBenefitMonth, !!(a.membershipCheckoutId && (await ctx.db.get(a.membershipCheckoutId))?.tier === "studio")))
        throw Error("Your included London delivery has already been reserved. Review the updated total before paying.");
    }
    let membershipFeePence=0;
    if (a.membershipCheckoutId) {
      const checkout = await ctx.db.get(a.membershipCheckoutId);
      if (!checkout || checkout.accountId !== a.creditAccountId || checkout.state !== "creating" || checkout.expiresAt <= Date.now()) throw Error("Membership checkout reservation expired.");
      if (a.securityWaiverReason === "new_paid_membership") throw Error("Membership added at checkout cannot waive this rental’s security payment.");
      const tier=tierByKey(checkout.tier);
      if(!tier)throw Error("Membership plan changed. Refresh checkout before paying.");
      membershipFeePence=checkout.intro==="trial"?0:Math.round(tier.monthlyGbp*100);
    } else if (a.securityWaiverReason === "new_paid_membership") throw Error("A paid membership checkout is required for this security benefit.");
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

    let swapBenefitRule: {version:"encore-percent-v1";percent:number}|undefined;
    if ((a.loyaltySaving ?? 0) > 0) {
      const loyaltyAccount = a.creditAccountId ? await ctx.db.get(a.creditAccountId) : null;
      const progress = loyaltyAccount ? await loyaltyProgress(ctx,loyaltyAccount) : null;
      const benefitAccount = loyaltyAccount ? await membershipRentalBenefitAccount(ctx,loyaltyAccount) : null;
      const assignedEncoreLevel = loyaltyAccount?.adminEncoreLevel;
      const hasAssignedEncore = assignedEncoreLevel === 1 || assignedEncoreLevel === 2 || assignedEncoreLevel === 3;
      if (!loyaltyAccount || !progress?.eligible || loyaltyAccount.blockedAt != null ||
          (!hasAssignedEncore && !hasFirstEligibleRentalConfirmation(benefitAccount)))
        throw Error("Your Encore benefit changed. Review the updated rental total.");
      const expectedLoyalty = single ? Math.round(discountEligibleSubtotal*progress.percent)/100 : Math.round((discountEligibleSubtotal-(a.discount??0)+a.loyaltySaving!)*10)/100;
      if (Math.round(expectedLoyalty*100) !== Math.round(a.loyaltySaving!*100)) throw Error("Your Encore rental saving changed.");
      if (single && a.benefitKind === "loyalty" && !(a.membershipSignupOfferSaving ?? 0) && Math.round((a.discount ?? 0) * 100) === Math.round(a.loyaltySaving! * 100))
        swapBenefitRule = {version:"encore-percent-v1",percent:progress.percent};
    }
    // ── store-credit reservation (transactional, double-spend-safe) ──
    // Cap to the account's available balance MINUS credit already reserved by its other pending
    // checkouts, so two concurrent checkouts can't both spend the same credit (each serializable
    // mutation sees the other's reservation). An aborted/deleted pending booking releases its
    // reservation automatically; the actual decrement still happens on confirm.
    let allocations:any[]|undefined;
    let creditApplied = 0;
    if(single){
      if(a.useAccountCredit===false&&((a.refundCreditApplied??0)>0||(a.earnedCreditApplied??0)>0))throw Error("Account credit was not selected for this checkout.");
      const refund=a.refundCreditApplied??0,earned=a.earnedCreditApplied??0;
      const creditPence=[refund,earned].map(value=>Math.round(value*100));
      if(![refund,earned].every(n=>Number.isFinite(n)&&n>=0)||!creditPence.every(Number.isSafeInteger)||creditPence[0]+creditPence[1]>Math.round(a.total*100)-Math.round(a.depositAmount*100))throw Error("Invalid credit allocation.");
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
      const expectedOffer = Math.min(membershipSignupOffer(checkout.tier,checkout.intro,discountEligibleSubtotal+(a.quotedDeliveryFee??a.deliveryFee),!!(account?.membershipSignupOfferUsed || account?.starterRentalOfferUsed)),Math.max(0,discountEligibleSubtotal-primaryReduction));
      if ((a.membershipSignupOfferSaving ?? 0) !== expectedOffer) throw Error("Your Membership welcome offer changed. Review the updated total before paying.");
      const immediate = checkoutMembershipCredit(checkout.tier, checkout.intro,
        Math.round(Math.max(0, a.subtotal - (a.discount ?? 0) - creditApplied) * 100), account?.membershipCreditDebtPence);
      membershipCreditApplied = single&&!creditFunding&&a.benefitKind!=="earned_credit"?0:immediate.appliedPence / 100;
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
    const checkoutExpectedAmountPence=Math.round(chargedTotal*100)+membershipFeePence;
    if(a.expectedCheckoutAmountPence!==undefined&&a.expectedCheckoutAmountPence!==checkoutExpectedAmountPence)
      throw new Error("The Stripe checkout amount changed. Review the updated total before paying.");

    const exposure = await assertRenterExposure(ctx, { customerEmail, status: "pending_payment", lineItems: a.lineItems });
    const values = await replacementValues(ctx, { lineItems: a.lineItems });
    const savedCard = isSavedCardRental(a);
    const cardHoldPolicy=isCardHoldSecurityPolicy(a.securityPolicyVersion);
    const setupIntentPolicy=isSetupIntentSecurityPolicy(a.securityPolicyVersion);
    const assessmentPolicy=a.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION;
    const refundablePolicy = hasCashDepositPolicy(a.securityPolicyVersion);
    const equipmentValue = a.lineItems.reduce((n,line)=>n+(values.find(value=>value.listingId===line.listingId)?.unitPence??0)*line.qty/100,0);
    const cardLimit = savedCard ? cardLimitForPolicy(a.securityPolicyVersion,equipmentValue) : undefined;
    if (a.securityWaiverReason && !["active_membership", "encore"].includes(a.securityWaiverReason))
      throw Error("This deposit exemption is no longer available.");
    if (!assessmentPolicy && !cardHoldPolicy && a.securityWaiverReason)
      throw Error("This checkout does not support a deposit exemption.");
    const waiverPolicy=assessmentPolicy||cardHoldPolicy;
    const expectedWaiverReason=await checkoutWaiverReason(ctx,a,Math.round(equipmentValue*100),customerAccount);
    if(previousAttempt){
      const staleWaiver=previousAttempt.securityWaiverReason!==expectedWaiverReason || a.securityWaiverReason!==expectedWaiverReason;
      if(staleWaiver)return {bookingId:previousAttempt._id,creditApplied:previousAttempt.creditApplied??0,reused:true,staleCheckout:true,sessionId:previousAttempt.stripeCheckoutSessionId};
      if(!previousAttempt.stripeCheckoutSessionId)throw Error("This checkout is still pending reconciliation. Do not submit a second acceptance or payment.");
      return {bookingId:previousAttempt._id,creditApplied:previousAttempt.creditApplied??0,reused:true,sessionId:previousAttempt.stripeCheckoutSessionId};
    }
    if(waiverPolicy&&a.securityWaiverReason!==expectedWaiverReason)
      throw Error("Your deposit eligibility changed; review checkout before paying.");
    const waiverValid=!!expectedWaiverReason;
    const requiredDeposit=setupIntentPolicy||cardHoldPolicy?0:assessmentPolicy?(waiverValid?0:assessmentDepositFor(equipmentValue)):refundablePolicy?refundableDepositFor(equipmentValue):0;
    const requiredHold=cardHoldPolicy?(waiverValid?0:cardHoldFor(equipmentValue)):undefined;
    if(assessmentPolicy&&a.depositAmount!==requiredDeposit)
      throw Error("The refundable deposit changed. Review the current amount before paying.");
    if(cardHoldPolicy&&(a.depositAmount!==0||(a.depositHoldAmount??0)!==requiredHold||a.savedCardLimit!==0))
      throw Error("The card authorisation amount changed. Review the hold and accept the current agreement before paying.");
    if (savedCard && (a.depositAmount !== requiredDeposit || (refundablePolicy && !assessmentPolicy && !!a.securityWaiverReason) || (a.depositHoldAmount ?? 0) !== 0 || a.savedCardLimit !== cardLimit || !a.laterChargeConsent))
      throw Error("Review the current saved-card limit and explicitly consent; review the quoted refundable deposit and no additional card hold is permitted.");
    const acceptedAt = Date.now();
    const cardConsent = setupIntentPolicy&&cardLimit!==undefined?(isImmediateClaimSecurityPolicy(a.securityPolicyVersion)?immediateClaimConsentText(cardLimit):setupIntentConsentText(cardLimit)):assessmentPolicy?assessmentConsentText(a.depositAmount):cardLimit !== undefined ? savedCardConsentText(cardLimit,refundablePolicy?a.depositAmount:undefined) : undefined;
    const agreementSnapshot = newAgreement ? snapshotAgreement({...a,savedCardConsentText:cardConsent}, acceptedAt, chargedTotal, creditApplied) : undefined;
    const checkoutFunding = accessoryOfferIndexes.length
      ? checkoutAccessoryLineAllocation(a.lineItems.map(line=>line.lineTotal),accessoryOfferIndexes,[a.deliveryFee],a.discount??0,membershipCreditApplied,creditApplied-membershipCreditApplied,a.sameDayFee?[a.sameDayFee]:[])
      : checkoutLineAllocation(a.lineItems.map(line=>line.lineTotal),[a.deliveryFee],a.discount??0,membershipCreditApplied,creditApplied-membershipCreditApplied,a.sameDayFee?[a.sameDayFee]:[]);
    const checkoutFundingSources = allocations ? checkoutCreditSources<Id<"credits">>(checkoutFunding, allocations).map(source=>({...source,lineIndex:source.lineIndex>=a.lineItems.length?-1:source.lineIndex})) : undefined;
    const bookingId = await ctx.db.insert("bookings", {
      pricingVersion:a.pricingVersion,benefitKind:a.benefitKind,swapBenefitRule,useAccountCredit:a.useAccountCredit,
      refundCreditApplied:a.refundCreditApplied,earnedCreditApplied:a.earnedCreditApplied,creditAllocations:allocations,
      referralCode:friend?.code,referralRewardId:reward?._id,
      customerId: customer!._id,
      guestEmail: customerEmail,
      renterPersonKey: exposure.personKey,
      replacementValues: values,
      accountId: a.accountId,
      guestName: a.customerName?.trim(),
      guestPhone: a.phone?.trim(),
      status: "pending_payment",
      lineItems: a.lineItems,
      itemPaymentLedgerVersion: 1,
      checkoutLineFunding: checkoutFunding.slice(0,a.lineItems.length).map((funding,index)=>({listingId:a.lineItems[index].listingId,start:a.lineItems[index].start,end:a.lineItems[index].end,qty:a.lineItems[index].qty,...funding})),
      checkoutLineCreditSources: checkoutFundingSources,
      fulfilment: a.fulfilment,
      deliveryLegs: a.fulfilment === "delivery" ? a.deliveryLegs ?? "round_trip" : undefined,
      address: a.address,
      billingAddress: a.billingAddress,
      deliveryFee: a.deliveryFee,
      sameDayFee: a.sameDayFee ?? 0,
      subtotal: a.subtotal,
      discount: a.discount ?? 0,
      promoCode: a.promoCode,
      depositAmount: a.depositAmount,
      depositHoldAmount: a.depositHoldAmount,
      securityPolicyVersion: a.securityPolicyVersion,
      cancellationProtectionEnabled:a.cancellationProtectionEnabled,
      savedCardLimit: cardLimit,
      savedCardStatus: savedCard ? "awaiting_payment" : undefined,
      savedCardConsentText: cardConsent,
      depositHoldStatus: a.depositHoldAmount ? "awaiting_payment" : undefined,
      total: chargedTotal,
      checkoutExpectedAmountPence,
      creditApplied,
      checkoutCreditState: "unspent",
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
      checkoutInputFingerprint:a.checkoutInputFingerprint,
      securityHoldPolicyVersion: savedCard ? undefined : cardHoldPolicy ? CHECKOUT_CARD_HOLD_POLICY : CHECKOUT_HOLD_POLICY,
      securityHoldConsentAt: a.securityHoldConsent ? Date.now() : undefined,
      laterChargeConsentAt: a.laterChargeConsent ? Date.now() : undefined,
      agreementDocs: a.agreementDocs,
      protection: a.protection,
      // A new web checkout can never self-assert verification or choose a
      // weaker provider. Didit reuse may promote this after the booking is paid.
      idVerifyStatus: "required",
      verificationProvider: "didit",
      verificationUpdatedAt: Date.now(),
      pickupTime: a.pickupTime,
      returnTime: a.returnTime,
    });
    if(friend){const redemptionId=await ctx.db.insert("referral_redemptions",{referrerAccountId:friend.referrerAccountId,friendAccountId:account!._id,bookingId,code:friend.code,discount:a.discount??0,state:"reserved",createdAt:Date.now()});await ctx.db.patch(bookingId,{referralRedemptionId:redemptionId});}
    if(reward)await ctx.db.patch(reward._id,{reservedBookingId:bookingId});
    if (a.membershipCheckoutId) await ctx.db.patch(a.membershipCheckoutId, {bookingId, membershipSignupOfferSaving:a.membershipSignupOfferSaving, initialCreditAppliedPence:Math.round(membershipCreditApplied * 100)});
    await linkMatchingRecovery(ctx,customerEmail,a.lineItems,bookingId);
    if (a.accountId) await ctx.scheduler.runAfter(0, internal.emailInbox.linkVerifiedHistory, { accountId: a.accountId, cursor: null });
    return { bookingId, creditApplied };
  },
});

function stockAllocationFingerprint(booking:any,rows:any[]) {
 const lines=bookingStockLines<any>(booking).map(li=>[String(li.listingId),li.start,li.end,li.pickupTime??null,li.returnTime??null,li.qty]).map(line=>JSON.stringify(line)).sort();
 const physical=rows.map(r=>JSON.stringify([String(r.inventoryUnitId),String(r.listingId),r.start,r.end,r.qty,r.endExclusive===true,r.turnaroundBufferMinutes??0])).sort();
 return JSON.stringify({lines,physical});
}

/** Tracks the quoted stock allocation for payment recovery; it never blocks availability. */
export const placeHolds = internalMutation({
  args: { bookingId: v.id("bookings"), ttlMs: v.number() },
  handler: async (ctx, { bookingId, ttlMs }) => {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 35 * 60 * 1000)
      throw Error("Invalid checkout reservation duration");
    const booking = await ctx.db.get(bookingId);
    if (!booking || booking.status !== "pending_payment" || !booking.lineItems.length)
      throw Error("Only an unpaid rental with equipment can record checkout stock");

    // Validate the complete order in this serializable mutation, using the same
    // blocked dates, component quantities and real stock records as the cart.
    const cache: RentalInventoryCache = { records: new Map(), reservations: new Map() };
    const lines=bookingStockLines(booking);
    const precision=await stockTimePrecision(ctx);
    const demands = await rentalInventoryDemands(ctx, lines, cache, bookingId);
    await assertPhysicalRentalInventory(ctx, demands, bookingId, cache);
    const requested = demands.map(demand => ({ inventoryUnitId: demand.inventoryUnitId, listingId: demand.listingId,
      ...stockWindow(demand,precision), qty: demand.qty }));
    const current = await ctx.db.query("reservations")
      .withIndex("by_booking", q => q.eq("bookingId", bookingId)).collect();
    if (current.some(r => r.status === "confirmed" || r.status === "active"))
      throw Error("This checkout's stock is already committed; reconcile the original rental");
    const holds = current.filter(r => r.status === "hold");
    if (holds.length) {
      const fingerprint = (rows: { inventoryUnitId: unknown; listingId?: unknown; start: number; end: number; qty: number }[]) => JSON.stringify(rows.map(r =>
        JSON.stringify([String(r.inventoryUnitId), r.listingId ? String(r.listingId) : null, r.start, r.end, r.qty,(r as {endExclusive?:boolean}).endExclusive===true,(r as {turnaroundBufferMinutes?:number}).turnaroundBufferMinutes??0])).sort());
      if (fingerprint(holds) !== fingerprint(requested))
        throw Error("This checkout's inventory reservation has changed; reconcile or cancel the original checkout");
      return { created: 0, alreadyReserved: true };
    }
    await ctx.db.patch(bookingId,{stockHoldFingerprint:stockAllocationFingerprint(booking,requested)});
    const expires = Date.now() + ttlMs;
    for (const row of requested) await ctx.db.insert("reservations", {
      ...row, bookingId, source: "site", status: "hold", holdExpiresAt: expires,
    });
    await ctx.scheduler.runAfter(0,internal.managerCheckoutStockPush.push,{});
    return { created: requested.length, alreadyReserved: false };
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
        const paidDiditPending = booking?.verificationProvider === "didit" &&
          ["pending_payment", "pending_verification"].includes(booking.status) &&
          typeof booking.checkoutPaidAt === "number" && Number.isSafeInteger(booking.checkoutPaidAt) && booking.checkoutPaidAt > 0;
        if (paidDiditPending) continue;
        // Checkout and amendment outcomes require provider reconciliation, not TTL.
        if (await reservationPaymentUnresolved(ctx, h)) continue;
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
  args: {
    bookingId: v.id("bookings"),
    sessionId: v.optional(v.string()),
    sessionStatus: v.optional(v.union(v.literal("complete"), v.literal("expired"))),
    paymentStatus: v.optional(v.literal("unpaid")),
  },
  handler: async (ctx, { bookingId, sessionId, sessionStatus, paymentStatus }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking || (booking.activeAdditionId || booking.activeExtensionId || booking.activeItemSwapId) || booking.status !== "pending_payment" ||
        booking.stripePaymentIntentId || (booking.checkoutPaidAt !== undefined && booking.checkoutPaidAt !== null) ||
        (booking.checkoutPaymentStatus !== undefined && booking.checkoutPaymentStatus !== null) ||
        (booking.stripeCheckoutSessionId ?? undefined) !== sessionId ||
        (sessionId !== undefined && (!sessionStatus || paymentStatus !== "unpaid")) ||
        (sessionId === undefined && (sessionStatus !== undefined || paymentStatus !== undefined))) return false;
    // A checkout expiry may delete its holds only after any equipment-change
    // claim has an authoritative stock outcome. An expired payment session is
    // not evidence that an in-flight Rental Manager swap can be released.
    await assertSwapStockReconciled(ctx, bookingId);
    const res = await ctx.db.query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId)).collect();
    for (const hold of res) if (hold.status === "hold") await ctx.db.delete(hold._id);
    if (booking.membershipCheckoutId) {
      const member=await ctx.db.get(booking.membershipCheckoutId);
      if(member && ["creating","open"].includes(member.state)) await ctx.db.patch(member._id,{state:"expired"});
    }
    await releaseReferral(ctx,booking);
    await ctx.db.patch(bookingId, { status: "cancelled", cancelledAt: Date.now(), checkoutExpiredAt: Date.now() });
    await bumpVerificationRetentionRevision(ctx,booking);
    await reconcileReleasedCredit(ctx,booking);
    return true;
  },
});

export const recordPaidCheckoutReceipt = internalMutation({
  args: {
    bookingId: v.id("bookings"), sessionId: v.string(), paymentIntentId: v.optional(v.string()),
    amountTotalPence: v.number(), currency: v.string(), paymentStatus: v.union(v.literal("paid"),v.literal("no_payment_required")),
  },
  handler: async (ctx, { bookingId, sessionId, paymentIntentId, amountTotalPence, currency, paymentStatus }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking || booking.stripeCheckoutSessionId !== sessionId)
      throw Error("Paid checkout does not match the booking. Review the payment before proceeding.");
    if (booking.stripePaymentIntentId && paymentIntentId && booking.stripePaymentIntentId !== paymentIntentId)
      throw Error("The checkout payment differs from the recorded receipt. Review both payments before proceeding.");
    const expectedMinimumPence=typeof booking.rentalPaidPence==="number"&&Number.isSafeInteger(booking.rentalPaidPence)?booking.rentalPaidPence:Math.round((booking.total??0)*100);
    const expectedCheckoutPence=typeof booking.checkoutExpectedAmountPence==="number"&&Number.isSafeInteger(booking.checkoutExpectedAmountPence)?booking.checkoutExpectedAmountPence:expectedMinimumPence;
    if(!Number.isSafeInteger(amountTotalPence)||amountTotalPence<0||!Number.isSafeInteger(expectedMinimumPence)||expectedMinimumPence<0||
       typeof currency!=="string"||!/^[a-z]{3}$/i.test(currency)||currency.toLowerCase()!==(booking.currency??"GBP").toLowerCase()||
       !Number.isSafeInteger(expectedCheckoutPence)||expectedCheckoutPence<expectedMinimumPence||
       (Number.isSafeInteger(booking.checkoutExpectedAmountPence)?amountTotalPence!==expectedCheckoutPence:amountTotalPence<expectedMinimumPence))
      throw Error("The paid checkout amount or currency does not match the rental. Review the Stripe receipt before proceeding.");
    if(paymentStatus==="paid"&&(!paymentIntentId||amountTotalPence<=0))
      throw Error("The paid checkout has no complete payment receipt. Review the Stripe payment before proceeding.");
    if(paymentStatus==="no_payment_required"&&(amountTotalPence!==0||expectedMinimumPence!==0||paymentIntentId||!checkoutCreditFullyCoversDue(booking)))
      throw Error("A zero-payment checkout has an unexpected charge or payment intent. Review the checkout before proceeding.");
    if (booking.cancellationDecision || ["cancelled", "returned"].includes(booking.status)) {
      if(bookingClaimEnabled())await reviewOutstandingBookingClaim(ctx,bookingId);
      return { closed: true, duplicatePayment: false, requiresSavedCard:isSavedCardRental(booking) };
    }
    if (["confirmed", "active"].includes(booking.status)) return { recorded: true, requiresSavedCard:isSavedCardRental(booking) };
    if (!["pending_payment", "pending_verification"].includes(booking.status)) throw Error("Booking is not awaiting confirmation.");
    // A checkout receipt can be retried while a prior item-change claim is
    // still reconciling. Keep the retry all-or-nothing; do not rewrite the
    // reservation rows or their claim expiry until that receipt is settled.
    await assertSwapStockReconciled(ctx, bookingId);
    const checkoutPaidAt = booking.checkoutPaidAt ?? Date.now();
    const awaitingDidit = booking.verificationProvider === "didit";
    const changed = !booking.checkoutPaidAt || (awaitingDidit && booking.status !== "pending_verification") ||
      (!!paymentIntentId && !booking.stripePaymentIntentId);
    await ctx.db.patch(bookingId, {
      checkoutPaidAt,
      checkoutPaymentAmountPence:amountTotalPence,
      checkoutPaymentCurrency:currency.toUpperCase(),
      checkoutPaymentStatus:paymentStatus,
      ...(!booking.checkoutPaidAt && booking.itemPaymentLedgerVersion === 1 && booking.checkoutLineFunding?.length === booking.lineItems.length && booking.checkoutLineFunding.every((row, index) => String(row.listingId) === String(booking.lineItems[index].listingId) && row.qty === booking.lineItems[index].qty && Number.isSafeInteger(Math.round(row.card * 100)) && row.card >= 0 && Math.abs(row.card*100-Math.round(row.card*100))<0.000001) && booking.checkoutLineFunding.reduce((sum, row) => sum + Math.round(row.card * 100), 0) <= amountTotalPence && (paymentIntentId || booking.checkoutLineFunding.every(row => row.card === 0)) ? {itemPaymentLedger:booking.checkoutLineFunding.map(row=>({listingId:row.listingId,qty:row.qty,sources:row.card>0&&paymentIntentId?[{paymentIntentId,amountPence:Math.round(row.card*100)}]:[]}))} : {}),
      ...(paymentIntentId && !booking.stripePaymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      ...(awaitingDidit && booking.status === "pending_payment" ? { status: "pending_verification" as const } : {}),
    });
    const holds = await ctx.db.query("reservations").withIndex("by_booking", (q: any) => q.eq("bookingId", bookingId)).collect();
    for (const hold of holds) if (hold.status === "hold" && hold.holdExpiresAt !== undefined)
      await ctx.db.patch(hold._id, { holdExpiresAt: undefined });
    if (changed || holds.some((hold: any) => hold.status === "hold" && hold.holdExpiresAt !== undefined))
      await queueRmv2Sync(ctx, bookingId);
    if (changed && awaitingDidit && isSavedCardRental(booking) && booking.savedCardStatus !== "saved")
      await ctx.scheduler.runAfter(0,internal.checkout.recoverPendingSavedCard,{bookingId,attempt:1});
    if (changed && awaitingDidit && booking.idVerifyStatus !== "verified") {
      await queueRentalEmail(ctx,bookingId,"paid_verification");
      await queueRentalEmail(ctx,bookingId,"verification_reminder",{dueAt:checkoutPaidAt+12*60*60*1000});
    }
    if (awaitingDidit && booking.idVerifyStatus === "verified")
      await ctx.scheduler.runAfter(15 * 60000, internal.checkout.confirmAfterVerification, { bookingId, attempt: 1 });
    return { recorded: true, checkoutPaidAt, awaitingVerification: awaitingDidit, requiresSavedCard:isSavedCardRental(booking),
      needsVerificationHoldRecovery: awaitingDidit && booking.idVerifyStatus === "verified" && !holds.some((hold:any) => hold.status === "hold") };
  },
});

/** Recover a paid hold released by the old declined-verification behavior.
 * Never recreate from the current catalogue: only the original exact ledger,
 * its fingerprint, and a fresh shared-stock check can authorize recovery. */
export const restoreReleasedVerificationHold = internalMutation({
  args:{bookingId:v.id("bookings"),sessionId:v.string(),paymentIntentId:v.optional(v.string()),rentalManagerCheckedAt:v.number()},
  handler:async(ctx,{bookingId,sessionId,paymentIntentId,rentalManagerCheckedAt})=>{
    const b=await ctx.db.get(bookingId);
    if(!b || b.status!=="pending_verification" || b.verificationProvider!=="didit" || b.idVerifyStatus!=="verified" ||
       b.stripeCheckoutSessionId!==sessionId || !Number.isSafeInteger(b.checkoutPaidAt) || b.checkoutPaidAt!<=0 ||
       (verificationValidUntil(b)??0)<=Date.now() || b.cancellationDecision || b.returnDecision ||
       (b.stripePaymentIntentId??null)!==(paymentIntentId??null) || !b.stockHoldFingerprint)
      throw Error("The paid verification or original allocation changed; the team must review this rental.");
    if(bookingClaimEnabled()) throw Error("The shared-stock booking claim must recover this rental.");
    const state=await ctx.db.query("rmv2_sync_state").withIndex("by_key",(q:any)=>q.eq("key","shared-stock-v1")).first();
    let checkedAt:number|undefined;try{checkedAt=JSON.parse(state?.cursor??"null")?.checkedAt}catch{}
    if(!state || state.status!=="ok" || checkedAt!==rentalManagerCheckedAt || !isSharedStockSnapshotFresh(rentalManagerCheckedAt,Date.now(),CART_STOCK_SYNC_MAX_AGE_MS))
      throw Error("A fresh Rental Manager availability check is required.");
    const rows=await ctx.db.query("reservations").withIndex("by_booking",(q:any)=>q.eq("bookingId",bookingId)).collect();
    const holds=rows.filter((r:any)=>r.status==="hold");
    if(holds.length){
      if(stockAllocationFingerprint(b,holds)!==b.stockHoldFingerprint)throw Error("The active rental allocation changed.");
      return {restored:false};
    }
    if(rows.some((r:any)=>["confirmed","active"].includes(r.status)))throw Error("This rental already has committed equipment.");
    const original=rows.filter((r:any)=>r.status==="cancelled" && r.source==="site" && !r.extensionRequestId && !r.externalRef);
    if(!original.length || stockAllocationFingerprint(b,original)!==b.stockHoldFingerprint)
      throw Error("The original equipment allocation cannot be safely reconstructed.");
    await assertRentalAllocation(ctx,b,original.map((r:any)=>({...r,status:"confirmed"})));
    await assertRentalInventory(ctx,bookingStockLines(b),bookingId);
    for(const row of original)await ctx.db.patch(row._id,{status:"hold",holdExpiresAt:undefined});
    await queueRmv2Sync(ctx,bookingId);
    return {restored:true};
  },
});

// For a paid rental whose initial verification email was sent manually before
// the automated notices were deployed. The queue deduplicates later retries.
export const scheduleManualVerificationReminder = internalMutation({
  args: {bookingId:v.id("bookings"), initialSentAt:v.number()},
  handler: async (ctx,{bookingId,initialSentAt}) => {
    const booking=await ctx.db.get(bookingId);
    if(!booking || booking.status!=="pending_verification" || booking.verificationProvider!=="didit" || !booking.checkoutPaidAt || booking.idVerifyStatus==="verified" || booking.cancellationDecision || booking.returnDecision || !Number.isSafeInteger(initialSentAt) || initialSentAt<booking.checkoutPaidAt || initialSentAt>Date.now()) return false;
    await queueRentalEmail(ctx,bookingId,"verification_reminder",{dueAt:initialSentAt+12*60*60*1000});
    return true;
  },
});

export const confirm = internalMutation({
  args: { bookingId: v.id("bookings"), paymentIntentId: v.optional(v.string()), rentalManagerCheckedAt: v.optional(v.number()) },
  handler: async (ctx, { bookingId, paymentIntentId, rentalManagerCheckedAt }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) throw new Error("booking not found");
    await stopMatchingRecovery(ctx,booking.guestEmail??"",booking.lineItems,bookingId);
    if (booking.cancellationDecision || booking.status === "cancelled" || booking.status === "returned")
      return { closed: true, duplicatePayment: false };
    if (paymentIntentId && booking.stripePaymentIntentId && paymentIntentId !== booking.stripePaymentIntentId)
      return { closed: true, duplicatePayment: true };
    if (booking.status === "confirmed" || booking.status === "active") {
      await ensurePaidBookingAccount(ctx,booking);
      if(booking.accountAccessRequired&&!booking.accountAccessEmailSentAt){
        if(!booking.accountAccessEmailRetryAt)await ctx.db.patch(bookingId,{accountAccessEmailRetryAt:Date.now()});
        await ctx.scheduler.runAfter(0,internal.accountAccess.sendForRental,{bookingId});
      }
      return { already: true };
    }
    if (isSavedCardRental(booking) && booking.savedCardStatus !== "saved")
      throw new Error("A successful reusable-card setup is required before this rental can be confirmed.");
    // Do not turn soft holds into confirmed allocations while an earlier
    // equipment change still has an unresolved external stock receipt.
    await assertSwapStockReconciled(ctx, bookingId);
    const verifiedUntil = verificationValidUntil(booking) ?? 0;
    const verificationApproved = hasBookingDiditApproval(booking) && verifiedUntil > Date.now();
    if (booking.verificationProvider === "didit" && !verificationApproved) {
      if(bookingClaimEnabled())await reviewOutstandingBookingClaim(ctx,bookingId);
      await ctx.db.patch(bookingId, {
        status: "pending_verification",
        stripePaymentIntentId: paymentIntentId ?? booking.stripePaymentIntentId,
      });
      if (!booking.diditSessionId && (booking.idVerifyStatus ?? "required") === "required")
        await ctx.scheduler.runAfter(0, internal.didit.reuseVerification, { bookingId });
      await queueRmv2Sync(ctx, bookingId);
      return { awaitingVerification: true };
    }
    const sharedClaim=bookingClaimEnabled()?await assertBookingClaimExecution(ctx,booking,paymentIntentId):null;
    if (isCardHoldSecurityPolicy(booking.securityPolicyVersion) && rentalManagerCheckedAt === undefined)
      throw new Error("A fresh Rental Manager stock check is required before confirming this rental.");
    if (rentalManagerCheckedAt !== undefined) {
      const syncState = await ctx.db.query("rmv2_sync_state").withIndex("by_key", (q: any) => q.eq("key", "shared-stock-v1")).first();
      let storedCheckedAt: number | undefined;
      try { storedCheckedAt = JSON.parse(syncState?.cursor ?? "null")?.checkedAt; } catch { storedCheckedAt = undefined; }
      if (!syncState || syncState.status !== "ok" || storedCheckedAt !== rentalManagerCheckedAt ||
          !isSharedStockSnapshotFresh(rentalManagerCheckedAt, Date.now(), CART_STOCK_SYNC_MAX_AGE_MS))
        throw new Error("Rental Manager availability could not be verified from a fresh stock snapshot.");
    }
    if ((booking.membershipCreditApplied ?? 0) > 0) {
      const grant = booking.membershipCreditGrantId ? await ctx.db.get(booking.membershipCreditGrantId) : null;
      if (!grant || grant.initialCreditAppliedPence !== Math.round(booking.membershipCreditApplied! * 100))
        throw Error("The paid first-month credit receipt has not settled yet.");
    }
    if (booking.verificationProvider === "didit" && ["pending_payment", "pending_verification"].includes(booking.status)) {
      const amount = booking.checkoutPaymentAmountPence;
      const currency = typeof booking.checkoutPaymentCurrency === "string" ? booking.checkoutPaymentCurrency.toUpperCase() : "";
      const expectedCurrency = (booking.currency ?? "GBP").toUpperCase();
      const expectedMinimumPence = typeof booking.rentalPaidPence === "number" && Number.isSafeInteger(booking.rentalPaidPence)
        ? booking.rentalPaidPence
        : Math.round((booking.total ?? 0) * 100);
      const hasExpectedCheckoutPence = Number.isSafeInteger(booking.checkoutExpectedAmountPence);
      const expectedCheckoutPence = hasExpectedCheckoutPence ? booking.checkoutExpectedAmountPence : expectedMinimumPence;
      const amountMatchesCheckout = typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0 &&
        Number.isSafeInteger(expectedMinimumPence) && expectedMinimumPence >= 0 &&
        typeof expectedCheckoutPence === "number" && Number.isSafeInteger(expectedCheckoutPence) && expectedCheckoutPence >= expectedMinimumPence &&
        (hasExpectedCheckoutPence ? amount === expectedCheckoutPence : amount >= expectedMinimumPence);
      const receiptRecorded = typeof booking.checkoutPaidAt === "number" && Number.isSafeInteger(booking.checkoutPaidAt) && booking.checkoutPaidAt > 0 &&
        typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0 && amountMatchesCheckout && currency === expectedCurrency &&
        typeof booking.stripeCheckoutSessionId === "string" && booking.stripeCheckoutSessionId.length > 0 &&
        (booking.checkoutPaymentStatus === "paid"
          ? amount > 0 && !!booking.stripePaymentIntentId && paymentIntentId === booking.stripePaymentIntentId
          : booking.checkoutPaymentStatus === "no_payment_required" && amount === 0 && !booking.stripePaymentIntentId && !paymentIntentId);
      if (!receiptRecorded)
        throw new Error("A verified Stripe checkout receipt is required before confirming a Didit rental.");
    }
    if (booking.verificationProvider === "didit") {
      const approvalAt = booking.idVerificationSource === "reused_didit" ? booking.idVerifiedAt : booking.diditDecisionAt;
      if (!diditApprovalWithinVerificationWindow(booking, approvalAt)) {
        await ctx.db.patch(bookingId, {
          status: "pending_verification",
          stripePaymentIntentId: paymentIntentId ?? booking.stripePaymentIntentId,
          verificationConfirmationIssue: "provider_confirmation_failed",
        });
        const account = await accountForRental(ctx, booking);
        await queueOwnerNotification(ctx, {
          eventKey: `paid-verification-timing-review:${bookingId}`,
          kind: "verification_failure",
          ...(account ? { accountId: account._id } : {}),
          bookingId,
          title: "Paid booking needs verification timing review",
          body: "Didit shows an approval, but the rental start time or provider decision time could not be verified against the two-hour cutoff. The booking remains unconfirmed; check the schedule and approval before proceeding.",
        });
        await queueRmv2Sync(ctx, bookingId);
        return { awaitingVerification: true, awaitingVerificationReview: true };
      }
    }
    const holds = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    const committed=holds.filter(h=>h.status==="hold");
    let completeAllocation=false;
    if(committed.length&&booking.stockHoldFingerprint)completeAllocation=booking.stockHoldFingerprint===stockAllocationFingerprint(booking,committed);
    else if(committed.length)try{await assertRentalAllocation(ctx,booking,committed.map(h=>({...h,status:"confirmed"})));completeAllocation=true;}catch{}
    if(booking.status==="pending_verification"&&booking.verificationProvider==="didit"){
      const now=Date.now();
      const paidReceipt=typeof booking.checkoutPaidAt==="number"&&Number.isSafeInteger(booking.checkoutPaidAt)&&booking.checkoutPaidAt>0;
      const freshAllocation=committed.length>0&&committed.every(h=>paidReceipt
        ? h.holdExpiresAt===undefined||typeof h.holdExpiresAt==="number"&&h.holdExpiresAt>now
        : typeof h.holdExpiresAt==="number"&&h.holdExpiresAt>now);
      const savedAllocation=freshAllocation&&!!booking.stockHoldFingerprint&&booking.stockHoldFingerprint===stockAllocationFingerprint(booking,committed);
      const needsAllocationReview=committed.length>0&&freshAllocation&&!savedAllocation;
      completeAllocation=false;
      let allocationError=needsAllocationReview;
      if(savedAllocation){
        try{await assertRentalAllocation(ctx,booking,committed.map(h=>({...h,status:"confirmed"})));completeAllocation=true;}
        catch{allocationError=true;}
      }
      if(!allocationError){
        try{if(booking.lineItems.length)await assertRentalInventory(ctx,bookingStockLines(booking),bookingId);}
        catch{allocationError=true;}
      }
      if(allocationError){
        await ctx.db.patch(bookingId,{verificationConfirmationIssue:"inventory_unavailable",stripePaymentIntentId:paymentIntentId??booking.stripePaymentIntentId});
        const account=await accountForRental(ctx,booking);
        await queueOwnerNotification(ctx,{eventKey:`verification-stock-review:${bookingId}`,kind:"verification_failure",...(account?{accountId:account._id}:{}),bookingId,title:"Paid booking needs stock review",body:"Didit approved verification, but equipment availability changed before confirmation. Open the rental and resolve availability; the booking is not confirmed."});
        return {awaitingInventoryReview:true};
      }
    } else {
      try { await assertRentalInventory(ctx, bookingStockLines(booking), bookingId); }
      catch {
        await ctx.db.patch(bookingId,{verificationConfirmationIssue:"inventory_unavailable",stripePaymentIntentId:paymentIntentId??booking.stripePaymentIntentId,...(booking.verificationProvider==="didit"?{status:"pending_verification" as const}:{})});
        const account=await accountForRental(ctx,booking);
        await queueOwnerNotification(ctx,{eventKey:`verification-stock-review:${bookingId}`,kind:"verification_failure",...(account?{accountId:account._id}:{}),bookingId,title:"Paid booking needs stock review",body:"The selected equipment could not be confirmed as available. The paid rental remains unconfirmed until availability is resolved."});
        return {awaitingInventoryReview:true};
      }
    }
    // Email ownership must be proved before an automatically created account gains a session.
    if (booking.accountAccessRequired || !await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", booking.guestEmail ?? "")).first()) {
      await ctx.db.patch(bookingId,{accountAccessEmailRetryAt:Date.now()});
      await ctx.scheduler.runAfter(0, internal.accountAccess.sendForRental, { bookingId });
    }
    // clear this booking's soft holds before writing the real reservations
    for (const h of committed) await ctx.db.delete(h._id);
    await ctx.db.patch(bookingId, {
      status: "confirmed",
      paidConfirmedAt:Date.now(),
      checkoutCreditState: "spent",
      stripePaymentIntentId: paymentIntentId,
      verificationConfirmationIssue:undefined,
      ...(isPickupHoldPolicyVersion(booking.securityHoldPolicyVersion) && booking.depositHoldAmount ? {securityHoldRetryAt:Date.now(),depositHoldStatus:"scheduled"} : {}),
    });
    if (isPickupHoldPolicyVersion(booking.securityHoldPolicyVersion) && booking.depositHoldAmount)
      await ctx.scheduler.runAfter(0,internal.checkout.preparePickupSecurity,{bookingId});
    await ensurePaidBookingAccount(ctx,{...booking,status:"confirmed"});
    if (isSavedCardRental(booking)) await ctx.scheduler.runAfter(0,internal.checkout.prepareSavedCard,{bookingId});
    const membershipAccount = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", booking.guestEmail ?? "")).first();
    if(membershipAccount&&!membershipAccount.firstRentalPaidAt)await ctx.db.patch(membershipAccount._id,{firstRentalPaidAt:Date.now()});
    if (membershipAccount?.membershipPerksPendingBookingId === bookingId)
      await ctx.db.patch(membershipAccount._id,{membershipPerksPendingBookingId:undefined});
    // Preserve the exact physical allocation made by the authoritative hold
    // transaction, even when source freshness or the listing BOM changes later.
    if (completeAllocation) {
      for (const h of committed) await ctx.db.insert("reservations", {
        inventoryUnitId:h.inventoryUnitId,listingId:h.listingId,bookingId,
        start:h.start,end:h.end,endExclusive:h.endExclusive,turnaroundBufferMinutes:h.turnaroundBufferMinutes,
        qty:h.qty,source:"site",status:"confirmed",
      });
    } else {
      // Compatibility for paid bookings created before physical holds existed.
      const precision=await stockTimePrecision(ctx);
      for (const li of bookingStockLines(booking)) {
        const listing=await ctx.db.get(li.listingId);
        if (!listing) continue;
        const components = await storedBookingComponents(ctx, li, bookingId) ?? listing.components;
        for (const comp of components) await ctx.db.insert("reservations", {
          inventoryUnitId:comp.inventoryUnitId,listingId:li.listingId,bookingId,
          ...stockWindow(li,precision),qty:comp.qty*li.qty,
          source:"site",status:"confirmed",
        });
      }
    }
    // record promo redemption (enforces one-time / once-a-month limits)
    if (booking.promoCode && booking.guestEmail) {
      await ctx.db.insert("promo_redemptions", {
        email: booking.guestEmail.trim().toLowerCase(),
        accountId: booking.accountId,
        code: booking.promoCode,
        at: Date.now(),
      });
    }
    if(booking.promoCode === FIRST_ORDER_VOUCHER_CODE) {
      const voucher = await ctx.db.query("promo_codes").withIndex("by_code",q=>q.eq("code",FIRST_ORDER_VOUCHER_CODE)).first();
      if(voucher) await ctx.db.patch(voucher._id,{usedCount:(voucher.usedCount ?? 0)+1});
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
    const paidBooking = await ctx.db.get(bookingId), paidAccount = await accountForRental(ctx, paidBooking);
    if(paidBooking && paidAccount && paidBooking.stripePaymentIntentId && paidBooking.currency === "GBP" && paidBooking.checkoutPaymentStatus !== "no_payment_required") {
      const refunds = await ctx.db.query("rental_refunds").withIndex("by_booking", q => q.eq("bookingId", bookingId)).take(101);
      const grossPence = bookingRentalCollectedPence(paidBooking);
      const accounting = refunds.length <= 100 ? rentalRefundAccounting(refunds) : { complete: false, refundedPence: 0 };
      const income = grossPence !== null && accounting.complete && accounting.refundedPence <= grossPence
        ? { gross: grossPence / 100, net: (grossPence - accounting.refundedPence) / 100, currency: "GBP" as const }
        : undefined;
      await queueOwnerNotification(ctx, {eventKey:`paid:${bookingId}`,kind:"booking_paid",accountId:paidAccount._id,bookingId,title:"Booking payment received",body:"A DB Cinema Web rental has been paid.",...(income ? {income} : {})});
    }
    // Send one renter-facing approval email after payment, Didit approval and
    // stock confirmation. That email includes the invoice and pickup details;
    // separate legacy payment/receipt messages were both confusing and could
    // attach the same invoice twice.
    if (booking.idVerifyStatus === "verified")
      await queueRentalEmail(ctx,bookingId,"verification",{verificationStatus:"verified"});
    await ctx.scheduler.runAfter(0, internal.chat.postBookingMessages, { bookingId });
    await ctx.scheduler.runAfter(0, internal.didit.reuseVerification, { bookingId });
    await queueRmv2Sync(ctx, bookingId);
    if(sharedClaim)await recordBookingStockApplication(ctx,bookingId,sharedClaim);
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
    const acct = await accountForRental(ctx, b);
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
  if(!b)return {closed:true};
  await assertSwapStockReconciled(ctx,b._id);
  if(hasCashDepositPolicy(b.securityPolicyVersion)||!["confirmed","active"].includes(b.status)||b.cancellationDecision||b.returnDecision||(b.activeAdditionId || b.activeExtensionId || b.activePriceAdjustmentId || b.activeItemSwapId))return {closed:true};
  const listing=await ctx.db.get(a.listingId);if(!listing)return {closed:true};
  const line={listingId:a.listingId,title:listing.title,start:a.start,end:a.end,qty:1,lineTotal:a.total,dailyRate:listing.pricing.daily};
  if(!Number.isFinite(a.total)||a.total<=0||a.start%86400000!==0||a.end%86400000!==0)return {closed:true};
  try{await assertRenterExposure(ctx,b,[...b.lineItems,line]);await assertRentalInventory(ctx,[...b.lineItems,line],b._id);}catch{return {closed:true};}
  const now=Date.now();
  await ctx.db.insert("rental_additions",{...line,bookingId:b._id,requestId:`legacy-${a.sessionId}`,securityCharge:0,holdTotal:b.depositHoldAmount??0,status:"applied",reason:"Legacy paid item addition",createdAt:now,updatedAt:now,sessionId:a.sessionId,paymentIntentId:a.paymentIntentId});
  await ctx.db.patch(b._id,{replacementValues:await replacementValues(ctx,b,[...b.lineItems,line]),lineItems:[...b.lineItems,line],subtotal:b.subtotal+a.total,total:b.total+a.total});
  for(const comp of listing.components)await ctx.db.insert("reservations",{inventoryUnitId:comp.inventoryUnitId,listingId:a.listingId,bookingId:b._id,start:a.start,end:a.end,qty:comp.qty,source:"site",status:b.status==="active"?"active":"confirmed"});
  const account=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",(b.guestEmail??"").trim().toLowerCase())).first();
  if(account)await postRentalMessage(ctx,{accountId:account._id,bookingId:b._id,sender:"system",text:`Added to your rental: ${listing.title}. Rental charge £${a.total.toFixed(2)}.`});
  await queueRmv2Sync(ctx, b._id);
  return {closed:false};
 }
});

/** Compact, protected document history; pagination reaches older rentals
 * without copying private verification/financial execution fields to the list. */
export const adminAuthorized=query({args:{token:v.string()},handler:(_ctx,{token})=>checkAdminToken(token)});

export const adminCalendarPage=query({
  args:{token:v.string(),paginationOpts:paginationOptsValidator},
  handler:async(ctx,{token,paginationOpts})=>{
    if(!checkAdminToken(token))return {page:[],isDone:true,continueCursor:""};
    if(!Number.isSafeInteger(paginationOpts.numItems)||paginationOpts.numItems<1)throw Error("Invalid calendar page size");
    const result=await ctx.db.query("bookings").order("desc").paginate({...paginationOpts,numItems:Math.min(50,paginationOpts.numItems),maximumRowsRead:50});
    return {...result,page:result.page.map(b=>({_id:b._id,status:b.status,pickupTime:b.pickupTime,returnTime:b.returnTime,
      lineItems:b.lineItems.map(l=>({title:l.title,start:l.start,end:l.end,qty:l.qty,returnTime:l.returnTime})),
    }))};
  },
});

export const adminInvoicePage=query({
  args:{token:v.string(),accountId:v.optional(v.id("accounts")),paginationOpts:paginationOptsValidator},
  handler:async(ctx,{token,accountId,paginationOpts})=>{
    if(process.env.ADMIN_SESSION_BILLING_PORTAL_V2==="enabled"){
      if(!adminSessionMigrationReady())throw Error("Admin session migration is not ready.");
      await assertAdminScopeSession(ctx,token,"payments:read");
    }else if(!checkAdminToken(token))return {page:[],isDone:true,continueCursor:""};
    if(!Number.isSafeInteger(paginationOpts.numItems)||paginationOpts.numItems<1)throw Error("Invalid document page size");
    const opts={...paginationOpts,numItems:Math.min(50,paginationOpts.numItems),maximumRowsRead:50};
    let result;
    if(accountId){
      const account=await ctx.db.get(accountId);if(!account)return {page:[],isDone:true,continueCursor:""};
      const legacy=paginationOpts.cursor?.startsWith("legacy:")??false;
      const page=await (legacy?ctx.db.query("bookings").withIndex("by_account_guestEmail",q=>q.eq("accountId",undefined).eq("guestEmail",account.email)):ctx.db.query("bookings").withIndex("by_account",q=>q.eq("accountId",accountId))).order("desc").paginate({...opts,cursor:legacy?paginationOpts.cursor!.slice(7)||null:paginationOpts.cursor});
      result=legacy?{...page,continueCursor:page.isDone?"":`legacy:${page.continueCursor}`} : page.isDone?{...page,isDone:false,continueCursor:"legacy:"}:page;
    }else result=await ctx.db.query("bookings").order("desc").paginate(opts);
    return {...result,page:result.page.map(b=>({_id:b._id,at:b._creationTime,status:b.status,total:b.total,guestEmail:b.guestEmail,guestName:b.guestName,
      hasPayment:!!b.stripePaymentIntentId||["confirmed","active","returned"].includes(b.status),hasReturnStatement:!!b.returnStatement,returnStatementIssuedAt:b.returnStatement?.issuedAt,
      lineItems:b.lineItems.map(l=>({title:l.title,start:l.start,end:l.end})),
    }))};
  },
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
      securityPolicyVersion:b.securityPolicyVersion??null,savedCardStatus:b.savedCardStatus??null,savedCardLimit:b.savedCardLimit??null,
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
      returnStatement:b.returnStatement??null,
      returnTime: b.returnTime ?? null,
      returnStatementEmailStatus: b.returnStatementEmailStatus ?? null,
      hasReturnStatement: !!b.returnStatement,
      hasPayment: !!b.stripePaymentIntentId || ["confirmed", "active", "returned"].includes(b.status),
      pickupTime: b.pickupTime ?? null,
      idVerifyStatus: b.idVerifyStatus ?? "required",
      verificationProvider: b.verificationProvider ?? "stripe",
      diditSessionId: b.diditSessionId ?? null,
      verificationNote: b.verificationNote ?? null,
      verificationConfirmationIssue: b.verificationConfirmationIssue ?? null,
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
    if (status === "active" && booking.status === "confirmed") {
      const requests = await ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc").take(RENTAL_REQUEST_HISTORY_LIMIT + 1);
      const summary = summarizeRentalRequests(requests);
      if (!summary.ready) throw Error("This rental has a long request history. Review earlier renter requests before pickup.");
      if (summary.any) throw Error("A renter request is still awaiting a decision or completion. Review it before recording pickup.");
    }
    await assertSwapStockReconciled(ctx, bookingId, undefined, true);
    await assertActiveItemSwapReady(ctx, booking, true);
    if(booking.returnDecision)throw Error("Return settlement is in progress; finish it before changing this rental.");
    if((booking.activeAdditionId || booking.activeDeliveryQuoteId || booking.activeExtensionId || booking.activePriceAdjustmentId))throw Error("Finish or withdraw the open rental change before handover.");
    if(booking.cancellationDecision)throw Error("Cancellation is in progress; resume its settlement before changing this rental.");
    if (["cancelled", "returned"].includes(booking.status) && booking.status !== status)
      throw new Error("A closed booking cannot be reopened by changing its status.");
    if (booking.status === "pending_payment")
      throw new Error("Payment must be confirmed by Stripe before this booking is confirmed.");
    if (status === "confirmed" && (!booking.paidConfirmedAt || !hasBookingDiditApproval(booking)))
      throw new Error("Payment and Didit verification must be approved before this booking is confirmed.");
    if (status === "active" && (!booking.paidConfirmedAt || !hasBookingDiditApproval(booking)))
      throw new Error("Payment and Didit verification must be approved before handover.");
    if (status === "confirmed" && booking.status !== "confirmed")
      throw new Error("Only the paid checkout and verification flow can confirm this booking.");
    if (status === "active" && !["confirmed", "active"].includes(booking.status))
      throw new Error("Only a confirmed booking can be marked as picked up.");
    if (status === "active" && booking.depositHoldAmount &&
        (booking.depositHoldStatus !== "held" || (booking.depositHoldExpiresAt ?? 0) <= Date.now()))
      throw new Error("The card hold must be active before handover.");
    if (status === "active" && isSavedCardRental(booking) && booking.savedCardStatus !== "saved")
      throw new Error("The rental's reusable card and explicit collection permission must be saved before handover.");
    if (status === "active") {
      const expiredProposal = await expireUnacceptedItemSwap(ctx, booking);
      if (expiredProposal) {
        const account = await accountForRental(ctx, booking);
        if (account) await postRentalMessage(ctx, {
          accountId: account._id,
          bookingId,
          sender: "system",
          text: "The pending equipment-change offer closed at handover. Your original confirmed items and price remain unchanged.",
        });
      }
    }
    if (status === "active") {
      const stockRisk = await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_stock_risk", q => q.eq("bookingId", bookingId).eq("stockRisk", true)).first();
      if (stockRisk) throw Error("Equipment availability needs review before handover.");
      if(isSavedCardRental(booking))assertSavedCardConsent(booking);
      await assertDroneApproval(ctx, booking);
      await assertVerificationArchive(ctx, booking);
      assertAgreementBeforeRelease(booking);
      await assertRenterExposure(ctx, { ...booking, status: "active" });
    }
    await ctx.db.patch(bookingId, { status, ...(status === "active" ? { pickedUpAt: booking.pickedUpAt ?? Date.now(), deliveryBenefitConsumed: !!booking.deliveryBenefitMonth } : {}) });
    await queueRmv2Sync(ctx, bookingId);
  },
});

export const getForRefund = internalQuery({
  args: { bookingId: v.id("bookings"), includeControlsSnapshot: v.optional(v.boolean()) },
  handler: async (ctx, { bookingId, includeControlsSnapshot }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const refunds=includeControlsSnapshot?await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).take(101):[];
    if(refunds.length>100)throw Error("This rental's refund history requires a manual financial review.");
    return {
      controlsSnapshot:includeControlsSnapshot?rentalControlsSnapshot(b,refunds):undefined,
      status:b.status,
      paymentSources:await rentalPaymentSources(ctx,b),
      paymentIntentId: b.stripePaymentIntentId ?? null,
      depositAmount: b.depositAmount,
      depositHoldAmount: b.depositHoldAmount ?? 0,
      depositHoldStatus: b.depositHoldStatus ?? null,
      securityPolicyVersion:b.securityPolicyVersion??null,savedCardStatus:b.savedCardStatus??null,savedCardLimit:b.savedCardLimit??null,
      depositHoldIntentId: b.stripeDepositIntentId ?? null,
      depositHoldRenewalIntentId:b.depositHoldRenewalIntentId??null,
      replacementValues:b.replacementValues,pickedUpAt:b.pickedUpAt,
      depositHoldPreviousIntentIds: b.depositHoldPreviousIntentIds ?? [],
      lineItems: b.lineItems,
      returnTime: b.returnTime ?? null,
      guestEmail: b.guestEmail ?? null,
      actualReturnedAt: b.actualReturnedAt ?? null,
      returnDecision: b.returnDecision ?? null,
      depositReturnReceipts:b.depositReturnReceipts??[],
      depositReturnReceiptHistory:b.depositReturnReceiptHistory??[],
      depositRefunded: b.depositRefunded ?? false,
      depositKept: b.depositKept ?? 0,
      depositRefundAmount: b.depositRefundAmount ?? 0,
      depositHoldCapturedForDamage: b.depositHoldCapturedForDamage ?? 0,
      damageNoticeSentAt: b.damageNoticeSentAt ?? null,
      returnStatementEmailStatus: b.returnStatementEmailStatus ?? null,
      returnStatementEmailAmbiguous: b.returnStatementEmailAmbiguous ?? false,
    };
  },
});

async function ensureReturnDamageCase(ctx: any, args: {
  bookingId: any;
  accountId?: any;
  item: any;
  actualReturnedAt: number;
  damageKept: number;
  damageNote?: string;
  claimBasis?: "loss" | "severe_cosmetic_damage";
  claimEvidenceIds?: any[];
  claimCaseId?: any;
}) {
  const requestId = `return-claim-${String(args.bookingId)}-${args.actualReturnedAt}-${args.item.key}`;
  const claimReason = args.damageNote ?? args.item.details;
  const claimAmountPence = Math.round(args.damageKept * 100);
  const claimEvidenceIds = args.claimEvidenceIds ?? [];
  const linkedCase = args.claimCaseId ? await ctx.db.get(args.claimCaseId) : null;
  if (args.claimCaseId && !linkedCase) throw Error("The permanently linked return damage case is unavailable.");
  if (linkedCase && (linkedCase.bookingId !== args.bookingId || linkedCase.itemKey !== args.item.key)) throw Error("The saved return claim is linked to a different rental case.");
  const byRequest = linkedCase ?? await ctx.db.query("rental_damage_cases").withIndex("by_booking_request", (q: any) => q.eq("bookingId", args.bookingId).eq("requestId", requestId)).first();
  let caseRecord = byRequest;
  if (caseRecord && (caseRecord.itemKey !== args.item.key || caseRecord.claimAmountPence !== claimAmountPence || caseRecord.claimReason !== claimReason || caseRecord.claimBasis !== args.claimBasis || JSON.stringify([...(caseRecord.claimEvidenceIds ?? [])].map(String).sort()) !== JSON.stringify([...claimEvidenceIds].map(String).sort())))
    throw Error("The saved damage case does not match the frozen return claim.");
  if (!caseRecord) {
    const matches = await ctx.db.query("rental_damage_cases").withIndex("by_booking_item", (q: any) => q.eq("bookingId", args.bookingId).eq("itemKey", args.item.key)).take(101);
    if (matches.length > 100) throw Error("The item case history needs review before settling this return.");
    caseRecord = matches.find((row: any) => row.status === "open");
  }
  if (!caseRecord) {
    const openedAt = Date.now();
    const caseId = await ctx.db.insert("rental_damage_cases", {
      bookingId: args.bookingId,
      ...(args.accountId ? { accountId: args.accountId } : {}),
      itemKey: args.item.key,
      title: args.item.title,
      ...(args.item.inventoryUnitId ? { inventoryUnitId: args.item.inventoryUnitId } : {}),
      caseType: args.claimBasis === "loss" ? "loss" : "damage",
      details: args.item.details,
      status: "open",
      openedAt,
      requestId,
      claimAmountPence,
      claimReason,
      ...(args.claimBasis ? { claimBasis: args.claimBasis } : {}),
      claimEvidenceIds,
    });
    caseRecord = await ctx.db.get(caseId);
  } else if (args.damageKept > 0) {
    const existingEvidence = [...(caseRecord.claimEvidenceIds ?? [])].map(String).sort();
    const newEvidence = [...claimEvidenceIds].map(String).sort();
    if (caseRecord.claimAmountPence !== undefined && caseRecord.claimAmountPence !== claimAmountPence || caseRecord.claimReason !== undefined && caseRecord.claimReason !== claimReason || caseRecord.claimBasis !== undefined && caseRecord.claimBasis !== args.claimBasis || existingEvidence.length && JSON.stringify(existingEvidence) !== JSON.stringify(newEvidence))
      throw Error("An existing item case has different frozen claim details.");
    if (caseRecord.claimAmountPence === undefined || caseRecord.claimReason === undefined || !existingEvidence.length) {
      await ctx.db.patch(caseRecord._id, { claimAmountPence, claimReason, ...(args.claimBasis ? { claimBasis: args.claimBasis } : {}), claimEvidenceIds });
      caseRecord = await ctx.db.get(caseRecord._id);
    }
  }
  if (!caseRecord || caseRecord.bookingId !== args.bookingId || caseRecord.itemKey !== args.item.key) throw Error("The return damage case could not be linked to the affected item.");
  await archiveCaseConversation(ctx, caseRecord);
  return caseRecord;
}

export const beginReturnDecision = internalMutation({
  args: { bookingId: v.id("bookings"), actualReturnedAt: v.number(), damageKept: v.number(), depositKept: v.optional(v.number()), claimBasis: v.optional(v.union(v.literal("loss"), v.literal("severe_cosmetic_damage"))), expectedSnapshot: v.optional(v.string()), damageNote: v.optional(v.string()), claimItemKey:v.optional(v.string()), claimEvidenceIds:v.optional(v.array(v.id("chat_attachment_attempts"))), chargeLate: v.boolean(), lateWaiverReason: v.optional(v.string()), lateClaimReason: v.optional(v.string()), ownerClaimAuthorizedAt: v.optional(v.number()), inspection: v.optional(v.array(inspectionInput)) },
  handler: async (ctx, { bookingId, actualReturnedAt, damageKept, depositKept, claimBasis, expectedSnapshot, damageNote, claimItemKey, claimEvidenceIds, chargeLate, lateWaiverReason, lateClaimReason, ownerClaimAuthorizedAt, inspection }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || !["confirmed", "active", "returned"].includes(b.status)) throw new Error("Booking is not available for return.");
    await assertSwapStockReconciled(ctx, bookingId, undefined, true);
    await assertActiveItemSwapReady(ctx, b, true);
    if(b.activeExtensionId)throw Error("Finish or withdraw the open rental change: approved extension before returning this rental");
    if((b.activeAdditionId || b.activeDeliveryQuoteId || b.activePriceAdjustmentId))throw Error("Finish or withdraw the open rental change before returning this rental");
    if(b.cancellationDecision)throw Error("Cancellation settlement is in progress; resume it first.");
    const refundJobs=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
    if(refundJobs.some(r=>r.status==="prepared"||r.status==="pending"))throw Error("Wait for the rental refund to settle before recording the return.");
    const saved = b.returnDecision;
    const ownerClaimRequired = damageKept > 0 || (depositKept ?? 0) > 0 || chargeLate;
    const validOwnerClaimReceipt = (at: unknown): at is number => typeof at === "number" && Number.isSafeInteger(at) && at > 0;
    if (ownerClaimAuthorizedAt !== undefined && !validOwnerClaimReceipt(ownerClaimAuthorizedAt))
      throw Error("The owner-claim authorization receipt is invalid.");
    const inspected = inspection ? normalizeReturnInspection(await returnInspectionSchedule(ctx, b), inspection, damageKept) : undefined;
    if (saved) {
      const savedEvidence=[...(saved.claimEvidenceIds??[])].map(String).sort(),newEvidence=[...(claimEvidenceIds??[])].map(String).sort();
      const sameFrozenCore=saved.actualReturnedAt===actualReturnedAt&&saved.damageKept===damageKept&&saved.depositKept===depositKept&&(!saved.expectedSnapshot||saved.expectedSnapshot===expectedSnapshot)&&
        (saved.damageNote??"")===(damageNote??"")&&saved.claimBasis===claimBasis&&saved.chargeLate===chargeLate&&
        (saved.lateWaiverReason??"")===(lateWaiverReason??"")&&(saved.lateClaimReason??"")===(lateClaimReason??"")&&sameReturnInspection(saved.inspection,inspected);
      const sameFrozenDecision=sameFrozenCore&&saved.claimItemKey===claimItemKey;
      const mayAttachLateEvidence=sameFrozenDecision&&saved.chargeLate&&saved.damageKept===0&&(saved.depositKept??0)===0&&!savedEvidence.length&&newEvidence.length>0&&validOwnerClaimReceipt(saved.ownerClaimAuthorizedAt);
      const mayAttachHoldDamageEvidence=sameFrozenCore&&!hasCashDepositPolicy(b.securityPolicyVersion)&&!isSavedCardRental(b)&&(b.depositHoldAmount??0)>0&&saved.damageKept>0&&
        (!!(!savedEvidence.length&&newEvidence.length>0)||!!(savedEvidence.length>0&&!saved.claimItemKey&&JSON.stringify(savedEvidence)===JSON.stringify(newEvidence)))&&!!claimItemKey&&(!saved.claimItemKey||saved.claimItemKey===claimItemKey)&&
        !!saved.inspection?.some((item:any)=>item.key===claimItemKey&&item.condition!=="good")&&validOwnerClaimReceipt(saved.ownerClaimAuthorizedAt);
      if ((!sameFrozenDecision&&!mayAttachHoldDamageEvidence) || JSON.stringify(savedEvidence)!==JSON.stringify(newEvidence)&&!mayAttachLateEvidence&&!mayAttachHoldDamageEvidence)
        throw new Error("A return settlement is already in progress with different amounts. Resume the saved decision or contact support before changing it.");
      if(mayAttachLateEvidence)await ctx.db.patch(bookingId,{returnDecision:{...saved,claimEvidenceIds}});
      if(mayAttachHoldDamageEvidence)await ctx.db.patch(bookingId,{returnDecision:{...saved,claimItemKey,claimEvidenceIds}});
      if (ownerClaimRequired) {
        if (validOwnerClaimReceipt(saved.ownerClaimAuthorizedAt)) {
          if (ownerClaimAuthorizedAt !== undefined && ownerClaimAuthorizedAt !== saved.ownerClaimAuthorizedAt)
            throw Error("The saved owner-claim authorization receipt cannot be changed.");
        } else if (saved.ownerClaimAuthorizedAt === undefined && validOwnerClaimReceipt(ownerClaimAuthorizedAt)) {
          // A legacy in-progress decision may acquire its receipt only after
          // markReturned has revalidated the owner token and the exact frozen terms.
          await ctx.db.patch(bookingId, { returnDecision: { ...saved, ownerClaimAuthorizedAt } });
        } else {
          throw Error("The saved money claim has no valid owner-authorization receipt.");
        }
      } else if (saved.ownerClaimAuthorizedAt !== undefined || ownerClaimAuthorizedAt !== undefined) {
        throw Error("A clean return cannot carry an owner-claim authorization receipt.");
      }
      const holdDamageClaim = !hasCashDepositPolicy(b.securityPolicyVersion) && !isSavedCardRental(b) && (b.depositHoldAmount ?? 0) > 0 && saved.damageKept > 0;
      if (holdDamageClaim) {
        const selectedItemKey = saved.claimItemKey ?? claimItemKey;
        const item = (saved.inspection ?? inspected ?? []).find((entry: any) => entry.key === selectedItemKey && entry.condition !== "good");
        const evidenceIds = saved.claimEvidenceIds?.length ? saved.claimEvidenceIds : claimEvidenceIds;
        if (!item || !evidenceIds?.length || !validOwnerClaimReceipt(saved.ownerClaimAuthorizedAt ?? ownerClaimAuthorizedAt)) throw Error("The saved card-hold claim needs its item, evidence and owner authorization before it can resume.");
        const account = b.accountId ? await ctx.db.get(b.accountId) : await accountForRental(ctx, b);
        const caseRecord = await ensureReturnDamageCase(ctx, { bookingId, accountId: account?._id, item, actualReturnedAt: saved.actualReturnedAt, damageKept: saved.damageKept, damageNote: saved.damageNote, claimBasis: saved.claimBasis, claimEvidenceIds: evidenceIds, claimCaseId: saved.claimCaseId });
        const current = await ctx.db.get(bookingId);
        if (current?.returnDecision && current.returnDecision.claimCaseId !== caseRecord._id) {
          await ctx.db.patch(bookingId, { returnDecision: { ...current.returnDecision, claimCaseId: caseRecord._id } });
          await queueRmv2Sync(ctx, bookingId);
        }
      }
      return;
    }
    if (ownerClaimRequired && !validOwnerClaimReceipt(ownerClaimAuthorizedAt))
      throw Error("An owner-claim authorization receipt is required before freezing a money claim.");
    if (!ownerClaimRequired && ownerClaimAuthorizedAt !== undefined)
      throw Error("A clean return cannot carry an owner-claim authorization receipt.");
    const holdDamageClaim = !hasCashDepositPolicy(b.securityPolicyVersion) && !isSavedCardRental(b) && (b.depositHoldAmount ?? 0) > 0 && damageKept > 0;
    const selectedHoldDamageItem = holdDamageClaim ? inspected?.find((item: any) => item.key === claimItemKey && item.condition !== "good") : undefined;
    if (holdDamageClaim && (!selectedHoldDamageItem || !claimEvidenceIds?.length)) throw Error("A card-hold damage claim needs an inspected item and attached evidence before settlement.");
    await ctx.db.patch(bookingId, { returnDecision: { actualReturnedAt, damageKept, depositKept, claimBasis, expectedSnapshot, damageNote, claimItemKey, claimEvidenceIds, chargeLate, lateWaiverReason, lateClaimReason, lateClaimPolicyVersion: "owner-claim-v1", ...(ownerClaimAuthorizedAt !== undefined ? { ownerClaimAuthorizedAt } : {}), inspection: inspected as any, startedAt: Date.now() } });
    const hasHoldIntent=!!(b.stripeDepositIntentId||b.depositHoldRenewalIntentId||(b.depositHoldPreviousIntentIds??[]).length);
    const savedCardHoldReturn=isSavedCardRental(b)&&hasHoldIntent&&(!ownerClaimRequired||validOwnerClaimReceipt(ownerClaimAuthorizedAt??b.returnDecision?.ownerClaimAuthorizedAt));
    if(hasCashDepositPolicy(b.securityPolicyVersion)&&b.depositAmount>0 || hasHoldIntent&&damageKept===0&&(depositKept??0)===0&&!chargeLate || savedCardHoldReturn)await ctx.scheduler.runAfter(120000,internal.checkout.recoverDepositReturn,{bookingId,attempt:0});
    const accountId = b.accountId ?? (await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", (b.guestEmail ?? "").trim().toLowerCase())).first())?._id;
    let openedCase = false;
    for (const item of inspected ?? []) {
      const isClaimItem = holdDamageClaim && item.key === claimItemKey;
      if (isClaimItem) {
        const caseRecord = await ensureReturnDamageCase(ctx, { bookingId, accountId, item, actualReturnedAt, damageKept, damageNote, claimBasis, claimEvidenceIds });
        const current = await ctx.db.get(bookingId);
        if (current?.returnDecision) await ctx.db.patch(bookingId, { returnDecision: { ...current.returnDecision, claimCaseId: caseRecord._id } });
        openedCase = true;
      } else if (item.openCase) {
        const openedAt = Date.now();
        const caseId = await ctx.db.insert("rental_damage_cases", { bookingId, accountId, itemKey: item.key, title: item.title, inventoryUnitId: item.inventoryUnitId as any, details: item.details, status: "open", openedAt });
        await archiveCaseConversation(ctx, { _id: caseId, bookingId, accountId, openedAt });
        openedCase = true;
      }
    }
    if (openedCase) await queueRmv2Sync(ctx, bookingId);
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
      securityHoldPolicyVersion: b.securityHoldPolicyVersion,
    };
  },
});

export const securityHoldWebhookContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      status: b.status,
      amount: b.depositHoldAmount ?? 0,
      intentId: b.stripeDepositIntentId ?? null,
      holdStatus: b.depositHoldStatus ?? null,
      securityPolicyVersion: b.securityPolicyVersion ?? null,
      checkoutSessionId: b.stripeCheckoutSessionId ?? null,
      checkoutPaymentIntentId: b.stripePaymentIntentId ?? null,
      cancellationPending: !!b.cancellationDecision,
      returnPending: !!b.returnDecision,
    };
  },
});

export const reconcileSecurityHoldWebhook = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    intentId: v.string(),
    expectedAmountPence: v.number(),
    status: v.union(v.literal("held"), v.literal("requires_action"), v.literal("failed"), v.literal("released"), v.literal("captured")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const b = await ctx.db.get(args.bookingId);
    if (!b || !["pending_verification", "confirmed", "active"].includes(b.status) ||
      b.cancellationDecision || b.returnDecision || b.securityPolicyVersion !== CARD_HOLD_SECURITY_POLICY_VERSION ||
      b.stripeDepositIntentId !== args.intentId || !Number.isSafeInteger(args.expectedAmountPence) ||
      args.expectedAmountPence !== Math.round((b.depositHoldAmount ?? 0) * 100)) return false;
    if (b.depositHoldStatus === "captured" && args.status !== "captured") return false;
    if (args.status === "held" && (!Number.isFinite(args.expiresAt) || args.expiresAt! <= Date.now())) return false;
    if (b.depositHoldStatus === args.status && b.depositHoldExpiresAt === args.expiresAt) return true;
    await ctx.db.patch(b._id, { depositHoldStatus: args.status, depositHoldExpiresAt: args.expiresAt });
    await queueRmv2Sync(ctx, b._id);
    return true;
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
    if (status !== b.depositHoldStatus || expiresAt !== b.depositHoldExpiresAt || (intentId && intentId !== b.stripeDepositIntentId)) await queueRmv2Sync(ctx, bookingId);
    if (status === "held" && b.depositHoldStatus !== "held" && b.verificationProvider === "didit" && b.idVerifyStatus === "required")
      await ctx.scheduler.runAfter(0, internal.didit.reuseVerification, { bookingId });
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
      accountId: b.accountId,
      cancellationPending: !!b.cancellationDecision, returnPending: !!b.returnDecision,
      amount: b.depositHoldAmount ?? 0, oldIntentId: b.stripeDepositIntentId ?? null,
      depositHoldStatus: b.depositHoldStatus ?? null,
      expiresAt: b.depositHoldExpiresAt ?? null,
      renewalIntentId: b.depositHoldRenewalIntentId ?? null,
      renewalStatus: b.depositHoldRenewalStatus ?? null,
      renewalAt: b.depositHoldRenewalAt ?? null,
      previousIntentIds: b.depositHoldPreviousIntentIds ?? [],
      securityHoldPolicyVersion: b.securityHoldPolicyVersion ?? null,
      pickupAt: b.securityHoldPickupAt ?? null,
      pickupRenewedForAt: b.securityHoldPickupRenewedForAt ?? null,
    };
  },
});

/** Provider reconciliation cannot update a superseded or settled hold. */
export const reconcileRenewedHold = internalMutation({
  args: { bookingId: v.id("bookings"), intentId: v.string(), status: v.string(), expiresAt: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.bookingId);
    if (!b || !["confirmed", "active"].includes(b.status) || b.cancellationDecision || b.returnDecision ||
      b.stripeDepositIntentId !== a.intentId || ["captured", "released"].includes(b.depositHoldStatus ?? "")) return false;
    if (!["held", "failed", "captured", "requires_action", "processing"].includes(a.status) ||
      (a.status === "held" && (!Number.isFinite(a.expiresAt) || a.expiresAt! <= Date.now()))) return false;
    if (b.depositHoldStatus === a.status && b.depositHoldExpiresAt === a.expiresAt) return true;
    await ctx.db.patch(b._id, { depositHoldStatus: a.status, depositHoldExpiresAt: a.expiresAt });
    await queueRmv2Sync(ctx, b._id);
    return true;
  },
});

export const claimRenewal = internalMutation({
  args: { bookingId: v.id("bookings"), force: v.optional(v.boolean()), pickupAt: v.optional(v.number()) },
  handler: async (ctx, { bookingId, force, pickupAt }) => {
    const b = await ctx.db.get(bookingId);
    const now = Date.now();
    const pickupRenewal = force === true && Number.isFinite(pickupAt) &&
      !!b && isCheckoutHoldPolicy(b) &&
      b.securityHoldPickupAt === pickupAt &&
      b.securityHoldPickupRenewedForAt !== pickupAt &&
      now >= pickupAt! - PICKUP_HOLD_RENEWAL_LEAD_MS && now < pickupAt!;
    if (!b || b.activeAdditionId || b.cancellationDecision || b.returnDecision || !["confirmed", "active"].includes(b.status) || !b.depositHoldAmount || b.depositHoldStatus !== "held" || !b.stripeDepositIntentId ||
      (!pickupRenewal && (b.depositHoldExpiresAt ?? 0) > now + 24 * 3600000) ||
      (force === true && !pickupRenewal) ||
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
  args: { bookingId: v.id("bookings"), oldIntentId: v.string(), newIntentId: v.string(), expiresAt: v.number(), pickupAt: v.optional(v.number()) },
  handler: async (ctx, { bookingId, oldIntentId, newIntentId, expiresAt, pickupAt }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.cancellationDecision || b.returnDecision || b.stripeDepositIntentId !== oldIntentId || !["confirmed", "active"].includes(b.status) ||
      ["captured", "released"].includes(b.depositHoldStatus ?? "") || !Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
      (pickupAt !== undefined && (!isCheckoutHoldPolicy(b) || b.securityHoldPickupAt !== pickupAt || b.securityHoldPickupRenewedForAt === pickupAt))) return false;
    await ctx.db.patch(bookingId, {
      stripeDepositIntentId: newIntentId,
      depositHoldStatus: "held",
      depositHoldExpiresAt: expiresAt,
      depositHoldRenewalIntentId: undefined,
      depositHoldRenewalStatus: "renewed",
      depositHoldRenewalAt: Date.now(),
      depositHoldPreviousIntentIds: [...(b.depositHoldPreviousIntentIds ?? []), oldIntentId],
      ...(pickupAt !== undefined ? { securityHoldPickupRenewedForAt: pickupAt } : {}),
    });
    // The renewed authorisation can restore collection readiness. Commit its
    // manager revision in this transaction before releasing the previous hold.
    await queueRmv2Sync(ctx, bookingId);
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

export const markVerificationConfirmationFailure = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking || !["pending_payment", "pending_verification"].includes(booking.status) || booking.verificationProvider !== "didit" || booking.idVerifyStatus !== "verified") return false;
    const issue = booking.verificationConfirmationIssue === "inventory_unavailable" ? "inventory_unavailable" : "provider_confirmation_failed";
    await ctx.db.patch(bookingId, { verificationConfirmationIssue: issue });
    const account = await accountForRental(ctx, booking);
    await queueOwnerNotification(ctx, {
      eventKey: `paid-confirmation-failed:${bookingId}`,
      kind: "verification_failure",
      ...(account ? { accountId: account._id } : {}),
      bookingId,
      title: issue === "inventory_unavailable" ? "Paid booking availability needs attention" : "Paid booking confirmation needs attention",
      body: issue === "inventory_unavailable"
        ? "Payment is recorded and Didit approved verification, but live Rental Manager stock still blocks confirmation. Open this rental; it remains unconfirmed."
        : "Payment is recorded and Didit approved verification, but automatic booking confirmation could not finish. Open this rental; it remains unconfirmed.",
    });
    return true;
  },
});

export const retryPaidDiditConfirmation = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking || booking.status !== "pending_verification" || booking.verificationProvider !== "didit" ||
        booking.idVerifyStatus !== "verified" || !Number.isFinite(booking.checkoutPaidAt) ||
        !booking.stripeCheckoutSessionId) return false;
    await ctx.scheduler.runAfter(0, internal.checkout.confirmAfterVerification, { bookingId });
    return true;
  },
});

/** Mark a booking returned + flip its reservations to returned (frees the inventory ledger). */
export const markReturnedStatus = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return;
    const expiredProposal = await expireUnacceptedItemSwap(ctx, b);
    const current = expiredProposal ? await ctx.db.get(bookingId) : b;
    if (!current) throw Error("Booking not found");
    await assertSwapStockReconciled(ctx, bookingId);
    await assertActiveItemSwapReady(ctx, current);
    const extensionRequests = await ctx.db.query("booking_change_requests")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId)).collect();
    const pendingExtensions = extensionRequests.filter((request) => request.type === "extend" && request.status === "pending");
    for (const request of pendingExtensions) {
      if (request.creditReservationId) await releaseRentalCredit(ctx, "extension", String(request._id));
      await ctx.db.patch(request._id, { status: "expired", resolvedAt: Date.now() });
    }
    if (pendingExtensions.length) {
      const account = await accountForRental(ctx, current);
      if (account) await postRentalMessage(ctx, {
        accountId: account._id,
        bookingId,
        sender: "system",
        text: "The extension request closed when the rental was marked returned before approval. The original rental dates and charges remain unchanged.",
      });
    }
    // These guards require the applied swap's RMV2 acknowledgement and a
    // risk-free receipt. Retire that completed fence with the return so its
    // immutable adjustment document can finish delivery afterward.
    const settledSwapId = current.activeItemSwapId;
    if (settledSwapId) {
      const swap = await ctx.db.get(settledSwapId);
      const stockReceipt = await ctx.db
        .query("swap_stock_applied_receipts")
        .withIndex("by_swap", (q) => q.eq("swapId", settledSwapId))
        .unique();
      if (
        !swap ||
        swap.bookingId !== current._id ||
        swap.status !== "applied" ||
        !stockReceipt ||
        stockReceipt.bookingId !== current._id ||
        stockReceipt.deliveryState !== "acknowledged" ||
        stockReceipt.stockRisk === true
      ) {
        throw Error("The equipment change still needs Rental Manager settlement before this rental can close.");
      }
    }
    if (expiredProposal) {
      const account = await accountForRental(ctx, b);
      if (account) await postRentalMessage(ctx, {
        accountId: account._id,
        bookingId,
        sender: "system",
        text: "The pending equipment-change offer closed when the rental was returned. Your original confirmed items and price remain unchanged.",
      });
    }
    const rentalClosedAt = current.returnedAt ?? current.actualReturnedAt ?? current.returnDecision?.actualReturnedAt ?? Date.now();
    if (current.status !== "returned" || settledSwapId || current.returnedAt == null) {
      await ctx.db.patch(bookingId, {
        ...(current.status !== "returned" ? { status: "returned" } : {}),
        returnedAt: current.returnedAt ?? rentalClosedAt,
        ...(settledSwapId ? { activeItemSwapId: undefined } : {}),
      });
    }
    const closedBooking = { ...current, status: "returned", returnedAt: current.returnedAt ?? rentalClosedAt };
    const trialCompletionAt = cleanRentalCompletionAt(closedBooking, false);
    if (trialCompletionAt !== undefined) {
      const rentalAccount = await accountForRental(ctx, current);
      if (rentalAccount) {
        await ctx.db.patch(rentalAccount._id, {
          firstCleanRentalCompletedAt: rentalAccount.firstCleanRentalCompletedAt ?? trialCompletionAt,
          ...(rentalAccount.membershipStatus === "trialing"
            ? { membershipTrialFirstRentalCompletedAt: rentalAccount.membershipTrialFirstRentalCompletedAt ?? trialCompletionAt }
            : {}),
          ...(rentalAccount.membershipPerksPendingBookingId === bookingId ? { membershipPerksPendingBookingId: undefined } : {}),
        });
      }
    }
    if (current.status !== "returned" && current.verificationProvider === "didit" && current.diditSessionId)
      await ctx.scheduler.runAfter(0, internal.didit.reconcileReturnedBooking, { bookingId });
    if (current.status !== "returned") await bumpVerificationRetentionRevision(ctx,current);
    const res = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    for (const r of res) if (["hold", "confirmed", "active"].includes(r.status)) await ctx.db.patch(r._id, { status: "returned" });
    await queueRmv2Sync(ctx, bookingId);
  },
});

/** Record that the deposit was released (depositKept = amount retained for damage). */
export const markDepositReleased = internalMutation({
  args: { bookingId: v.id("bookings"), kept: v.number(), refunded: v.number(), capturedFromHold: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, { bookingId, kept, refunded, capturedFromHold, note }) => {
    const booking = await ctx.db.get(bookingId);
    await ctx.db.patch(bookingId, { depositRefunded: true, depositKept: kept, depositRefundAmount: refunded, depositHoldCapturedForDamage: capturedFromHold, depositDeductionNote: note, returnedAt: booking?.returnedAt ?? booking?.actualReturnedAt ?? booking?.returnDecision?.actualReturnedAt ?? Date.now() });
    if (booking) await bumpVerificationRetentionRevision(ctx,booking);
  },
});

const lateLine = v.object({ title: v.string(), days: v.number(), dailyRate: v.number(), amount: v.number() });

export const recordLateFee = internalMutation({
  args: { bookingId: v.id("bookings"), actualReturnedAt: v.number(), amount: v.number(), breakdown: v.array(lateLine), waivedAmount: v.optional(v.number()), waiverReason: v.optional(v.string()) },
  handler: async (ctx, { bookingId, actualReturnedAt, amount, breakdown, waivedAmount, waiverReason }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.actualReturnedAt) return;
    if (amount > 0 && b.returnDecision?.lateClaimPolicyVersion === "owner-claim-v1" &&
      (!b.returnDecision.chargeLate || (b.returnDecision.lateClaimReason ?? "").trim().length < 10))
      throw Error("A late amount needs an explicit claim and reason before it can be recorded.");
    await ctx.db.patch(bookingId, {
      actualReturnedAt,
      lateFeeAmount: amount,
      lateFeeWaivedAmount: waivedAmount,
      lateFeeWaiverReason: waiverReason,
      lateFeeClaimReason: amount > 0 ? b.returnDecision?.lateClaimReason : undefined,
      lateFeeBreakdown: breakdown,
      lateFeeStatus: amount > 0 ? isSavedCardRental(b) ? "admin_review" : "notice_pending" : waivedAmount ? "waived" : "none",
      ...(isSavedCardRental(b)&&amount===0&&!b.returnDecision?.damageKept&&b.returnDecision?.inspection?.length&&b.returnDecision.inspection.every(item=>item.condition==='good')?{savedCardStatus:"closed"}:{}),
    });
    const customer = b.customerId ? await ctx.db.get(b.customerId) : null;
    const refundJobs=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
    const issuedAt = Date.now();
    await ctx.db.patch(bookingId, {
      returnStatement: {
        number: `DBC-R-${String(bookingId).toUpperCase()}`, issuedAt, actualReturnedAt,
        agreedReturnTime: b.returnTime,
        supplierName: "DB Cinema Rentals",
        supplierAddress: undefined,
        customerName: b.guestName || b.agreementName || customer?.name || undefined,
        customerEmail: b.guestEmail ?? "",
        billingAddress: b.billingAddress ?? b.address,
        lineItems: rentalBillingLines(b),
        subtotal: b.subtotal, discount: b.discount ?? 0, deliveryFee: b.deliveryFee ?? 0, sameDayFee: b.sameDayFee ?? 0,
        creditApplied: b.creditApplied ?? 0, checkoutPaid: b.total, rentalRefunded:confirmedRentalRefundPence(refundJobs)/100,
        securityPaid: b.depositAmount, securityRefunded: b.depositRefundAmount ?? 0,
        ...(hasCashDepositPolicy(b.securityPolicyVersion)?depositRefundStatementFields(b):{}),
        holdStatus: b.depositHoldStatus,
        ...(b.depositHoldAmount !== undefined ? { holdAmount: b.depositHoldAmount } : {}),
        damageTotal: isCardHoldSecurityPolicy(b.securityPolicyVersion) ? b.depositHoldCapturedForDamage ?? 0 : b.depositKept ?? 0,
        damageFromHold: b.depositHoldCapturedForDamage ?? 0,
        ...(isSavedCardRental(b)?{securityPolicyVersion:b.securityPolicyVersion,...(b.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION?{}:{savedCardLimit:b.savedCardLimit}),damageAssessed:b.returnDecision?.damageKept??0}:isCardHoldSecurityPolicy(b.securityPolicyVersion)?{securityPolicyVersion:b.securityPolicyVersion,damageAssessed:b.returnDecision?.damageKept??0}:{}),
        damageNote: b.depositDeductionNote,
        inspection: b.returnDecision?.inspection,
        lateAssessed: amount, lateWaived: waivedAmount ?? 0, lateClaimReason: amount > 0 ? b.returnDecision?.lateClaimReason : undefined, lateBreakdown: breakdown,
      },
      returnStatementEmailStatus: "pending",
    });
    if (amount > 0 && !isSavedCardRental(b)) await ctx.scheduler.runAfter(0, internal.lateFees.sendNotice, { bookingId });
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
      securityPolicyVersion:b.securityPolicyVersion,
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
    if (!b) return false;
    if (b.status !== "returned" || !["notice_sent", "charging"].includes(b.lateFeeStatus ?? "") ||
      !b.lateFeeAmount || !b.lateFeeNoticeAt || b.lateFeeNoticeAt > Date.now() - 7 * 86400000) return false;
    if (b?.actualReturnedAt && Date.now() > b.actualReturnedAt + 30 * 86400000) {
      await ctx.db.patch(bookingId, { lateFeeStatus: "expired", lateFeeNote: "30-day collection window elapsed" });
      return false;
    }
    const decision = b.returnDecision;
    const reason = decision?.lateClaimReason?.trim() ?? "";
    let expectedLate: ReturnType<typeof lateFeeQuote> | undefined;
    if (decision?.lateClaimPolicyVersion === "owner-claim-v1" && decision.chargeLate === true && reason.length >= 10 &&
      typeof decision.ownerClaimAuthorizedAt === "number" && Number.isSafeInteger(decision.ownerClaimAuthorizedAt) && decision.ownerClaimAuthorizedAt > 0 &&
      decision.actualReturnedAt === b.actualReturnedAt && b.lateFeeClaimReason === reason) {
      try { expectedLate = lateFeeQuote(b.lineItems, b.returnTime ?? null, decision.actualReturnedAt); }
      catch { expectedLate = undefined; }
    }
    const matchesFrozenClaim = expectedLate !== undefined && Math.round(b.lateFeeAmount * 100) === Math.round(expectedLate.amount * 100) &&
      Array.isArray(b.lateFeeBreakdown) && b.lateFeeBreakdown.length === expectedLate.breakdown.length &&
      b.lateFeeBreakdown.every((line: any, index: number) => {
        const expected = expectedLate!.breakdown[index];
        return line.title === expected.title && line.days === expected.days && line.dailyRate === expected.dailyRate &&
          Math.round(line.amount * 100) === Math.round(expected.amount * 100);
      });
    if (!matchesFrozenClaim) {
      await ctx.db.patch(bookingId, {
        lateFeeStatus: "admin_review",
        lateFeeNote: "Automatic collection stopped because the saved owner-authorized claim or itemized calculation did not match.",
      });
      await queueOwnerNotification(ctx, {
        eventKey: `late-claim-review:${bookingId}`,
        kind: "checkout_failure",
        accountId: b.accountId,
        bookingId,
        title: "Late-fee claim needs review",
        body: "Automatic collection stopped because the saved owner claim or itemized calculation did not match this rental.",
      });
      return false;
    }
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
      if (b.status === "confirmed" && (b.idVerifyStatus !== "verified" || bookingVerificationExpired(b))) continue;
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
  handler: async (ctx,{bookingId}) => {
    const booking=await ctx.db.get(bookingId);if(!booking)return null;
    const account=await accountForRental(ctx,booking);
    const customer=booking.customerId?await ctx.db.get(booking.customerId):null;
    return {...booking,guestEmail:account?.email??(booking.accountId?null:booking.guestEmail),invoiceCustomerName:booking.guestName??customer?.name??account?.name??null};
  },
});

/** First issue freezes the paid invoice payload. Later equipment, delivery and
 * return changes are recorded separately and cannot rewrite this snapshot. */
export const saveInitialInvoiceSnapshot=internalMutation({
  args:{bookingId:v.id("bookings"),snapshot:v.any()},
  handler:async(ctx,{bookingId,snapshot})=>{
    const booking=await ctx.db.get(bookingId);if(!booking)throw Error("Rental invoice is unavailable.");
    if(booking.invoiceSnapshot)return booking.invoiceSnapshot;
    const operatorEvidence=booking.cancellationDecision?.operatorOfferId?await ctx.db.get(booking.cancellationDecision.operatorOfferId):null;
    const confirmedCancelled=booking.status==="cancelled"&&!!(booking.paidConfirmedAt||booking.creditIssuedId||operatorEvidence?.bookingId===booking._id&&operatorEvidence.accountId===booking.accountId);
    if(booking.status==="pending_payment"||(!booking.stripePaymentIntentId&&!(["confirmed","active","returned"].includes(booking.status)||confirmedCancelled)))throw Error("Only a settled rental can issue an invoice snapshot.");
    const sameMoney=(value:any,expected:any)=>Number.isFinite(value)&&Number.isFinite(expected)&&Math.round(value*100)===Math.round(expected*100);
    if(!snapshot||snapshot.number!==`DBC-${String(booking._id).slice(-8).toUpperCase()}`||!Array.isArray(snapshot.lineItems)||JSON.stringify(snapshot.lineItems)!==JSON.stringify(rentalBillingLines(booking))||!sameMoney(snapshot.subtotal,booking.subtotal)||!sameMoney(snapshot.total,booking.total)||!sameMoney(snapshot.depositAmount,booking.depositAmount)||!Number.isSafeInteger(snapshot.issuedAt))throw Error("The rental changed while its invoice was being prepared. Retry the invoice.");
    await ctx.db.patch(bookingId,{invoiceSnapshot:snapshot});
    return snapshot;
  },
});

/** Notification summary is internal: booking IDs never authorise customer-data access. */
export const get = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const account=await accountForRental(ctx,b);
    return {
      _id: b._id,
      status: b.status,
      checkoutPaidAt: b.checkoutPaidAt ?? null,
      lineItems: b.lineItems,
      subtotal: b.subtotal,
      depositAmount: b.depositAmount,
      depositHoldAmount: b.depositHoldAmount ?? 0,
      depositHoldStatus: b.depositHoldStatus ?? null,
      securityPolicyVersion:b.securityPolicyVersion??null,savedCardStatus:b.savedCardStatus??null,savedCardLimit:b.savedCardLimit??null,
      deliveryFee: b.deliveryFee,
      total: b.total,
      currency: b.currency,
      fulfilment: b.fulfilment,
      pickupTime: b.pickupTime ?? null,
      returnTime: b.returnTime ?? null,
      guestEmail: account?.email??(b.accountId?null:b.guestEmail),
      idVerifyStatus: b.idVerifyStatus ?? "required",
      idVerificationSource: b.idVerificationSource ?? null,
      verificationChecks: b.verificationChecks ?? null,
      idVerifiedAt: b.idVerifiedAt ?? null,
      paidConfirmedAt: b.paidConfirmedAt ?? null,
      verificationExpiresAt: verificationValidUntil(b),
      verificationLateOverrideAt: b.verificationLateOverrideAt ?? null,
      documentExpiresAt: b.documentExpiresAt ?? null,
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
    let adminAuthorized = false;
    if (token) {
      if (process.env.ADMIN_SESSION_BILLING_PORTAL_V2 === "enabled") {
        // Keep invoice detail access on the same read scope as its admin list.
        // Do not accept the legacy ADMIN_TOKEN when V2 is enabled.
        if (adminSessionMigrationReady()) {
          try {
            await assertAdminScopeSession(ctx, token, "payments:read");
            adminAuthorized = true;
          } catch {
            // The token may still be a renter session; check rental ownership below.
          }
        }
      } else {
        adminAuthorized = checkAdminToken(token);
      }
    }
    let ok = false;
    if (key && process.env.INVOICE_SECRET && key === process.env.INVOICE_SECRET) {
      ok = true;
    } else if (adminAuthorized) {
      ok = true;
    } else if (token) {
      const acct = await accountForToken(ctx, token, true);
      if (belongsToRentalAccount(b, acct)) ok = true;
    }
    if (!ok) return null;
    // A saved basket, captured payment, or pending verification is not by
    // itself authority to publish a rental invoice. The invoice contains the
    // precise collection address, so require the same verification gate as
    // renter-facing booking confirmation, in addition to settled payment.
    const verificationApproved = b.verificationProvider !== "didit" || hasBookingDiditApproval(b);
    const confirmedStatus = ["confirmed", "active", "returned"].includes(b.status);
    if (!verificationApproved || !confirmedStatus && b.status !== "cancelled") return null;

    // Keep receipts for settled rentals after cancellation/refund, while not
    // treating a pending-verification PaymentIntent as a completed rental.
    const operatorEvidence=b.cancellationDecision?.operatorOfferId?await ctx.db.get(b.cancellationDecision.operatorOfferId):null;
    const confirmedCancelled=b.status==="cancelled"&&!!(b.paidConfirmedAt||b.creditIssuedId||operatorEvidence?.bookingId===b._id&&operatorEvidence.accountId===b.accountId);
    const paymentSettled = typeof b.paidConfirmedAt === "number" && Number.isSafeInteger(b.paidConfirmedAt) && b.paidConfirmedAt > 0 ||
      confirmedStatus && typeof b.stripePaymentIntentId === "string" && b.stripePaymentIntentId.length > 0;
    if (!adminAuthorized && ((!confirmedStatus && !confirmedCancelled) || !paymentSettled)) return null;
    const handoverDetailsVisible = adminAuthorized || renterHandoverDetailsReady(b);
    const pickupDetailsVisible = b.fulfilment === "pickup" && handoverDetailsVisible;
    const customer: any = b.customerId ? await ctx.db.get(b.customerId) : null;
    const account = await accountForRental(ctx, b);
    const rentalRefunds=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
    const assessments=await ctx.db.query("rental_security_charges").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).take(101);
    if(assessments.length>100)throw Error("Assessment history requires review before issuing documents.");
    const assessmentClaims=await Promise.all(assessments.filter(row=>row.accountId===b.accountId&&!!b.accountId&&["notice_pending","notice_sent","uncertain","collecting","processing","requires_action","paid","failed"].includes(row.state)).map(async row=>{
      const files=await Promise.all((row.evidenceIds??[]).map(id=>ctx.db.get(id)));
      const item=(b.returnDecision?.inspection??[]).find((inspection:any)=>inspection.key===row.itemKey);
      return {id:row._id,kind:row.kind,reason:row.reason,...(item?{itemTitle:item.title,itemDetails:item.details}:{}),amount:row.amountPence/100,paid:(row.paidPence??0)/100,refunded:(row.refundedPence??0)/100,state:row.state,evidence:files.filter((file:any)=>file?.bookingId===bookingId&&file.accountId===b.accountId&&file.status==="published").map((file:any)=>({name:file.name??"Supporting evidence"}))};
    }));
    const assessmentPayments=assessmentClaims.filter(row=>row.state==="paid");
    const issuedCredit=b.creditIssuedId?await ctx.db.get(b.creditIssuedId):null;
    const issuedEvent=await ctx.db.query("credit_issues").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).unique();
    if(b.invoiceSnapshot)return {
      ...b.invoiceSnapshot,
      supplierAddress: undefined,
      pickupDetailsVisible,
      billingAddress: handoverDetailsVisible ? b.billingAddress??b.address??null : null,
      address: handoverDetailsVisible && b.fulfilment === "delivery" ? b.address ?? null : null,
      // The issued rental lines and original paid total are immutable, but the
      // current document view must show later settlements recorded against it.
      // Otherwise a saved first-issue snapshot hides refunds and credit issued
      // after the invoice was first generated.
      rentalRefunded:confirmedRentalRefundPence(rentalRefunds)/100,
      rentalRefunds:rentalRefunds.map(r=>({reference:rentalRefundReference(String(r._id)),amount:r.amountPence/100,status:r.status,reason:r.reason})),
      cancellationRefund:b.refundAmount??0,
      accountCreditIssued:issuedEvent?issuedEvent.amountPence/100:issuedCredit?.amount??0,
      accountCreditBonus:(issuedEvent?.bonusPence??0)/100,
      assessmentPayments,
      assessmentClaims,
      returnStatement:b.returnStatement?{...b.returnStatement,supplierName:"DB Cinema Rentals",supplierAddress:undefined,pickupDetailsVisible,rentalRefunded:b.returnStatement.rentalRefunded??confirmedRentalRefundPence(rentalRefunds)/100}:null,
    };
    return {
      rentalRefunded:confirmedRentalRefundPence(rentalRefunds)/100,
      assessmentPayments,
      assessmentClaims,
      billingAddress:handoverDetailsVisible ? b.billingAddress??b.address??null : null,
      rentalRefunds:rentalRefunds.map(r=>({reference:rentalRefundReference(String(r._id)),amount:r.amountPence/100,status:r.status,reason:r.reason})),
      cancellationRefund:b.refundAmount??0,accountCreditIssued:issuedEvent?issuedEvent.amountPence/100:issuedCredit?.amount??0,accountCreditBonus:(issuedEvent?.bonusPence??0)/100,
      number: `DBC-${String(b._id).slice(-8).toUpperCase()}`,
      agreementSnapshot: readAgreementSnapshot(b.agreementSnapshot),
      acceptedAgreementEvidence: {name:b.agreementName??null,signedAt:b.agreementSignedAt??null,documents:b.agreementDocs??[]},
      issuedAt: b._creationTime,
      supplierName: "DB Cinema Rentals",
      supplierAddress: undefined,
      pickupDetailsVisible,
      status: b.status,
      customerName: b.guestName ?? customer?.name ?? account?.name ?? null,
      email: b.guestEmail ?? null,
      fulfilment: b.fulfilment,
      address: handoverDetailsVisible && b.fulfilment === "delivery" ? b.address ?? null : null,
      currency: b.currency ?? "GBP",
      equipmentImages: await Promise.all(b.lineItems.map(async line => listingImages(await ctx.db.get(line.listingId)))),
      lineItems: rentalBillingLines(b),
      subtotal: b.subtotal,
      discount: b.discount ?? 0,
      deliveryFee: b.deliveryFee ?? 0,
      sameDayFee: b.sameDayFee ?? 0,
      creditApplied: b.creditApplied ?? 0,
      membershipCreditApplied: b.membershipCreditApplied ?? 0,
      depositAmount: b.depositAmount,
      depositHoldAmount: b.depositHoldAmount ?? 0,
      depositHoldStatus: b.depositHoldStatus ?? null,
      securityPolicyVersion:b.securityPolicyVersion??null,savedCardStatus:b.savedCardStatus??null,savedCardLimit:b.savedCardLimit??null,
      depositRefunded: b.depositRefunded ?? false,
      depositRefundAmount: b.depositRefundAmount ?? (b.depositRefunded ? null : 0),
      total: b.total,
      promoCode: b.promoCode ?? null,
      returnStatement: b.returnStatement ? {...b.returnStatement,supplierName:"DB Cinema Rentals",supplierAddress:undefined,pickupDetailsVisible,rentalRefunded:b.returnStatement.rentalRefunded??confirmedRentalRefundPence(rentalRefunds)/100} : null,
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

async function validatedReturnClaimEvidence(ctx: any, booking: any) {
  const decision = booking.returnDecision;
  const caseId = decision?.claimCaseId;
  const evidenceIds = decision?.claimEvidenceIds ?? [];
  const holdDamage = (booking.depositHoldCapturedForDamage ?? 0) > 0 || (booking.returnStatement?.damageFromHold ?? 0) > 0;
  if (!caseId) {
    if (holdDamage) throw Error("The return evidence is not linked to its permanent damage case.");
    return null;
  }
  if (!Array.isArray(evidenceIds) || evidenceIds.length < 1 || evidenceIds.length > 5 || new Set(evidenceIds.map(String)).size !== evidenceIds.length)
    throw Error("The return claim evidence is incomplete.");
  const caseRecord = await ctx.db.get(caseId);
  const item = (decision.inspection ?? []).find((entry: any) => entry.key === decision.claimItemKey && entry.condition !== "good");
  const expectedAmount = Math.round(Number(decision.damageKept) * 100);
  const expectedReason = decision.damageNote ?? item?.details;
  const exactEvidence = (left: any[], right: any[]) => JSON.stringify([...left].map(String).sort()) === JSON.stringify([...right].map(String).sort());
  if (!caseRecord || caseRecord.bookingId !== booking._id || caseRecord.itemKey !== decision.claimItemKey || !item ||
      caseRecord.claimAmountPence !== expectedAmount || caseRecord.claimReason !== expectedReason ||
      caseRecord.claimBasis !== decision.claimBasis || !exactEvidence(caseRecord.claimEvidenceIds ?? [], evidenceIds))
    throw Error("The return evidence does not match the frozen damage claim.");
  const archive = await ctx.db.query("chat_case_archives").withIndex("by_case", (q: any) => q.eq("caseId", caseId)).first();
  if (!archive || archive.bookingId !== booking._id || !await bookingHasCaseArchive(ctx, booking._id))
    throw Error("The return evidence is not protected by the rental case archive.");
  const account = await accountForRental(ctx, booking);
  if (!account) throw Error("The return evidence renter account is unavailable.");
  const files = [];
  let totalSize = 0;
  for (const id of evidenceIds) {
    const attempt = await ctx.db.get(id);
    if (!attempt || attempt.status !== "published" || attempt.accountId !== account._id || attempt.bookingId !== booking._id ||
        !attempt.storageId || !attempt.messageId || !attempt.sha256 || !attempt.name || !Number.isSafeInteger(attempt.size) ||
        attempt.size < 1 || attempt.size > CHAT_ATTACHMENT_LIMIT || !isChatImageType(attempt.contentType ?? ""))
      throw Error("A return evidence file is unavailable or belongs to a different rental.");
    const message = await ctx.db.get(attempt.messageId);
    const metadata = await ctx.db.system.get(attempt.storageId);
    const expectedHash = /^[a-f0-9]{64}$/.test(attempt.sha256)
      ? btoa(String.fromCharCode(...attempt.sha256.match(/../g)!.map((byte: string) => parseInt(byte, 16))))
      : null;
    if (!message || message.accountId !== account._id || message.bookingId !== booking._id || message.meta?.attachmentId !== attempt._id ||
        !metadata || metadata.contentType !== attempt.marker || metadata.size !== attempt.size || !expectedHash ||
        metadata.sha256 !== attempt.sha256 && metadata.sha256 !== expectedHash)
      throw Error("A return evidence file failed its ownership or integrity check.");
    totalSize += attempt.size;
    files.push({ storageId: attempt.storageId, name: attempt.name, contentType: attempt.contentType, size: attempt.size, sha256: attempt.sha256 });
  }
  if (totalSize > 12 * 1024 * 1024) throw Error("The return evidence bundle exceeds its safe delivery limit.");
  return { caseId, itemTitle: item.title, files };
}

function returnEvidenceSigningSecret() {
  return process.env.RETURN_EVIDENCE_LINK_SECRET?.trim() || process.env.INVOICE_SECRET?.trim() || "";
}

async function safeReturnClaimEvidence(ctx: any, booking: any) {
  try { return await validatedReturnClaimEvidence(ctx, booking); }
  catch { return null; }
}

export const returnStatementEvidenceContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking?.returnStatement || booking.status !== "returned") return null;
    const claim = await safeReturnClaimEvidence(ctx, booking);
    const secret = returnEvidenceSigningSecret();
    if (!claim || secret.length < 24) return null;
    const expiresAt = booking.returnStatement.issuedAt + RETURN_EVIDENCE_LINK_TTL_MS;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null;
    return {
      bookingId,
      caseId: claim.caseId,
      itemTitle: claim.itemTitle,
      fileCount: claim.files.length,
      expiresAt,
      recipientHash: await returnEvidenceRecipientHash(booking.returnStatement.customerEmail ?? "", secret),
    };
  },
});

export const returnEvidenceLinkFiles = internalQuery({
  args: {
    bookingId: v.id("bookings"), caseId: v.id("rental_damage_cases"), expiresAt: v.number(), recipientHash: v.string(),
    downloadExpiresAt: v.optional(v.number()), fileIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const secret = returnEvidenceSigningSecret();
    if (secret.length < 24) return null;
    if (!Number.isSafeInteger(args.expiresAt) || args.expiresAt <= now || !/^[a-f0-9]{64}$/.test(args.recipientHash)) return null;
    if (args.downloadExpiresAt !== undefined && (!Number.isSafeInteger(args.downloadExpiresAt) || args.downloadExpiresAt <= now || args.downloadExpiresAt > now + 15 * 60_000 || args.downloadExpiresAt > args.expiresAt)) return null;
    if ((args.fileIndex === undefined) !== (args.downloadExpiresAt === undefined) || args.fileIndex !== undefined && (!Number.isSafeInteger(args.fileIndex) || args.fileIndex < 0 || args.fileIndex > 4)) return null;
    const booking = await ctx.db.get(args.bookingId);
    if (!booking?.returnStatement || booking.status !== "returned" || args.expiresAt !== booking.returnStatement.issuedAt + RETURN_EVIDENCE_LINK_TTL_MS ||
        await returnEvidenceRecipientHash(booking.returnStatement.customerEmail ?? "", secret) !== args.recipientHash) return null;
    const claim = await safeReturnClaimEvidence(ctx, booking);
    if (!claim || claim.caseId !== args.caseId) return null;
    if (args.fileIndex === undefined) return { itemTitle: claim.itemTitle, files: claim.files.map(({ name, contentType, size }: any) => ({ name, contentType, size })) };
    const file = claim.files[args.fileIndex];
    return file ? { ...file, itemTitle: claim.itemTitle } : null;
  },
});

export const returnEvidenceAccessAttempt = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) return false;
    return (await bump(ctx, `return-evidence-email:${tokenHash}`, 5, 24 * 60 * 60_000)).allowed;
  },
});

export const claimReturnStatementEmail = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b?.returnStatement || b.returnStatementEmailStatus === "sent" || b.returnStatementEmailStatus === "delivery_unknown") return false;
    const now = Date.now();
    const attemptAt = b.returnStatementEmailAttemptAt ?? now;
    if (b.returnStatementEmailStatus === "sending" && attemptAt > now - 15 * 60000) return false;

    const legacyUnclassifiedFailure = b.returnStatementEmailStatus === "failed" && b.returnStatementEmailAmbiguous === undefined;
    const mayHaveBeenAccepted = b.returnStatementEmailStatus === "sending" || b.returnStatementEmailAmbiguous === true || legacyUnclassifiedFailure;
    const legacyKeyStart = b.returnStatementEmailIdempotencyStartedAt === undefined &&
      ["sending", "failed"].includes(b.returnStatementEmailStatus ?? "")
      ? b.returnStatement.issuedAt : undefined;
    const idempotencyStartedAt = b.returnStatementEmailIdempotencyStartedAt ?? legacyKeyStart ?? now;
    const expiredKey = now - idempotencyStartedAt >= 24 * 60 * 60_000;
    const expiredAmbiguousAttempt = b.returnStatementEmailStatus === "sending" && now - attemptAt >= 24 * 60 * 60_000;
    if (mayHaveBeenAccepted && (expiredKey || expiredAmbiguousAttempt)) {
      await ctx.db.patch(bookingId, {
        returnStatementEmailStatus: "delivery_unknown",
        returnStatementEmailAmbiguous: true,
        returnStatementEmailUnknownAt: now,
      });
      const account = await accountForRental(ctx, b);
      await queueOwnerNotification(ctx, {
        eventKey: `return-statement-delivery-unknown:${bookingId}`,
        kind: "email_failure",
        ...(account ? { accountId: account._id } : {}),
        bookingId,
        title: "Return statement delivery uncertain",
        body: "Resend’s 24-hour retry safety window passed without a confirmed result. Automatic sending has stopped; check Resend before contacting the renter again.",
      });
      return false;
    }

    // Definite provider rejections remain retryable indefinitely. Once their
    // old idempotency record has expired, start a fresh window before retrying.
    const restartExpiredRejectedKey = b.returnStatementEmailAmbiguous === false && expiredKey;
    await ctx.db.patch(bookingId, {
      returnStatementEmailStatus: "sending",
      returnStatementEmailAttemptAt: now,
      returnStatementEmailIdempotencyStartedAt: restartExpiredRejectedKey ? now : idempotencyStartedAt,
    });
    return true;
  },
});

export const markReturnStatementEmail = internalMutation({
  args: { bookingId: v.id("bookings"), sent: v.boolean(), ambiguous: v.optional(v.boolean()) },
  handler: async (ctx, { bookingId, sent, ambiguous }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.returnStatementEmailStatus !== "sending") return;
    const uncertain = !sent && ambiguous === true;
    await ctx.db.patch(bookingId, {
      returnStatementEmailStatus: sent ? "sent" : "failed",
      returnStatementEmailAmbiguous: uncertain,
      returnStatementEmailedAt: sent ? Date.now() : undefined,
      returnStatementEmailUnknownAt: undefined,
    });
    const account = await accountForRental(ctx,b);
    if(account) await queueOwnerNotification(ctx,{eventKey:`statement-email:${bookingId}:${sent ? "sent" : b.returnStatementEmailAttemptAt}`,kind:sent?"email_sent":"email_failure",accountId:account._id,bookingId,title:sent?"Return statement emailed":uncertain?"Return statement delivery uncertain":"Return statement email needs attention",body:sent?"The return statement was accepted for email delivery.":uncertain?"Resend did not confirm whether the return statement was accepted; retries remain protected by the same idempotency key.":"The provider rejected the return statement email; it remains retryable."});
  },
});

export const dueReturnStatementEmails = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Keep separate bounded indexed lanes for each eligible state. Claiming a
    // row advances its attempt timestamp, so old failed rows move behind newer
    // work instead of monopolising every hourly batch.
    const batch = 20;
    const pendingOrFailed = async (state: "pending" | "failed") => {
      const rows = await ctx.db.query("bookings")
        .withIndex("by_status_return_statement_email_attempt", (q) =>
          q.eq("status", "returned").eq("returnStatementEmailStatus", state))
        .order("asc").take(batch);
      return rows.filter((booking) => booking.returnStatement).map((booking) => booking._id);
    };
    const staleSending = async () => {
      const rows = await ctx.db.query("bookings")
        .withIndex("by_status_return_statement_email_attempt", (q) =>
          q.eq("status", "returned").eq("returnStatementEmailStatus", "sending").lte("returnStatementEmailAttemptAt", now - 15 * 60000))
        .order("asc").take(batch);
      return rows.filter((booking) => booking.returnStatement).map((booking) => booking._id);
    };
    const [pending, failed, sending] = await Promise.all([
      pendingOrFailed("pending"), pendingOrFailed("failed"), staleSending(),
    ]);
    return [...pending, ...failed, ...sending];
  },
});

async function legacyIdentityAccessAllowed(ctx:any,b:any,token?:string,checkoutSessionId?:string) {
  if(token){const account=await accountForToken(ctx,token,true);if(account && (b.accountId || Number.isFinite(account.emailVerifiedAt) && account.emailVerifiedAt>0)){try{await ownedBooking(ctx,account,b._id);return true;}catch{}}}
  if(checkoutSessionId && b.stripeCheckoutSessionId === checkoutSessionId){const account=await accountForRental(ctx,b);return (!b.accountId || !!account) && account?.blockedAt==null;}
  return false;
}

export const getIdentity = internalQuery({
  args: { bookingId: v.id("bookings"), token:v.optional(v.string()), checkoutSessionId:v.optional(v.string()) },
  handler: async (ctx, { bookingId, token, checkoutSessionId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || !["confirmed","active"].includes(b.status) || !isLegacyStripeIdentity(b)) return null;
    if(!await legacyIdentityAccessAllowed(ctx,b,token,checkoutSessionId))return null;
    return {
      sessionId: b.stripeIdentitySessionId ?? null,
      status: b.idVerifyStatus ?? "required",
      verificationProvider: b.verificationProvider ?? "stripe",
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
      idVerifyStatus: b.idVerifyStatus, diditSessionId: b.diditSessionId, verificationInProgressFrom: b.verificationInProgressFrom ?? null,
      lineItems: b.lineItems, pickupTime: b.pickupTime ?? null,
      verificationLateOverrideAt: b.verificationLateOverrideAt ?? null,
      verificationLateBlockedAt: b.verificationLateBlockedAt ?? null,
      verificationLateBlockedEventAt: b.verificationLateBlockedEventAt ?? null,
      verificationLateBlockedDecisionAt: b.verificationLateBlockedDecisionAt ?? null,
      verificationLateBlockedEventId: b.verificationLateBlockedEventId ?? null,
      verificationLateBlockedProviderStatus: b.verificationLateBlockedProviderStatus ?? null,
      idVerificationSource: b.idVerificationSource, diditEventId: b.diditEventId ?? null,
      diditReviewClaim: b.diditReviewClaim ?? null,
      diditEventAt: b.diditEventAt ?? null, diditManualDecisionAt: b.diditManualDecisionAt ?? null,
      diditDecisionAt: b.diditDecisionAt ?? null,
      verificationChecks: b.verificationChecks ?? null,
      verificationNote: b.verificationNote ?? null,
      verificationConfirmationIssue: b.verificationConfirmationIssue ?? null,
      checkoutPaidAt: b.checkoutPaidAt ?? null,
      checkoutPaymentStatus: b.checkoutPaymentStatus ?? null,
      returnedAt: b.returnedAt ?? null,
      identityRiskNotice: b.identityRiskNotice ?? null,
      documentExpiresAt: b.documentExpiresAt ?? null,
      verificationExpiresAt: verificationValidUntil(b),
      renterPersonKey: b.renterPersonKey ?? null,
      accountId: b.accountId, depositHoldAmount: b.depositHoldAmount, depositHoldStatus: b.depositHoldStatus,
      securityHoldPolicyVersion: b.securityHoldPolicyVersion, cancellationDecision:b.cancellationDecision, returnDecision:b.returnDecision,
      stripeCheckoutSessionId: b.stripeCheckoutSessionId, stripePaymentIntentId:b.stripePaymentIntentId,
      renterName: b.agreementName || customer?.name, billingAddress: b.billingAddress };
  },
});

/** Serialize progress reads so concurrent tabs cannot flood the provider. */
export const claimDiditProgressRefresh = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string() },
  handler: async (ctx, { bookingId, sessionId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.diditSessionId !== sessionId || !diditSessionRefreshAllowed(b)) return false;
    const now = Date.now();
    const retryingPaidConfirmation = b.status === "pending_verification" && b.idVerifyStatus === "verified";
    if ((b.diditReconciledAt ?? 0) > now - (retryingPaidConfirmation ? 5 * 60000 : 15000)) return false;
    await ctx.db.patch(bookingId, { diditReconciledAt: now });
    return true;
  },
});

export const markDiditReconciled = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string(), attemptedAt: v.number(), sweepGeneration: v.optional(v.number()) },
  handler: async (ctx, { bookingId, sessionId, attemptedAt, sweepGeneration }) => {
    if (sweepGeneration !== undefined && !(await currentDiditSweep(ctx, sweepGeneration))) return;
    const b = await ctx.db.get(bookingId);
    if (b?.diditSessionId === sessionId)
      await ctx.db.patch(bookingId, { diditReconciledAt: attemptedAt });
  },
});

export const flagDiditProcessingFailure = internalMutation({
  args:{bookingId:v.id("bookings"),sessionId:v.string(),sweepGeneration:v.optional(v.number())},
  handler:async(ctx,{bookingId,sessionId,sweepGeneration})=>{
    if (sweepGeneration !== undefined && !(await currentDiditSweep(ctx, sweepGeneration))) return;
    const booking=await ctx.db.get(bookingId);
    if(!booking||booking.verificationProvider!=="didit"||booking.diditSessionId!==sessionId)return;
    const account=await accountForRental(ctx,booking);
    await queueOwnerNotification(ctx,{eventKey:`didit-processing-failed:${bookingId}:${sessionId}:${Math.floor(Date.now()/86400000)}`,kind:"verification_failure",...(account?{accountId:account._id}:{}),bookingId,title:"Verification update needs attention",body:"Verification processing could not complete. Open the rental and check its status."});
  },
});

export const flagCheckoutSessionFailure = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking || booking.status !== "pending_payment" || booking.stripeCheckoutSessionId) return;
    const eventKey = `checkout-session-failed:${bookingId}`;
    if (await ctx.db.query("admin_notifications").withIndex("by_event", q => q.eq("eventKey", eventKey)).first()) return;
    const window = Math.floor(Date.now() / 900000);
    const allowed = await bump(ctx, "checkout-session-alerts", 10, 900000);
    if (!allowed.allowed) {
      await queueOwnerNotification(ctx, { eventKey: `checkout-session-failures:${window}`, kind: "checkout_failure", bookingId, title: "Multiple checkouts need attention", body: "Checkout sessions could not be opened. Check payment-provider health and pending rentals before retrying." });
      return;
    }
    await queueOwnerNotification(ctx, { eventKey, kind: "checkout_failure", ...(booking.accountAccessRequired === false && booking.accountId ? { accountId: booking.accountId } : {}), bookingId, title: "Checkout could not open", body: "The payment page could not be confirmed. Check the provider and rental before advising a retry." });
  },
});

export const flagDiditWebhookRejection = internalMutation({
  args:{reason:v.union(v.literal("configuration"),v.literal("signature"),v.literal("timestamp"),v.literal("provider_context"),v.literal("payload"),v.literal("booking_binding")),
    bookingId:v.optional(v.string()),sessionRef:v.optional(v.string()),eventRef:v.optional(v.string()),providerStatus:v.optional(v.string())},
  handler:async(ctx,{reason,bookingId,sessionRef,eventRef,providerStatus})=>{
    const window=Math.floor(Date.now()/3600000);
    const normalizedBookingId=bookingId?ctx.db.normalizeId("bookings",bookingId):null;
    const booking=normalizedBookingId?await ctx.db.get(normalizedBookingId):null;
    const account=booking?await accountForRental(ctx,booking):null;
    const body = reason === "booking_binding"
      ? `A signed Didit callback did not match the current booking/session. No renter verification state was changed.${providerStatus?` Provider status: ${providerStatus}.`:""}${sessionRef?` Session ref: ${sessionRef}.`:""}${eventRef?` Event ref: ${eventRef}.`:""} Check this rental’s current Didit session; paid pending rentals are reconciled from Didit automatically.`
      : `A Didit callback was rejected (${reason}). No renter verification state was changed. Check the Didit webhook configuration and Convex logs.`;
    await queueOwnerNotification(ctx,{eventKey:`didit-webhook-rejected:${reason}:${normalizedBookingId??"global"}:${window}`,kind:"verification_failure",
      ...(account?{accountId:account._id}:{}),...(normalizedBookingId?{bookingId:normalizedBookingId}:{}),title:"Didit webhook rejected",body});
  },
});

export const flagDiditOpeningFailure = internalMutation({
  args: {bookingId:v.id("bookings"),sessionId:v.optional(v.string())},
  handler: async (ctx,{bookingId,sessionId}) => {
    const booking=await ctx.db.get(bookingId);
    if(!booking||booking.verificationProvider!=="didit"||!verificationBookingOpen(booking.status)||
      booking.diditSessionId!==sessionId||!verificationSessionCanOpen(booking))return;
    const account=await accountForRental(ctx,booking);
    await queueOwnerNotification(ctx,{eventKey:`didit-opening-failed:${bookingId}:${Math.floor(Date.now()/900000)}`,kind:"verification_failure",...(account?{accountId:account._id}:{}),bookingId,title:"Verification could not open",body:"A renter could not open verification. Check this rental's verification progress."});
  },
});

export const setIdentity = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    expectedSessionId: v.string(),
    token:v.optional(v.string()),
    checkoutSessionId:v.optional(v.string()),
    status: v.string(),
  },
  handler: async (ctx, { bookingId, expectedSessionId, token, checkoutSessionId, status }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking || !isLegacyStripeIdentity(booking)) throw Error("Stripe Identity is not available for this rental.");
    if (!expectedSessionId || booking.stripeIdentitySessionId !== expectedSessionId) throw Error("Stripe Identity session changed. Refresh the rental and try again.");
    if (!["confirmed","active"].includes(booking.status) || !await legacyIdentityAccessAllowed(ctx,booking,token,checkoutSessionId)) throw Error("Stripe Identity is not available for this rental.");
    const prev = booking.idVerifyStatus ?? "required";
    const patch: any = { idVerifyStatus: status, idVerifiedAt: status === "verified" ? Date.now() : undefined, verificationExpiresAt: status === "verified" ? Date.now() + VERIFICATION_REUSE_DAYS * 86400000 : undefined };
    await ctx.db.patch(bookingId, patch);
    if (status === "verified") await markAccountVerified(ctx, bookingId);
    else await revokeReuse(ctx, bookingId);
    await verificationUpdateMessage(ctx, bookingId, prev, status);
    if (status !== prev && ["verified", "requires_input", "canceled"].includes(status))
      await queueRentalEmail(ctx,bookingId,"verification",{verificationStatus:status});
  },
});

/** Bind a Didit session to the paid booking before any result can be accepted. */
export const setDiditSession = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string(), previousSessionId: v.optional(v.string()), claimId: v.optional(v.string()) },
  handler: async (ctx, { bookingId, sessionId, previousSessionId, claimId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.verificationProvider !== "didit" || !verificationBookingOpen(b.status) ||
        !verificationSessionCanOpen(b)) return false;
    if (b.status === "pending_verification" && (typeof b.checkoutPaidAt !== "number" || !Number.isSafeInteger(b.checkoutPaidAt) || b.checkoutPaidAt <= 0)) return false;
    if (b.diditSessionId !== previousSessionId && b.diditSessionId !== sessionId) return false;
    const account = b.accountId ? await ctx.db.get(b.accountId) : null;
    const activeClaim = account?.activeDiditVerification;
    if (b.accountId && b.accountAccessRequired === false && b.diditSessionId !== sessionId && (!claimId || activeClaim?.bookingId !== bookingId || activeClaim.claimId !== claimId ||
        (activeClaim.leaseUntil ?? 0) <= Date.now() || activeClaim.sessionId)) return false;
    if (!b.diditSessionId && !previousSessionId) {
      const candidate = await potentialVerificationReuse(ctx, bookingId);
      if (candidate) {
        try {
          await assertVerificationArchive(ctx, candidate.source);
        } catch {
          return false;
        }
        if (await applyStoredVerificationReuse(ctx, b, candidate.source)) return false;
      }
    }
    if (b.diditSessionId !== sessionId) {
      const previousStatus = b.idVerifyStatus;
      const expiredVerificationNeedsRefresh = (verificationValidUntil(b) ?? 0) <= Date.now() ||
        b.verificationNote === "Your verification expired. Complete a new check before handover.";
      const previouslyApprovedDiditIdentity = expiredVerificationNeedsRefresh && b.idVerificationSource === "didit" &&
        /^[a-f0-9]{64}$/.test(b.renterPersonKey ?? "") && Number.isFinite(b.idVerifiedAt) &&
        b.identityRiskNotice !== "The verified person could not be linked to the rental identity record." &&
        b.identityRiskNotice !== "Didit approved the identity, but cross-account identity matching is unavailable." &&
        (["identity", "selfie", "address"] as const).every(key => b.verificationChecks?.[key] === "approved");
      await retainVerificationArchiveLink(ctx,b);
      await ctx.db.patch(bookingId, {
        diditSessionId: sessionId,
        verificationFreshRequired: undefined,
        verificationInProgressFrom: undefined,
        ...(previouslyApprovedDiditIdentity && !b.identityMatchSameAccountSourceBookingId ? { identityMatchSameAccountSourceBookingId: b._id } : {}),
        verificationChecks: undefined,
        idVerifiedAt: undefined,
        verificationExpiresAt: undefined,
        documentExpiresAt: undefined,
        verificationReusedFrom: undefined,
        idVerificationSource: undefined,
        verificationNote: undefined,
        diditEventId: undefined,
        diditEventAt: undefined,
        diditSessionApprovalSeen: undefined,
        diditSessionApprovedAt: undefined,
        diditDecisionAt: undefined,
        diditManualDecisionAt: undefined,
        diditReconciledAt: undefined,
        idVerifyStatus: "processing",
        verificationUpdatedAt: Date.now(),
      });
      if (account && activeClaim?.bookingId === bookingId && activeClaim.claimId === claimId)
        await ctx.db.patch(account._id, { activeDiditVerification: { bookingId, claimId, sessionId } });
      await queueRmv2Sync(ctx, bookingId);
      await verificationUpdateMessage(ctx, bookingId, previousStatus, "processing");
    }
    return true;
  },
});

const DIDIT_SESSION_CLAIM_MS = 5 * 60 * 1000;
const ACTIVE_DIDIT_VERIFICATION_STATES = ["required", "processing", "requires_input", "manual_review"] as const;

function paidVerificationSourceOpen(source: any, accountId: any, now: number) {
  return !!source && source.accountId === accountId && source.accountAccessRequired === false &&
    source.verificationProvider === "didit" && source.status === "pending_verification" &&
    ACTIVE_DIDIT_VERIFICATION_STATES.includes(source.idVerifyStatus ?? "required") &&
    Number.isSafeInteger(source.checkoutPaidAt) && source.checkoutPaidAt > 0 &&
    !source.cancellationDecision && !source.returnDecision && !verificationWindowClosed(source, now) &&
    source.idVerificationSource !== "manual" && source.diditManualDecisionAt == null &&
    (!source.diditSessionId || source.verificationReuseBlockedSessionId !== source.diditSessionId);
}

async function findActiveDiditSource(ctx: any, accountId: any, now: number) {
  for (const status of ACTIVE_DIDIT_VERIFICATION_STATES) {
    const rows = await ctx.db.query("bookings").withIndex("by_account_verification_review", (q: any) =>
      q.eq("accountId", accountId).eq("idVerifyStatus", status).eq("verificationProvider", "didit").eq("status", "pending_verification"))
      .order("desc").take(50);
    const source = rows.find((row: any) => !!row.diditSessionId && paidVerificationSourceOpen(row, accountId, now));
    if (source) return source;
  }
  return null;
}

export const claimDiditSessionSlot = internalMutation({
  args: { bookingId: v.id("bookings"), claimId: v.string(), previousSessionId: v.optional(v.string()) },
  handler: async (ctx, { bookingId, claimId, previousSessionId }) => {
    const booking = await ctx.db.get(bookingId), now = Date.now();
    if (!booking || booking.verificationProvider !== "didit" || !verificationBookingOpen(booking.status) ||
        booking.diditSessionId !== previousSessionId || !verificationSessionCanOpen(booking, now) ||
        booking.status === "pending_verification" && (typeof booking.checkoutPaidAt !== "number" || !Number.isSafeInteger(booking.checkoutPaidAt) || booking.checkoutPaidAt <= 0))
      return { kind: "unavailable" as const };
    if (booking.accountAccessRequired !== false || !booking.accountId) return { kind: "owner" as const };
    const account = await ctx.db.get(booking.accountId);
    if (!account || account.blockedAt != null || !await verificationReuseOwnerMatches(ctx, booking))
      return { kind: "unavailable" as const };

    const linkedSource = booking.verificationInProgressFrom ? await ctx.db.get(booking.verificationInProgressFrom) : null;
    if (linkedSource && paidVerificationSourceOpen(linkedSource, account._id, now) &&
        (!linkedSource.diditSessionId || !account.activeDiditVerification?.sessionId ||
          account.activeDiditVerification.sessionId === linkedSource.diditSessionId))
      return { kind: "waiting" as const, sourceBookingId: linkedSource._id };
    if (booking.verificationInProgressFrom)
      await ctx.db.patch(bookingId, { verificationInProgressFrom: undefined });

    const active = account.activeDiditVerification;
    if (active) {
      const source = await ctx.db.get(active.bookingId);
      const activeSessionMatches = !!source?.diditSessionId &&
        (!active.sessionId || active.sessionId === source.diditSessionId);
      const activeClaimIsLive = !active.sessionId && typeof active.claimId === "string" &&
        Number.isSafeInteger(active.leaseUntil) && active.leaseUntil! > now;
      if (source && paidVerificationSourceOpen(source, account._id, now) && (activeSessionMatches || activeClaimIsLive)) {
        if (source._id === bookingId) {
          if (activeClaimIsLive) return { kind: active.claimId === claimId ? "owner" as const : "busy" as const };
          if (source._id === bookingId && previousSessionId && source.diditSessionId === previousSessionId) {
            await ctx.db.patch(account._id, { activeDiditVerification: { bookingId, claimId, leaseUntil: now + DIDIT_SESSION_CLAIM_MS } });
            return { kind: "owner" as const };
          }
          return { kind: "busy" as const };
        }
        await ctx.db.patch(bookingId, { verificationInProgressFrom: source._id });
        return { kind: "waiting" as const, sourceBookingId: source._id };
      }
      await ctx.db.patch(account._id, { activeDiditVerification: undefined });
    }

    const legacySource = await findActiveDiditSource(ctx, account._id, now);
    if (legacySource) {
      if (legacySource._id === bookingId && previousSessionId === legacySource.diditSessionId) {
        await ctx.db.patch(account._id, { activeDiditVerification: { bookingId, claimId, leaseUntil: now + DIDIT_SESSION_CLAIM_MS } });
        return { kind: "owner" as const };
      }
      await ctx.db.patch(account._id, { activeDiditVerification: { bookingId: legacySource._id, sessionId: legacySource.diditSessionId } });
      await ctx.db.patch(bookingId, { verificationInProgressFrom: legacySource._id });
      return { kind: "waiting" as const, sourceBookingId: legacySource._id };
    }

    await ctx.db.patch(account._id, {
      activeDiditVerification: { bookingId, claimId, leaseUntil: now + DIDIT_SESSION_CLAIM_MS },
    });
    return { kind: "owner" as const };
  },
});

export const releaseDiditSessionClaim = internalMutation({
  args: { bookingId: v.id("bookings"), claimId: v.string() },
  handler: async (ctx, { bookingId, claimId }) => {
    const booking = await ctx.db.get(bookingId), account = booking?.accountId ? await ctx.db.get(booking.accountId) : null;
    if (account?.activeDiditVerification?.bookingId === bookingId && account.activeDiditVerification.claimId === claimId &&
        !account.activeDiditVerification.sessionId && !!booking) {
      await ctx.db.patch(account._id, { activeDiditVerification: booking.diditSessionId
        ? { bookingId, sessionId: booking.diditSessionId }
        : undefined });
      return true;
    }
    return false;
  },
});

export const releaseVerificationDependents = internalMutation({
  args: { sourceBookingId: v.id("bookings"), sessionId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceBookingId);
    if (!source || source.diditSessionId !== args.sessionId || source.idVerifyStatus !== "rejected" ||
        source.verificationProvider !== "didit") return;
    const page = await ctx.db.query("bookings")
      .withIndex("by_verification_in_progress_from", (q: any) => q.eq("verificationInProgressFrom", source._id))
      .paginate({ numItems: 50, cursor: args.cursor, maximumRowsRead: 50 });
    for (const dependent of page.page) {
      if (dependent.verificationInProgressFrom === source._id && dependent.idVerifyStatus !== "verified")
        await ctx.db.patch(dependent._id, { verificationInProgressFrom: undefined, verificationNote: "The other rental’s verification was not approved. You can complete verification separately for this rental.", verificationUpdatedAt: Date.now() });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.bookings.releaseVerificationDependents, { ...args, cursor: page.continueCursor });
  },
});

export const adminAllowLateVerification = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), reason: v.string() },
  handler: async (ctx, { token, bookingId, reason }) => {
    const recordedReason = reason.trim();
    if (recordedReason.length < 5 || recordedReason.length > 400)
      throw new Error("Record a short reason (5–400 characters) before allowing late verification.");
    await assertAdmin(ctx, token, "bookings.adminAllowLateVerification", { entityId: String(bookingId), reason: recordedReason });
    const booking = await ctx.db.get(bookingId);
    const now = Date.now();
    const deadline = booking ? verificationDeadlineAt(booking) : null;
    if (!booking || booking.status !== "pending_verification" || booking.verificationProvider !== "didit" || !booking.diditSessionId ||
        typeof booking.checkoutPaidAt !== "number" || !Number.isSafeInteger(booking.checkoutPaidAt) || booking.checkoutPaidAt <= 0 ||
        booking.cancellationDecision || booking.returnDecision || deadline === null || deadline > now)
      throw new Error("Only this paid Didit rental can be reopened after its verification window has passed.");
    const alreadyAllowed = !!booking.verificationLateOverrideAt;
    if (!alreadyAllowed) await ctx.db.patch(bookingId, { verificationLateOverrideAt: now, verificationLateOverrideReason: recordedReason });
    await ctx.scheduler.runAfter(0, internal.didit.reconcileLateVerificationOverride, { bookingId });
    return { allowed: true, alreadyAllowed };
  },
});

async function currentDiditSweep(ctx: any, generation: number) {
  const state = await ctx.db.query("didit_reconcile_sweeps").withIndex("by_key", (q: any) => q.eq("key", "open-sessions")).unique();
  return state?.generation === generation && state.phase === "dispatch";
}

async function resolveDiditReviewAlerts(ctx: any, bookingId: any) {
  const alerts = await ctx.db.query("admin_notifications")
    .withIndex("by_booking_kind_read_created", (q: any) => q.eq("bookingId", bookingId)
      .eq("kind", "verification_failure").eq("read", false))
    .order("desc")
    .take(100);
  for (const alert of alerts) {
    if (["Didit review needed", "Verification needs review"].includes(alert.title))
      await ctx.db.patch(alert._id, { read: true });
  }
}

/** Didit webhooks are signed in the node action. Never accept browser results. */
export const setDiditResult = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    sessionId: v.string(),
    eventId: v.string(),
    status: v.union(v.literal("processing"), v.literal("manual_review"), v.literal("verified"), v.literal("requires_input"), v.literal("rejected")),
    providerStatus: v.optional(v.string()),
    decisionAt: v.optional(v.number()),
    note: v.optional(v.string()),
    poaPostcodes: v.array(v.string()),
    eventAt: v.number(),
    documentExpiresAt: v.optional(v.number()),
    personKey: v.optional(v.string()),
    checks: v.optional(v.object({ identity: v.string(), selfie: v.string(), address: v.string() })),
    resubmissionFeatures: v.optional(v.array(v.union(v.literal("identity"), v.literal("selfie"), v.literal("address")))),
    reconciliation: v.optional(v.boolean()),
    requireApplied: v.optional(v.boolean()),
    sweepGeneration: v.optional(v.number()),
    expectedEventId: v.optional(v.union(v.string(), v.null())),
    expectedEventAt: v.optional(v.union(v.number(), v.null())),
    expectedManualDecisionAt: v.optional(v.union(v.number(), v.null())),
    expectedLateBlockedEventId: v.optional(v.union(v.string(), v.null())),
    expectedLateBlockedEventAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { bookingId, sessionId, eventId, status, providerStatus, decisionAt, note, poaPostcodes, eventAt, documentExpiresAt, personKey, checks, resubmissionFeatures, reconciliation, requireApplied, sweepGeneration, expectedEventId, expectedEventAt, expectedManualDecisionAt, expectedLateBlockedEventId, expectedLateBlockedEventAt }) => {
    if (sweepGeneration !== undefined && !(await currentDiditSweep(ctx, sweepGeneration))) return false;
    const b = await ctx.db.get(bookingId);
    if (!b || b.verificationProvider !== "didit" || b.diditSessionId !== sessionId) return false;
    const previouslyBlockedLateEventId = b.verificationLateBlockedEventId;
    const previouslyBlockedLateDecisionAt = b.verificationLateBlockedDecisionAt ?? null;
    if (status === "verified" && providerStatus !== "Approved") return false;
    if (decisionAt !== undefined && (!Number.isSafeInteger(decisionAt) || decisionAt <= 0 || decisionAt > Date.now())) return false;
    if (requireApplied && (expectedLateBlockedEventId === undefined || expectedLateBlockedEventAt === undefined)) return false;
    const verificationChecks = status === "verified" && providerStatus === "Approved"
      ? { identity: "approved", selfie: "approved", address: "approved" }
      : checks ?? (providerStatus === "Resubmitted" && resubmissionFeatures?.length
      ? {
          identity: resubmissionFeatures.includes("identity") ? "requires_input" : b.verificationChecks?.identity ?? "waiting",
          selfie: resubmissionFeatures.includes("selfie") ? "requires_input" : b.verificationChecks?.selfie ?? "waiting",
          address: resubmissionFeatures.includes("address") ? "requires_input" : b.verificationChecks?.address ?? "waiting",
        }
      : b.verificationChecks);
    if (expectedEventId !== undefined && ((b.diditEventId ?? null) !== expectedEventId || (b.diditEventAt ?? null) !== expectedEventAt ||
        (b.diditManualDecisionAt ?? null) !== expectedManualDecisionAt)) return !requireApplied;
    if (expectedLateBlockedEventId !== undefined && ((b.verificationLateBlockedEventId ?? null) !== expectedLateBlockedEventId ||
        (b.verificationLateBlockedEventAt ?? null) !== expectedLateBlockedEventAt)) return !requireApplied;
    if (!reconciliation && b.diditEventId && b.diditEventId !== eventId && b.diditEventAt === eventAt) {
      await ctx.scheduler.runAfter(0, internal.didit.reconcileAmbiguousWebhook, {
        bookingId,
        sessionId,
        webhookEventId: eventId,
        eventAt,
        expectedEventId: b.diditEventId,
        expectedEventAt: b.diditEventAt,
        expectedManualDecisionAt: b.diditManualDecisionAt ?? null,
        expectedLateBlockedEventId: b.verificationLateBlockedEventId ?? null,
        expectedLateBlockedEventAt: b.verificationLateBlockedEventAt ?? null,
      });
      return !requireApplied;
    }
    const verificationDeadline = verificationDeadlineAt(b);
    const priorApprovalAt = b.diditSessionApprovedAt ?? b.idVerifiedAt ??
      (Number.isFinite(b.verificationExpiresAt) ? b.verificationExpiresAt! - VERIFICATION_REUSE_DAYS * 86400000 : undefined);
    const priorApprovalWasInTime = b.idVerifyStatus === "verified" && verificationDeadline !== null &&
      Number.isSafeInteger(priorApprovalAt) && priorApprovalAt! < verificationDeadline;
    const providerDecisionAt = typeof decisionAt === "number" && Number.isSafeInteger(decisionAt) && decisionAt > 0 ? decisionAt : null;
    const verificationDecisionAt = status === "verified" && providerStatus === "Approved"
      ? providerDecisionAt ?? eventAt
      : eventAt;
    const lateWatermark = b.verificationLateBlockedEventAt ?? b.verificationLateBlockedAt ?? 0;
    const blockedEventIsStale = lateWatermark > eventAt ||
      (lateWatermark === eventAt && !!b.verificationLateBlockedEventId && b.verificationLateBlockedEventId !== eventId);
    const blockedProviderResultChanged = (b.verificationLateBlockedDecisionAt ?? null) !== (providerDecisionAt ?? null) ||
      (b.verificationLateBlockedProviderStatus ?? null) !== (providerStatus ?? status);
    const lateResultIsStale = (b.diditEventAt ?? 0) > eventAt || (b.diditManualDecisionAt ?? 0) >= eventAt || blockedEventIsStale;
    if (verificationDeadline !== null && verificationDecisionAt >= verificationDeadline && !b.verificationLateOverrideAt && !priorApprovalWasInTime && !lateResultIsStale) {
      if (b.verificationLateBlockedEventId !== eventId || (b.verificationLateBlockedEventAt ?? 0) < eventAt || blockedProviderResultChanged) {
        await ctx.db.patch(bookingId, {
          verificationLateBlockedAt: Date.now(),
          verificationLateBlockedEventAt: eventAt,
          verificationLateBlockedDecisionAt: providerDecisionAt ?? undefined,
          verificationLateBlockedEventId: eventId,
          verificationLateBlockedProviderStatus: providerStatus ?? status,
        });
        if (status === "verified" && providerStatus === "Approved") {
          const account = await accountForRental(ctx, b);
          await queueOwnerNotification(ctx, {
            eventKey: lateDiditApprovalEventKey(bookingId, sessionId, providerDecisionAt),
            kind: "verification_failure",
            ...(account ? { accountId: account._id } : {}),
            bookingId,
            title: "Didit approved after cutoff",
            body: "Didit approved this rental after its two-hour verification window. It remains pending; review the rental and allow late verification only if appropriate.",
          });
        }
      }
      return !requireApplied;
    }
    const unavailableKeyNotice = "Didit approved the identity, but cross-account identity matching is unavailable.";
    let repeatApprovedIdentityRecovery = false;
    if (b.diditEventId === eventId) {
      // A status poll may return the same provider event after its trusted
      // identity key has become available. Reconcile only this exact stale-key
      // case; ordinary duplicate events remain idempotent.
      let recoveredKey = personKey;
      if (!/^[a-f0-9]{64}$/.test(recoveredKey ?? "") && /^[a-f0-9]{64}$/.test(b.renterPersonKey ?? "")) recoveredKey = b.renterPersonKey;
      if (!/^[a-f0-9]{64}$/.test(recoveredKey ?? "") && b.accountId) {
        const account = await accountForRental(ctx, b);
        if (/^[a-f0-9]{64}$/.test(account?.renterPersonKey ?? "")) recoveredKey = account.renterPersonKey;
      }
      repeatApprovedIdentityRecovery = b.idVerifyStatus === "verified" && b.idVerificationSource === "didit" &&
        b.identityRiskNotice === unavailableKeyNotice && status === "verified" && providerStatus === "Approved" &&
        ["identity", "selfie", "address"].every(key => (checks ?? b.verificationChecks)?.[key as "identity" | "selfie" | "address"] === "approved") &&
        /^[a-f0-9]{64}$/.test(recoveredKey ?? "");
      if (!repeatApprovedIdentityRecovery) return !requireApplied;
      personKey = recoveredKey;
    }
    if ((b.diditEventAt ?? 0) > eventAt || (b.diditManualDecisionAt ?? 0) >= eventAt || blockedEventIsStale) return !requireApplied;
    if ((["processing", "manual_review", "requires_input"].includes(status) ||
        status === "rejected" && providerStatus === "Declined") &&
        await preserveReusableVerification(ctx, b, { eventId, eventAt })) return true;
    const preservingVerifiedManualDecision = b.idVerificationSource === "manual" && b.idVerifyStatus === "verified" &&
      providerStatus === "Approved" && status === "manual_review";
    const changesConfirmedStockState = b.status === "confirmed" && status !== "verified" &&
      !preservingVerifiedManualDecision && !(b.idVerifyStatus === "verified" && status === "processing");
    if (changesConfirmedStockState) {
      // Didit can revoke a rental's verification, but that event cannot
      // rewrite or release stock still claimed by an unacknowledged swap.
      await assertSwapStockReconciled(ctx, bookingId);
    }
    // The admin review queue is reserved for a provider-level manual hold.
    // Never create that state from an Approved Didit result or missing status.
    if (status === "manual_review" && providerStatus !== "In Review" && !preservingVerifiedManualDecision) return false;
    if (!repeatApprovedIdentityRecovery && (status!=="processing" || providerStatus==="In Progress" || Object.values(checks??{}).some(check=>check!=="waiting"))) {
      const changed=b.idVerifyStatus!==status || (["identity","selfie","address"] as const).some(key=>b.verificationChecks?.[key]!==verificationChecks?.[key]) || (b.documentExpiresAt??null)!==(documentExpiresAt??null);
      await queueVerificationArchive(ctx,b,!reconciliation || changed);
    }
    // A deliberate admin approval can override a feature-level review. Didit
    // still sends top-level Approved with the original feature decisions; keep
    // that human decision, while allowing an actual later decline to revoke it.
    if (preservingVerifiedManualDecision) {
      await ctx.db.patch(bookingId, { verificationChecks, diditEventId: eventId, diditEventAt: eventAt,
        verificationLateBlockedAt: undefined, verificationLateBlockedEventAt: undefined, verificationLateBlockedDecisionAt: undefined, verificationLateBlockedEventId: undefined, verificationLateBlockedProviderStatus: undefined });
      await queueRmv2Sync(ctx, bookingId);
      return true;
    }
    if (b.idVerifyStatus === "verified" && status === "processing") {
      await ctx.db.patch(bookingId, { verificationChecks, diditEventId: eventId, diditEventAt: eventAt,
        verificationLateBlockedAt: undefined, verificationLateBlockedEventAt: undefined, verificationLateBlockedDecisionAt: undefined, verificationLateBlockedEventId: undefined, verificationLateBlockedProviderStatus: undefined });
      await queueRmv2Sync(ctx, bookingId);
      return true;
    }
    // Didit may return an Approved status refresh without repeating the ID
    // fields used to derive the HMAC person key. If this exact booking was
    // already verified in this Didit session, its stored key remains the
    // provider-attested identity anchor; do not turn an ordinary refresh into
    // a false cross-account-matching alert. A first approval still needs a
    // fresh provider key and remains flagged when that key is unavailable.
    if (!personKey && b.idVerifyStatus === "verified" && /^[a-f0-9]{64}$/.test(b.renterPersonKey ?? ""))
      personKey = b.renterPersonKey;
    // A later rental can be the first booking row for an account that has
    // already passed Didit. If Didit omits ID fields on this Approved refresh,
    // reuse that account's previously attested HMAC for identity matching.
    // This does not skip verification: only an Approved Didit result reaches
    // this branch, and accounts without a trusted key still need a fresh key.
    if (!personKey && status === "verified" && providerStatus === "Approved") {
      const account = await accountForRental(ctx, b);
      if (/^[a-f0-9]{64}$/.test(account?.renterPersonKey ?? "")) personKey = account.renterPersonKey;
    }
    let identityRiskNotice: string | undefined = status === "verified" && providerStatus === "Approved" && !personKey
      ? "Didit approved the identity, but cross-account identity matching is unavailable."
      : undefined;
    const checkRestrictedIdentity = status === "verified" && providerStatus === "Approved" && ["identity", "selfie", "address"].every(key => verificationChecks?.[key as "identity" | "selfie" | "address"] === "approved");
    let identityAttached = false;
    if (personKey) {
      try { await attachRenterPerson(ctx, b, personKey); identityAttached = true; }
      catch { identityRiskNotice = "The verified person could not be linked to the rental identity record."; personKey = undefined; }
    }
    const identityMatchSameAccountSourceBookingId = status === "verified" && identityAttached && personKey
      ? await sameAccountApprovedDiditSource(ctx, { ...b, _id: bookingId }, personKey)
      : null;
    if (status === "verified" && !identityRiskNotice) {
      try { await assertRenterExposure(ctx, { ...b, renterPersonKey: personKey ?? b.renterPersonKey }); }
      catch { identityRiskNotice = "The overlapping equipment allocation needs attention against the per-person limit."; }
    }
    const previous = b.idVerifyStatus;
    const previousIdentityRiskNotice = b.identityRiskNotice;
    const previousDiditEventId = b.diditEventId;
    const identityRiskNoticeChanged = identityRiskNotice !== b.identityRiskNotice;
    const existingApproval = b.idVerifyStatus === "verified" && b.idVerificationSource === "didit" &&
      b.diditSessionId === sessionId;
    const priorApprovalSeen = b.diditSessionApprovalSeen || existingApproval;
    const priorApprovedAt = b.diditSessionApprovedAt ?? (existingApproval
      ? b.idVerifiedAt ?? (Number.isFinite(b.verificationExpiresAt) ? b.verificationExpiresAt! - VERIFICATION_REUSE_DAYS * 86400000 : undefined)
      : undefined);
    const verifiedAt = status === "verified"
      ? existingApproval
        ? priorApprovedAt ?? providerDecisionAt ?? undefined
        : priorApprovalSeen ? providerDecisionAt ?? priorApprovedAt : providerDecisionAt ?? eventAt
      : undefined;
    await ctx.db.patch(bookingId, {
      diditEventId: eventId,
      diditEventAt: eventAt,
      diditSessionApprovalSeen: status === "verified" || priorApprovalSeen || undefined,
      diditSessionApprovedAt: status === "verified" ? verifiedAt : priorApprovedAt,
      diditDecisionAt: status === "verified" ? providerDecisionAt ?? (existingApproval ? b.diditDecisionAt : undefined) : undefined,
      idVerifyStatus: status,
      ...(b.status === "confirmed" && status !== "verified" ? { status: "pending_verification" } : {}),
      idVerificationSource: "didit",
      verificationChecks,
      documentExpiresAt,
      identityMatchSameAccountSourceBookingId: identityMatchSameAccountSourceBookingId ?? undefined,
      verificationExpiresAt: verifiedAt != null ? verifiedAt + VERIFICATION_REUSE_DAYS * 86400000 : undefined,
      idVerifiedAt: verifiedAt,
      verificationNote: note?.slice(0, 400),
      identityRiskNotice: status === "verified" ? identityRiskNotice : undefined,
      verificationUpdatedAt: Date.now(),
      verificationLateBlockedAt: undefined,
      verificationLateBlockedEventAt: undefined,
      verificationLateBlockedDecisionAt: undefined,
      verificationLateBlockedEventId: undefined,
      verificationLateBlockedProviderStatus: undefined,
    });
    if (status === "rejected" && providerStatus === "Declined") {
      const verificationAccount = b.accountId ? await accountForRental(ctx, b) : null;
      if (verificationAccount?.activeDiditVerification?.bookingId === bookingId &&
          verificationAccount.activeDiditVerification.sessionId === sessionId)
        await ctx.db.patch(verificationAccount._id, { activeDiditVerification: undefined });
      if (ctx.scheduler?.runAfter) await ctx.scheduler.runAfter(0, internal.bookings.releaseVerificationDependents, {
        sourceBookingId: bookingId, sessionId, cursor: null,
      });
    }
    if (status === "verified" && providerStatus === "Approved" && !identityRiskNotice && previousIdentityRiskNotice === unavailableKeyNotice &&
        /^[a-f0-9]{64}$/.test(personKey ?? "") && previousDiditEventId) {
      const previousNotice = await ctx.db.query("admin_notifications")
        .withIndex("by_event", (q: any) => q.eq("eventKey", `allocation-review:${bookingId}:${previousDiditEventId}`)).first();
      if (previousNotice?.bookingId === bookingId && previousNotice.kind === "verification_failure" &&
          previousNotice.title === "Booking identity or allocation notice" && previousNotice.body === unavailableKeyNotice && !previousNotice.read)
        await ctx.db.patch(previousNotice._id, { read: true });
    }
    if (previouslyBlockedLateEventId && b.verificationLateOverrideAt && status !== "processing") {
      const lateAlertKeys = new Set([
        lateDiditApprovalEventKey(bookingId, sessionId, previouslyBlockedLateDecisionAt),
        `didit-late-approval:${bookingId}:${sessionId}`,
        `didit-late-approval:${bookingId}:${previouslyBlockedLateEventId}`,
      ]);
      const openAlerts = await ctx.db.query("admin_notifications")
        .withIndex("by_booking_kind_read_created", (q: any) => q.eq("bookingId", bookingId)
          .eq("kind", "verification_failure").eq("read", false))
        .order("desc")
        .take(100);
      for (const alert of openAlerts) {
        const matchesCurrentSession = typeof alert.eventKey === "string" &&
          alert.eventKey.startsWith(`didit-late-approval:${bookingId}:${sessionId}:`);
        if (alert.title === "Didit approved after cutoff" && (lateAlertKeys.has(alert.eventKey) || matchesCurrentSession))
          await ctx.db.patch(alert._id, { read: true });
      }
    }
    if (status === "verified") {
      // The alert above already tells the team when Didit approved a rental
      // but the provider-attested identity could not be attached. A retry job
      // cannot recover that missing key from the database and would raise a
      // second, duplicate notification after five futile attempts. A later
      // Didit refresh with an attachable key still queues the real comparison.
      if (checkRestrictedIdentity && identityAttached) {
        await queueRestrictedIdentityCheck(ctx, bookingId, sessionId, eventId);
        if (identityAttached && /^[a-f0-9]{64}$/.test(personKey ?? "")) {
          try { await notifyRestrictedIdentityMatch(ctx, { ...b, _id: bookingId, identityMatchSameAccountSourceBookingId }, personKey!); }
          catch (error) { console.error("Immediate restricted-identity check failed", bookingId, error); }
        }
      }
      await markAccountVerified(ctx, bookingId);
      if (identityRiskNotice && identityRiskNoticeChanged) {
        const account = await accountForRental(ctx, b);
        await queueOwnerNotification(ctx, {eventKey:`allocation-review:${bookingId}:${eventId}`,kind:"verification_failure",...(account?{accountId:account._id}:{}),bookingId,title:"Booking identity or allocation notice",body:identityRiskNotice});
      }
      const updated = await ctx.db.get(bookingId);
      if (updated && verifiedAt != null) await saveAccountDiditVerification(ctx, updated, verifiedAt, documentExpiresAt, verificationChecks, updated.renterPersonKey);
      if (["confirmed", "active"].includes(b.status)) await ctx.scheduler.runAfter(0, internal.chat.postBookingMessages, { bookingId });
      else if (b.status === "pending_verification") await ctx.scheduler.runAfter(0, internal.checkout.confirmAfterVerification, { bookingId });
    }
    else if (["rejected", "requires_input", "manual_review"].includes(status)) {
      await revokeReuse(ctx, bookingId);
      // A paid, unconfirmed rental stays pending for an explicit team decision.
      // A provider result alone must not release its stock or settle its payment.
    }
    await verificationUpdateMessage(ctx, bookingId, previous, status);
    if (previous === "manual_review" && status !== "manual_review")
      await resolveDiditReviewAlerts(ctx, bookingId);
    const shouldEmailVerifiedDiditRental = status === "verified" && providerStatus === "Approved" &&
      !identityRiskNotice && ["confirmed", "active"].includes(b.status);
    if (verificationBookingOpen(b.status) && previous !== status &&
        (["manual_review", "requires_input", "rejected"].includes(status) || shouldEmailVerifiedDiditRental))
      await queueRentalEmail(ctx,bookingId,"verification",{verificationStatus:status});
    if (verificationBookingOpen(b.status) && previous !== status && (status === "rejected" || status === "verified" && providerStatus === "Approved" && !identityRiskNotice)) {
      const account = await accountForRental(ctx, b);
      const approved = status === "verified";
      await queueOwnerNotification(ctx, {eventKey:`didit-status:${bookingId}:${sessionId}:${eventId}`,kind:approved?"verification_update":"verification_failure",...(account?{accountId:account._id}:{}),bookingId,
        title:approved?"Didit verification approved":"Didit verification not approved",
        body:approved?"Didit approved verification. Document archiving may still be in progress.":"Didit did not approve verification. Open the rental for details."});
    }
    // A Didit review can emit more than one event while the case stays in the
    // same manual-review state (for example, when its explanatory note is
    // refreshed). Keep the latest note on the booking, but notify the team
    // only when the booking enters a new review state. Note changes remain
    // visible in the rental's verification details without sending another
    // push for the same unresolved review.
    if (verificationBookingOpen(b.status) && status === "manual_review" && previous !== status) {
      const account = await accountForRental(ctx, b);
      await queueOwnerNotification(ctx, { eventKey: `didit-review:${bookingId}:${eventId}`, kind: "verification_failure",
        ...(account ? { accountId: account._id } : {}), bookingId, title: "Didit review needed",
        body: note ?? "Didit paused verification for a human decision. Open the rental for the provider's note." });
      await ctx.scheduler.runAfter(0, internal.notify.verificationReviewAlert, { bookingId });
    }
    await queueRmv2Sync(ctx, bookingId);
    return true;
  },
});

function lateDiditApprovalEventKey(bookingId: string, sessionId: string, decisionAt: number | null) {
  const decisionIdentity = typeof decisionAt === "number" && Number.isSafeInteger(decisionAt) && decisionAt > 0
    ? `approved-${decisionAt}`
    : "approved-final";
  return `didit-late-approval:${bookingId}:${sessionId}:${decisionIdentity}`;
}

async function markAccountVerified(ctx: any, bookingId: any) {
  const b = await ctx.db.get(bookingId);
  if (!b?.accountId) return;
  const account = await accountForRental(ctx, b);
  if (!account || account._id !== b.accountId || account.blockedAt != null ||
      !Number.isFinite(account.emailVerifiedAt) || account.emailVerifiedAt <= 0 || account.emailVerifiedAt > Date.now() ||
      !await verificationReuseOwnerMatches(ctx, b)) return;
  await ctx.db.patch(account._id, { idVerified: true });
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
    if (status === "verified") {
      await markAccountVerified(ctx, bookingId);
      await ctx.scheduler.runAfter(0, internal.chat.postBookingMessages, { bookingId });
    }
    else await revokeReuse(ctx, bookingId);
    await verificationUpdateMessage(ctx, bookingId, prev, status);
    if (status !== prev && ["verified", "requires_input", "canceled"].includes(status))
      await queueRentalEmail(ctx,bookingId,"verification",{verificationStatus:status});
    await queueRmv2Sync(ctx, bookingId);
  },
});

/** Called only after the authenticated admin action has read and, when needed,
 * updated this exact Didit session. A signed webhook may arrive first. */
export const setDiditManualReview = internalMutation({
  args: {
    bookingId: v.id("bookings"), sessionId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("resubmit"), v.literal("decline")),
    note: v.string(), personKey: v.optional(v.string()),
    expectedEventId:v.union(v.string(),v.null()), expectedEventAt:v.union(v.number(),v.null()), expectedManualDecisionAt:v.union(v.number(),v.null()),
  },
  handler: async () => false,
});

// ── Customer self-service cancellation (Phase 3) ──────────────────
/** Read-only context the cancel action needs (ownership, amounts, window, site-only check). */
export const getForCancel = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const acct = await accountForRental(ctx, b);
    const res = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    const refundJobs=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
    if(refundJobs.some(r=>r.status==="prepared"||r.status==="pending"))throw Error("A rental refund is still processing. Wait for settlement before cancellation.");
    const linkedRequest=b.cancellationDecision?.changeRequestId?await ctx.db.get(b.cancellationDecision.changeRequestId):null;
    const completedChangeRequestId=linkedRequest?.bookingId===bookingId && linkedRequest.kind==="cancel" && linkedRequest.status==="approved" && linkedRequest.execution?.operation==="cancellation" && linkedRequest.execution.status==="applied" && linkedRequest.execution.operationKey===cancellationRequestKey(bookingId,linkedRequest._id) ? linkedRequest._id : undefined;
    const rentalCredits=await rentalCreditSources(ctx,b);
    return {
      completedChangeRequestId,
      paymentSources:await rentalPaymentSources(ctx,b),
      rentalCreditAllocations:rentalCredits,
      spentCreditPence:checkoutCreditSpentPence(b)+rentalCredits.reduce((sum:number,row:any)=>sum+row.amountPence,0),
      cancellationDecision:b.cancellationDecision??null,
      accountId: acct?._id ?? null,
      guestEmail: (b.guestEmail ?? "").trim().toLowerCase(),
      status: b.status,
      verificationProvider: b.verificationProvider ?? null,
      idVerifyStatus: b.idVerifyStatus ?? null,
      diditSessionId: b.diditSessionId ?? null,
      diditEventId: b.diditEventId ?? null,
      paidConfirmedAt: b.paidConfirmedAt ?? null,
      checkoutPaidAt: b.checkoutPaidAt ?? null,
      checkoutPaymentAmountPence: b.checkoutPaymentAmountPence ?? null,
      checkoutPaymentCurrency: b.checkoutPaymentCurrency ?? null,
      checkoutPaymentStatus: b.checkoutPaymentStatus ?? null,
      checkoutExpectedAmountPence: b.checkoutExpectedAmountPence ?? null,
      verificationConfirmationIssue: b.verificationConfirmationIssue,
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

export const prepareInventoryConflictRefund=internalMutation({args:{bookingId:v.id("bookings"),sessionId:v.string(),paymentIntentId:v.string(),reason:v.string()},handler:async(ctx,args)=>{
 const b=await ctx.db.get(args.bookingId);
 if(!b||b.status!=="pending_verification"||!(b.verificationConfirmationIssue==="inventory_unavailable"||b.verificationConfirmationIssue==="manager_capacity_conflict")||b.stripeCheckoutSessionId!==args.sessionId||b.stripePaymentIntentId!==args.paymentIntentId)throw Error("The paid unconfirmed rental or its stock issue changed. Review again.");
 const reason=args.reason.trim();if(reason.length<5||reason.length>400)throw Error("Record a reason between 5 and 400 characters.");
 if(b.cancellationDecision){if(b.cancellationDecision.inventoryConflictRefund&&b.cancellationDecision.inventoryConflictReason===reason)return b.cancellationDecision;throw Error("Another cancellation decision is already in progress.");}
 if(b.returnDecision||b.activeAdditionId||b.activeExtensionId||b.activePriceAdjustmentId||b.activeItemSwapId||b.activeDeliveryQuoteId||b.membershipCheckoutId||(b.membershipCreditApplied??0)>0||((b.creditApplied??0)>0&&(b.checkoutCreditState!=="unspent"||b.paidConfirmedAt)))throw Error("This booking has other financial activity and needs individual review.");
 if((b.creditApplied??0)>0){
  const account=b.accountId?await ctx.db.get(b.accountId):await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",(b.guestEmail??"").trim().toLowerCase())).first();
  if(!account||!b.creditAllocations?.length||b.creditAllocations.reduce((sum,a)=>sum+Math.round(a.amount*100),0)!==Math.round((b.creditApplied??0)*100))throw Error("Credit funding requires individual review.");
  for(const allocation of b.creditAllocations){const source=await ctx.db.get(allocation.creditId);if(!source||source.accountId!==account._id||(source.revokedPendingPence??0)>0)throw Error("Reversed or uncertain credit requires individual review.");}
 }
 const refunds=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",args.bookingId)).take(1);
 if(refunds.length)throw Error("Existing refund history requires individual review.");
 const decision={kind:"full_refund" as const,createdAt:Date.now(),inventoryConflictRefund:true,inventoryConflictReason:reason};
 await ctx.db.patch(args.bookingId,{cancellationDecision:decision});return decision;
}});

/** Freeze cancellation policy and order edits before any external payment call. */
export const prepareCancellation=internalMutation({args:{bookingId:v.id("bookings"),fullCreditOfferId:v.optional(v.id("rental_credit_offers")),operatorOfferId:v.optional(v.id("operator_cancellation_offers")),changeRequestId:v.optional(v.id("rental_change_requests")),expectedCancellationKind:v.optional(v.union(v.literal("full_refund"),v.literal("store_credit"),v.literal("no_refund"))),customerChoice:v.optional(v.union(v.literal("refund"),v.literal("credit")))},handler:async(ctx,{bookingId,fullCreditOfferId,operatorOfferId,changeRequestId,expectedCancellationKind,customerChoice})=>{
 await assertSwapStockReconciled(ctx, bookingId, undefined, true);
 const b=await ctx.db.get(bookingId);if(!b)throw Error("Only an unstarted rental can be cancelled");
 const approvedCancellationRequest=changeRequestId?await approvedRequest(ctx,b,changeRequestId,"cancellation",cancellationRequestKey(bookingId,changeRequestId)):null;
 const pendingVerificationRequestCancellation=b.status==="pending_verification"&&b.verificationProvider==="didit"&&!!approvedCancellationRequest;
 if(b.returnDecision)throw Error("Return settlement is in progress; finish it first");await assertActiveItemSwapReady(ctx,b,true);if((b?.activeAdditionId || b?.activeExtensionId || b?.activePriceAdjustmentId))throw Error("Finish or withdraw the open rental change before cancellation");const rejectedDiditPaidBooking=isRejectedPendingDiditBooking(b);if(rejectedDiditPaidBooking&&(fullCreditOfferId||operatorOfferId||b.cancellationDecision?.operatorOfferId))throw Error("A declined verification booking can only receive its original payment settlement, without a cancellation bonus.");if(!(["confirmed","pending_payment"].includes(b.status)||rejectedDiditPaidBooking||pendingVerificationRequestCancellation||b.status==="pending_verification"&&b.cancellationDecision?.inventoryConflictRefund||b.status==="cancelled"&&operatorOfferId&&b.cancellationDecision?.operatorOfferId===operatorOfferId))throw Error("Only an unstarted rental can be cancelled");
 if(b?.activeDeliveryQuoteId)throw Error("Finish or withdraw the delivery payment before cancellation.");
 if(!b.cancellationDecision && (["starting","processing"].includes(b.depositHoldRenewalStatus ?? "") ||
  (b.status === "confirmed" && b.depositHoldAmount && b.depositHoldStatus === "awaiting_payment"))) throw Error("Security hold setup or renewal is still processing. Please retry once it is resolved.");
 if(operatorOfferId){const offer=await ctx.db.get(operatorOfferId);if(!offer||offer.bookingId!==bookingId||offer.state!=="chosen"||!offer.choice)throw Error("The operator cancellation choice is not ready.");const account=await ctx.db.get(offer.accountId);if(offer.choice==="credit"&&!operatorCancellationCreditAllowed(account,offer))throw Error("The account restriction changed after this cancellation offer. The original-payment refund is the only choice.");}
 if(b.cancellationDecision){
  if(b.cancellationDecision.operatorOfferId!==operatorOfferId)throw Error("Another cancellation choice is already processing.");
  if(expectedCancellationKind && b.cancellationDecision.kind!==expectedCancellationKind)throw Error("Cancellation eligibility changed. Review the current terms before confirming again.");
  if(b.cancellationDecision.customerChoice!==customerChoice)throw Error("The cancellation choice changed. Review the current settlement before retrying.");
  if(b.cancellationDecision.fullCreditOfferId !== fullCreditOfferId)throw Error("Another cancellation choice is already processing. Contact the team.");
  if(changeRequestId !== undefined && b.cancellationDecision.changeRequestId !== changeRequestId)throw Error("Another cancellation request is already processing. Contact the team.");
  return b.cancellationDecision;
 }
 const request=approvedCancellationRequest;
 const acceptedTermsVersion=b.agreementDocs?.find((doc:any)=>doc.kind==="cancellation")?.version??"2026-10-v10";
 if(request?.cancellationTermsVersion&&request.cancellationTermsVersion!==acceptedTermsVersion)throw Error("The accepted cancellation terms changed since this request. Ask the renter to submit it again.");
 if(request?.cancellationKindAtRequest&&bookingCancelKind(b,request.createdAt)!==request.cancellationKindAtRequest)throw Error("The rental dates changed since this cancellation request. Ask the renter to submit it again.");
 if(request&&request.cancellationChoice!==customerChoice)throw Error("The settlement choice does not match the renter’s saved request.");
 if(fullCreditOfferId){const offer=await ctx.db.get(fullCreditOfferId);assertCreditOffer(offer,b);if(offer?.status!=="offered")throw Error("Credit offer already settled");}
 const jobs=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
 if(jobs.some(r=>r.status==="prepared"||r.status==="pending"))throw Error("A refund is still processing");
 const kind=request?.cancellationKindAtRequest??bookingCancelKind(b,Date.now());
 if(expectedCancellationKind && kind!==expectedCancellationKind)throw Error("Cancellation eligibility changed. Review the current terms before confirming again.");
 const hasCurrentCancellationTerms=b.agreementDocs?.some((doc:any)=>doc.kind==="cancellation"&&isNoRefundWithin48HoursCancellationVersion(doc.version));
 if(request&&hasCurrentCancellationTerms&&kind==="full_refund"&&!request.cancellationChoice)throw Error("This request has no saved renter choice. Ask them to submit a new cancellation request.");
 if(customerChoice&&(!hasCurrentCancellationTerms||kind!=="full_refund")){
  const fullRefundWindow=cancellationTimingBasis("full_refund",acceptedTermsVersion);
  throw Error(fullRefundWindow
   ?`A refund or credit choice is available only when ${fullRefundWindow.toLowerCase()} and more than 48 hours remain before scheduled pickup.`
   :"A refund or credit choice is not available under the cancellation terms accepted for this rental.");
 }
 const expiredProposal=b.activeItemSwapId?await expireUnacceptedItemSwap(ctx,b):null;
 if(expiredProposal){const account=await accountForRental(ctx,b);if(account)await postRentalMessage(ctx,{accountId:account._id,bookingId,sender:"system",text:"The pending equipment-change offer closed while cancellation was being prepared. Your confirmed booking items and price are unchanged."});}
 if(changeRequestId)await startRequest(ctx,b,changeRequestId,"cancellation",cancellationRequestKey(bookingId,changeRequestId));
 const decision={kind,createdAt:Date.now(),...(customerChoice?{customerChoice}:{}),...(fullCreditOfferId?{fullCreditOfferId}:{}),...(changeRequestId?{changeRequestId}:{})};await ctx.db.patch(bookingId,{cancellationDecision:decision,...(isPickupHoldPolicyVersion(b.securityHoldPolicyVersion)?{securityHoldRetryAt:undefined}:{})});return decision;
}});
export const recordCancellationQuote=internalMutation({args:{bookingId:v.id("bookings"),quote:v.object({mode:v.union(v.literal("none"),v.literal("refund"),v.literal("credit"),v.literal("no_refund")),refundAmount:v.number(),creditAmount:v.number(),bonusCreditAmount:v.optional(v.number()),paymentIntentId:v.optional(v.string()),allocations:v.optional(v.array(v.object({paymentIntentId:v.string(),amountPence:v.number()})))})},handler:async(ctx,{bookingId,quote})=>{
 const b=await ctx.db.get(bookingId);if(!b?.cancellationDecision)throw Error("Cancellation has not been prepared");
 if(b.cancellationDecision.quote)return b.cancellationDecision.quote;
 if(b.cancellationDecision.operatorOfferId){
  const offer=await ctx.db.get(b.cancellationDecision.operatorOfferId);
  if(!offer||offer.state!=="chosen"||!offer.choice)throw Error("The operator cancellation choice is not ready.");
  const account=await ctx.db.get(offer.accountId);
  if(offer.choice==="credit"&&!operatorCancellationCreditAllowed(account,offer))throw Error("The account restriction changed after this cancellation offer. The original-payment refund is the only choice.");
  const options=operatorCancellationOptions({cashRemainingPence:offer.cashRemainingPence!,securityRemainingPence:offer.securityRemainingPence!,spentCreditPence:offer.spentCreditPence!}),credit=offer.choice==="credit";
  if(quote.mode!==(credit?"credit":"refund")||Math.round(quote.refundAmount*100)!==(credit?options.credit.cardRefundPence:options.refund.cardRefundPence)||Math.round(quote.creditAmount*100)!==(credit?options.credit.creditPence:options.refund.restoredCreditPence)||Math.round((quote.bonusCreditAmount??0)*100)!==(credit?options.credit.bonusPence:0))throw Error("The cancellation quote does not match the selected settlement.");
 }
 await ctx.db.patch(bookingId,{cancellationDecision:{...b.cancellationDecision,quote}});return quote;
}});

/** Atomically finalise a cancellation: flip status, free the ledger, issue store credit if late,
 *  post a chat note, schedule the email. Idempotent (no-op if already cancelled). The Stripe
 *  refund itself is done by the action before calling this. */
export const _finalizeCancellation = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    accountId: v.optional(v.id("accounts")),
    mode: v.union(v.literal("none"), v.literal("refund"), v.literal("credit"), v.literal("no_refund")),
    refundAmount: v.number(),
    creditAmount: v.number(),
    currency: v.string(),
    adminReason: v.optional(v.string()),
  },
  handler: async (ctx, { bookingId, accountId, mode, refundAmount, creditAmount, currency, adminReason }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return { ok: false as const };
    const cancellationJob = await ctx.db.query("rental_cancellations").withIndex("by_booking", q => q.eq("bookingId", bookingId)).unique();
    if (b.cancellationDecision?.changeRequestId && !cancellationJob) throw Error("The linked cancellation settlement has not been prepared.");
    if (cancellationJob?.receipts.some(r => r.status !== "succeeded")) throw Error("Stripe cancellation settlement is incomplete.");
    if (cancellationJob && (!b.cancellationDecision?.quote ||
        b.cancellationDecision.quote.mode !== mode || b.cancellationDecision.quote.refundAmount !== refundAmount ||
        b.cancellationDecision.quote.creditAmount !== creditAmount || cancellationJob.accountId !== accountId ||
        currency.toLowerCase() !== (b.currency ?? "GBP").toLowerCase())) throw Error("The frozen cancellation settlement changed.");
    const membershipAccount = accountId ? await ctx.db.get(accountId) : await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",b.guestEmail??"")).first();
    const operatorOffer=b.cancellationDecision?.operatorOfferId?await ctx.db.get(b.cancellationDecision.operatorOfferId):null;
    if (b.status === "cancelled" && (!operatorOffer||operatorOffer.state==="settled")) return { ok: true as const, already: true };
    await assertSwapStockReconciled(ctx, bookingId, undefined, true);
    await assertActiveItemSwapReady(ctx, b, true);
    if (b.activeItemSwapId) await expireUnacceptedItemSwap(ctx, b);
    if(operatorOffer && (operatorOffer.state!=="chosen"||!cancellationJob))throw Error("Operator cancellation settlement is incomplete.");
    if(operatorOffer?.choice==="credit"&&!operatorCancellationCreditAllowed(membershipAccount,operatorOffer))throw new ConvexError({code:"CANCELLATION_REVIEW",message:"The account restriction changed after its cancellation choice. No account credit was issued; review the frozen settlement."});
    await stopMatchingRecovery(ctx,b.guestEmail??"",b.lineItems,bookingId);
    if (membershipAccount?.membershipPerksPendingBookingId === bookingId)
      await ctx.db.patch(membershipAccount._id,{membershipPerksPendingBookingId:undefined});
    const operationCreditRows=await ctx.db.query("rental_credit_reservations").withIndex("by_booking",(q:any)=>q.eq("bookingId",bookingId)).take(101);
    if(operationCreditRows.length>100)throw Error("Rental account-credit history needs review before cancellation.");
    for(const reservation of operationCreditRows)if(reservation.state==="reserved")await releaseRentalCredit(ctx,reservation.operationType,reservation.operationId);

    let creditId: any = undefined,totalIssuedPence=0,firstCreditExpiry=Infinity;
    if (creditAmount > 0 && accountId) {
      const now = Date.now();
      const grant = b.membershipCreditGrantId ? await ctx.db.get(b.membershipCreditGrantId) : null;
      const restoredMembership = grant ? Math.min(Math.round(creditAmount * 100), checkoutMembershipCreditSpentPence(b)) : 0;
      const account = await ctx.db.get(accountId);
      // Returning credit spent from a reversed membership first clears its
      // future-credit offset, rather than creating fresh unbacked credit.
      const offset = grant?.revokedPence ? Math.min(restoredMembership, account?.membershipCreditDebtPence ?? 0) : 0;
      if (offset && account) await ctx.db.patch(accountId,{membershipCreditDebtPence:(account.membershipCreditDebtPence ?? 0)-offset});
      const issue = (amountPence: number, linked: boolean, kind:"refund"|"earned"="earned", source?:any,reasonType?:string) => {
        const expiry=now + CANCELLATION_CREDIT_DAYS * 86400000;
        totalIssuedPence+=amountPence;firstCreditExpiry=Math.min(firstCreditExpiry,expiry);
        return ctx.db.insert("credits", {
        kind,
        accountId,
        amount: amountPence / 100,
        remaining: amountPence / 100,
        currency,
        reason: `${reasonType??(b.cancellationDecision?.fullCreditOfferId ? "consented_full_credit" : mode === "refund" ? "restored_credit" : operatorOffer?"operator_cancellation_credit":"late_cancellation")}:${bookingId}`,
        bookingId,
        createdAt: now,
        expiresAt: expiry,
        status: "active",
        ...(source?.membershipGrantId ? {membershipInvoiceId:source.membershipInvoiceId,membershipGrantId:source.membershipGrantId} : linked && grant ? {membershipInvoiceId:grant.invoiceId,membershipGrantId:grant._id} : {}),
      });};
      const bonus=Math.round((operatorOffer?b.cancellationDecision?.quote?.bonusCreditAmount??0:0)*100);
      if(!Number.isSafeInteger(bonus)||bonus<0||bonus>Math.round(creditAmount*100))throw Error("Invalid cancellation bonus.");
      const ordinary = Math.round(creditAmount * 100)-restoredMembership-bonus;
      if (ordinary > 0){
        const originalSpent=checkoutCreditSpentPence(b)-checkoutMembershipCreditSpentPence(b);
        const consumedOperations=operationCreditRows.filter((r:any)=>r.state==="consumed").sort((a:any,b:any)=>(a.createdAt??0)-(b.createdAt??0)||String(a._id).localeCompare(String(b._id)));
        const operationSpent=consumedOperations.reduce((sum:number,r:any)=>{
          const original=r.amountPence,restored=r.restoredPence??0;
          if(!Number.isSafeInteger(original)||!Number.isSafeInteger(restored)||original<0||restored<0||restored>original)throw Error("An operation account-credit allocation needs review before cancellation.");
          return sum+original-restored;
        },0);
        const oldSpent=originalSpent+operationSpent;
        const restoreTotal=Math.min(ordinary,oldSpent);
        let restore=Math.min(restoreTotal,originalSpent);
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
        let operationRestore=Math.min(Math.max(0,restoreTotal-Math.min(restoreTotal,originalSpent)),operationSpent);
        if(operationRestore>0){
          for(const reservation of consumedOperations){
            const availablePence=reservation.amountPence-(reservation.restoredPence??0);
            if(!Number.isSafeInteger(availablePence)||availablePence<0)throw Error("An operation account-credit allocation needs review before cancellation.");
            const takePence=Math.min(operationRestore,availablePence);
            if(takePence<=0)continue;
            const restored=await restoreRentalCredit(ctx,reservation.operationType,reservation.operationId,(reservation.restoredPence??0)+takePence);
            totalIssuedPence+=restored.issuedPence??0;
            for(const restoredCreditId of restored.creditIds??[])creditId=restoredCreditId;
            if(restored.issuedPence&&restored.expiresAt)firstCreditExpiry=Math.min(firstCreditExpiry,restored.expiresAt);
            operationRestore-=takePence;
            if(operationRestore===0)break;
          }
          if(operationRestore>0)throw Error("The cancellation credit exceeds the unreturned operation account-credit sources.");
        }
        const cash=ordinary-restoreTotal;
        if(cash>0)creditId=await issue(cash,false,"refund");
      }
      if (restoredMembership > offset) creditId = await issue(restoredMembership-offset,!!grant && (grant.membershipRefundedPence ?? 0) < grant.paidMembershipPence);
      if(bonus>0)creditId=await issue(bonus,false,"earned",undefined,"operator_cancellation_bonus");
    }
    if(totalIssuedPence>0&&accountId&&creditId)await ctx.db.insert("credit_issues",{requestId:`rental-cancellation-${bookingId}`,bookingId,accountId,creditId,amountPence:totalIssuedPence,bonusPence:Math.round((b.cancellationDecision?.quote?.bonusCreditAmount??0)*100),reason:operatorOffer&&mode==="credit"?"Cancelled rental · account credit +30%":mode==="refund"?"Previously used account credit restored":"Rental cancellation credit",createdAt:Date.now(),expiresAt:firstCreditExpiry});
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
    if (b.status !== "cancelled") await bumpVerificationRetentionRevision(ctx,b);
    await reconcileReleasedCredit(ctx,b);
    const res = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    for (const r of res) {
      if (r.status === "hold") await ctx.db.delete(r._id);
      else await ctx.db.patch(r._id, { status: "cancelled" });
    }
    if (accountId) {
      const diditDeclined = b.verificationProvider === "didit" && b.idVerifyStatus === "rejected" && adminReason === "Didit verification was declined";
      const note = diditDeclined
        ? mode === "credit"
          ? `Didit could not approve verification, so this rental was cancelled. £${refundAmount} is being returned to your card and £${creditAmount} account credit has been added under the accepted terms. No cancellation bonus applies. If you believe the result is wrong, use Didit’s resubmission option if available or contact our team. A rental cannot proceed under another person’s identity.`
          : mode === "refund"
            ? `Didit could not approve verification, so this rental was cancelled. £${refundAmount} is being returned to your card under the accepted terms.${creditAmount > 0 ? ` £${creditAmount} of previously used credit has also been restored.` : ""} No cancellation bonus applies. If you believe the result is wrong, use Didit’s resubmission option if available or contact our team. A rental cannot proceed under another person’s identity.`
            : `Didit could not approve verification, so this rental was cancelled under the accepted terms. No cancellation bonus applies. If you believe the result is wrong, use Didit’s resubmission option if available or contact our team. A rental cannot proceed under another person’s identity.`
        : mode === "credit"
          ? `Your booking was cancelled.${refundAmount > 0 ? ` £${refundAmount} of separately refundable security is being returned to your card.` : ""} £${creditAmount} account credit (valid ${CANCELLATION_CREDIT_DAYS} days) has been added to your account. No rental cash refund is issued for the amount converted to credit.`
          : mode === "refund"
            ? `Your booking was cancelled. £${refundAmount} is being returned to your card.${creditAmount > 0 ? ` £${creditAmount} of previously used credit has been restored to your account for ${CANCELLATION_CREDIT_DAYS} days.` : ""}`
            : mode === "no_refund"
              ? `Your booking was cancelled. No rental refund or account credit is due under the accepted terms.${refundAmount > 0 ? ` Separately refundable security of £${refundAmount} is being returned to your card.` : ""}`
              : `Your booking was cancelled.`;
      await postRentalMessage(ctx,{accountId,bookingId,sender:"system",text:note,...(b.cancellationDecision?.changeRequestId ? {meta:{type:"rental_change_applied",changeRequestId:b.cancellationDecision.changeRequestId}}:{})});
    }
    const cancelledAccount = await accountForRental(ctx, await ctx.db.get(bookingId));
    if(cancelledAccount) await queueOwnerNotification(ctx,{eventKey:`cancelled:${bookingId}`,kind:"booking_cancelled",accountId:cancelledAccount._id,bookingId,title:"Rental cancelled",body:"The cancellation settlement is complete. Open the rental for the recorded refund or credit."});
    await queueRentalEmail(ctx,bookingId,"cancellation",{mode,refundAmount,creditAmount});
    await queueRmv2Sync(ctx, bookingId);
    if(operatorOffer)await ctx.db.patch(operatorOffer._id,{state:"settled",dueAt:undefined,leaseUntil:0,updatedAt:Date.now()});
    if(b.cancellationDecision?.changeRequestId)await finishRequest(ctx,b,b.cancellationDecision.changeRequestId,"cancellation",cancellationRequestKey(bookingId,b.cancellationDecision.changeRequestId),mode==="no_refund"?`Rental cancelled under the accepted terms. No rental refund or account credit is due; any separately refundable security has been settled.`:`Rental cancelled. Card refund £${refundAmount.toFixed(2)}; account credit £${creditAmount.toFixed(2)}. Any uncaptured card authorisations have been released.`);
    return { ok: true as const, creditId };
  },
});

async function revokeReuse(ctx: any, sourceBookingId: any) {
  const source = await ctx.db.get(sourceBookingId);
  if (!source) return;
  const account = await accountForRental(ctx, source);
  if (account?.rentalVerification?.sourceBookingId === sourceBookingId) await ctx.db.patch(account._id, { rentalVerification: undefined, idVerified: false });
  const reused = await ctx.db.query("bookings").withIndex("by_verification_reused", (q: any) => q.eq("verificationReusedFrom", sourceBookingId)).collect();
  if (reused.length) await bumpVerificationRetentionRevision(ctx,source);
  for (const b of reused) if (["pending_verification", "confirmed", "active"].includes(b.status) && b.idVerifyStatus === "verified") {
    await retainVerificationArchiveLink(ctx,b);
    await ctx.db.patch(b._id, { idVerifyStatus: "requires_input", verificationExpiresAt: undefined, verificationReusedFrom: undefined, verificationNote: "Your previous verification changed. Please complete a new check before handover." });
    await verificationUpdateMessage(ctx, b._id, "verified", "requires_input");
    await queueRmv2Sync(ctx, b._id);
  }
}
export const revokeVerificationReuse = internalMutation({
  args: { sourceBookingId: v.id("bookings"), sessionId:v.optional(v.string()), expectedEventId:v.optional(v.union(v.string(),v.null())),
    expectedEventAt:v.optional(v.union(v.number(),v.null())), expectedManualDecisionAt:v.optional(v.union(v.number(),v.null())) },
  handler: async (ctx, args) => {
    if (args.expectedEventId !== undefined) {
      const source=await ctx.db.get(args.sourceBookingId);
      if (!source || source.diditSessionId!==args.sessionId || (source.diditEventId??null)!==args.expectedEventId ||
          (source.diditEventAt??null)!==args.expectedEventAt || (source.diditManualDecisionAt??null)!==args.expectedManualDecisionAt) return false;
      await ctx.db.patch(source._id,{verificationReuseBlockedSessionId:source.diditSessionId,verificationReuseBlockReason:"The provider decision is no longer eligible for reuse."});
    }
    await revokeReuse(ctx, args.sourceBookingId);
    return true;
  },
});
async function potentialVerificationReuse(ctx: any, bookingId: any) {
    const b = await ctx.db.get(bookingId);
    if (!b || !b.accountId || b.accountAccessRequired !== false || !verificationBookingOpen(b.status) || b.verificationProvider !== "didit" ||
        !["required", "processing", "requires_input", "manual_review", "rejected"].includes(b.idVerifyStatus ?? "required") ||
        !!b.diditSessionId || b.verificationFreshRequired || hasCurrentDiditConcern(b) ||
        b.idVerificationSource === "manual" || b.diditManualDecisionAt ||
        (b.diditSessionId && b.verificationReuseBlockedSessionId === b.diditSessionId) || !verificationCanStart(b)) return null;
    const account: Doc<"accounts"> | null = await accountForRental(ctx,b);
    if (!validReuse(account?.rentalVerification, b)) return null;
    const source = await ctx.db.get(account!.rentalVerification!.sourceBookingId);
    if (!source?.diditSessionId || source.verificationReuseBlockedSessionId === source.diditSessionId || source.accountId !== account?._id || !await verificationReuseOwnerMatches(ctx,source) || !belongsToRentalAccount(source,account) || source.idVerifyStatus !== "verified" || source.idVerificationSource !== "didit" || !["identity","selfie","address"].every(key => source.verificationChecks?.[key as "identity"|"selfie"|"address"] === "approved")) return null;
    return { source };
}
function hasCurrentDiditConcern(booking: any) {
    return !!booking.diditSessionId && (
      ["identity", "selfie", "address"].some(key => ["requires_input", "review", "rejected"].includes(booking.verificationChecks?.[key])) ||
      ((!!booking.diditEventId || booking.idVerificationSource === "didit") && ["requires_input", "manual_review", "rejected"].includes(booking.idVerifyStatus)));
}
async function applyStoredVerificationReuse(ctx: any, booking: any, source: any, event?: { eventId: string; eventAt: number }) {
    if (booking?.idVerifyStatus === "verified" && booking.verificationReusedFrom === source?._id) return !booking.diditSessionId && !hasCurrentDiditConcern(booking);
    if (!booking || !source || !booking.accountId || booking.accountAccessRequired !== false || !verificationBookingOpen(booking.status) ||
        booking.verificationProvider !== "didit" || !["required", "processing", "requires_input", "manual_review", "rejected"].includes(booking.idVerifyStatus ?? "required") ||
        !!booking.diditSessionId || booking.verificationFreshRequired || booking.idVerificationSource === "manual" || booking.diditManualDecisionAt || hasCurrentDiditConcern(booking) ||
        (booking.diditSessionId && booking.verificationReuseBlockedSessionId === booking.diditSessionId) || !verificationCanStart(booking) ||
        !source.diditSessionId || source.verificationReuseBlockedSessionId === source.diditSessionId ||
        source.accountId !== booking.accountId || source.idVerifyStatus !== "verified" || source.idVerificationSource !== "didit" ||
        !["identity", "selfie", "address"].every(key => source.verificationChecks?.[key as "identity" | "selfie" | "address"] === "approved") ||
        !await verificationReuseOwnerMatches(ctx, source)) return false;
    try { await assertVerificationArchive(ctx, source); } catch { return false; }
    const account = await accountForRental(ctx, booking);
    const record = account?.rentalVerification;
    const verifiedUntil = record ? verificationValidUntil(record) : null;
    if (!account || source.accountId !== account._id || !belongsToRentalAccount(source, account) || !record || record.sourceBookingId !== source._id ||
        verifiedUntil == null || !validReuse(record, booking) || verifiedUntil <= Date.now() ||
        booking.lineItems.some((line: any) => !Number.isFinite(line.start) || verifiedUntil <= line.start)) return false;
    if (account.activeDiditVerification?.bookingId === booking._id && !account.activeDiditVerification.sessionId)
      await ctx.db.patch(account._id, { activeDiditVerification: undefined });
    const previousStatus = booking.idVerifyStatus ?? "required";
    await retainVerificationArchiveLink(ctx,booking,source._id);
    await assertRenterExposure(ctx, { ...booking, renterPersonKey: source.renterPersonKey });
    await attachRenterPerson(ctx, booking, source.renterPersonKey);
    await ctx.db.patch(booking._id, {
      renterPersonKey: source.renterPersonKey,
      identityMatchSameAccountSourceBookingId: source._id,
      verificationChecks: source.verificationChecks,
      idVerifyStatus: "verified",
      idVerificationSource: "reused_didit",
      diditDecisionAt: undefined,
      idVerifiedAt: record.verifiedAt,
      verificationExpiresAt: verifiedUntil,
      verificationReusedFrom: source._id,
      verificationInProgressFrom: undefined,
      verificationNote: "Your recent approved identity and address verification was reused for this rental.",
      verificationUpdatedAt: Date.now(),
      ...(event ? { diditEventId: event.eventId, diditEventAt: event.eventAt } : {}),
    });
    await queueRestrictedIdentityCheck(ctx,booking._id,source.diditSessionId,`reuse:${source._id}:${record.verifiedAt}`);
    if (booking.status === "pending_verification") await ctx.scheduler.runAfter(0, internal.checkout.confirmAfterVerification, { bookingId: booking._id });
    await verificationUpdateMessage(ctx, booking._id, previousStatus, "verified");
    await ctx.scheduler.runAfter(0, internal.chat.postBookingMessages, { bookingId: booking._id });
    await queueRentalEmail(ctx, booking._id, "verification", { verificationStatus: "verified" });
    await queueRmv2Sync(ctx, booking._id);
    return true;
}
async function preserveReusableVerification(ctx: any, booking: any, event: { eventId: string; eventAt: number }) {
    if (!booking?.verificationReusedFrom || !booking.accountId || !booking.diditSessionId || booking.idVerificationSource === "manual" ||
        booking.diditManualDecisionAt || booking.verificationReuseBlockedSessionId === booking.diditSessionId) return false;
    const account = await accountForRental(ctx, booking);
    const source = await ctx.db.get(booking.verificationReusedFrom);
    const record = account?.rentalVerification;
    if (!account || account._id !== booking.accountId || !source || source.accountId !== account._id || record?.sourceBookingId !== source._id ||
        source.verificationProvider !== "didit" || source.idVerifyStatus !== "verified" || source.idVerificationSource !== "didit" ||
        !source.diditSessionId || source.verificationReuseBlockedSessionId === source.diditSessionId ||
        !["identity", "selfie", "address"].every(key => source.verificationChecks?.[key as "identity" | "selfie" | "address"] === "approved") ||
        !await verificationReuseOwnerMatches(ctx, source) || !belongsToRentalAccount(source, account) || !validReuse(record, booking)) return false;
    const verifiedUntil = verificationValidUntil(record);
    const verifiedAt = record.verifiedAt ?? source.idVerifiedAt ?? (verifiedUntil == null ? null : verifiedUntil - VERIFICATION_REUSE_DAYS * 86400000);
    const deadline = verificationDeadlineAt(booking);
    if (verifiedUntil == null || verifiedUntil <= Date.now() || verifiedAt == null || deadline == null || verifiedAt >= deadline) return false;
    try { await assertVerificationArchive(ctx, source); } catch { return false; }
    const previous = booking.idVerifyStatus ?? "required";
    await ctx.db.patch(booking._id, {
      diditEventId: event.eventId,
      diditEventAt: event.eventAt,
      renterPersonKey: source.renterPersonKey ?? booking.renterPersonKey,
      idVerifyStatus: "verified",
      idVerificationSource: "reused_didit",
      verificationChecks: source.verificationChecks,
      documentExpiresAt: source.documentExpiresAt,
      diditDecisionAt: undefined,
      idVerifiedAt: verifiedAt,
      verificationExpiresAt: verifiedUntil,
      verificationReusedFrom: source._id,
      verificationInProgressFrom: undefined,
      verificationNote: "Your recent approved identity and address verification was reused for this rental.",
      verificationUpdatedAt: Date.now(),
    });
    if (previous !== "verified") await verificationUpdateMessage(ctx, booking._id, previous, "verified");
    if (previous === "manual_review") await resolveDiditReviewAlerts(ctx, booking._id);
    if (booking.status === "pending_verification" && (booking.paidConfirmedAt || booking.checkoutPaidAt > 0))
      await ctx.scheduler.runAfter(0, internal.checkout.confirmAfterVerification, { bookingId: booking._id });
    await queueRmv2Sync(ctx, booking._id);
    return true;
}
export const reuseVerificationPotential = internalQuery({
  args: { bookingId: v.id("bookings") }, handler: async (ctx, { bookingId }) => !!await potentialVerificationReuse(ctx, bookingId),
});
export const reuseVerificationCandidate = internalQuery({
  args: { bookingId: v.id("bookings") }, handler: async (ctx, { bookingId }) => {
    const candidate=await potentialVerificationReuse(ctx,bookingId);
    if(!candidate)return null;
    const booking=await ctx.db.get(bookingId);
    if(!booking || !verificationBookingOpen(booking.status))return null;
    try { await assertVerificationArchive(ctx, candidate.source); } catch { return null; }
    return candidate;
  },
});
export const applyVerificationReuse = internalMutation({
  args: { bookingId: v.id("bookings"), sourceBookingId: v.id("bookings"), documentExpiresAt: v.optional(v.number()), personKey: v.optional(v.string()) },
  handler: async (ctx, { bookingId, sourceBookingId, documentExpiresAt, personKey }) => {
    const b = await ctx.db.get(bookingId), source = await ctx.db.get(sourceBookingId);
    if (!b || !source || source._id !== sourceBookingId || (documentExpiresAt !== undefined && documentExpiresAt !== source.documentExpiresAt) || personKey !== source.renterPersonKey) return false;
    return applyStoredVerificationReuse(ctx, b, source);
  },
});
export const adminSuspendVerificationReuse = mutation({args:{token:v.string(),bookingId:v.id("bookings"),reason:v.string()},handler:async(ctx,{token,bookingId,reason})=>{
  await assertAdmin(ctx,token,"bookings.adminSuspendVerificationReuse");
  const booking=await ctx.db.get(bookingId);
  if(!booking?.diditSessionId||reason.trim().length<10)throw Error("A verification session and recorded reason are required.");
  await ctx.db.patch(bookingId,{verificationReuseBlockedSessionId:booking.diditSessionId,verificationReuseBlockReason:reason.trim().slice(0,500)});
  await revokeReuse(ctx,bookingId);
}});
export const expireRentalVerifications = internalMutation({
  args: { cursor: v.optional(v.string()) }, handler: async (ctx, { cursor }) => {
    const now = Date.now();
    // A confirmed rental keeps the Didit pass recorded on that booking. The
    // account's separate 90-day reuse record expires for future rentals, but
    // this sweep must not invalidate an already-confirmed booking.
    const statuses = ["pending_verification"] as const;
    const separator = cursor?.indexOf("|") ?? -1;
    const statusIndex = separator < 0 ? 0 : Number(cursor!.slice(0, separator));
    const pageCursor = separator < 0 ? cursor ?? null : cursor!.slice(separator + 1) || null;
    if (!Number.isInteger(statusIndex) || statusIndex < 0 || statusIndex >= statuses.length) return;
    const status = statuses[statusIndex];
    const page = await ctx.db.query("bookings").withIndex("by_status", q => q.eq("status", status))
      .paginate({ numItems: 50, cursor: pageCursor });
    // Revoke the account approval when its 90-day verification window ends.
    // Commit the changed approval and delivery revision together so the
    // receiver can accept the downgrade without relaxing its revision fence.
    for (const b of page.page) if (b.idVerifyStatus === "verified" &&
      (verificationValidUntil(b) ?? 0) <= now) {
      await retainVerificationArchiveLink(ctx,b);
      await revokeReuse(ctx, b._id);
      const previouslyApprovedDiditIdentity = b.idVerificationSource === "didit" && !!b.diditSessionId &&
        /^[a-f0-9]{64}$/.test(b.renterPersonKey ?? "") && Number.isFinite(b.idVerifiedAt) &&
        b.identityRiskNotice !== "The verified person could not be linked to the rental identity record." &&
        b.identityRiskNotice !== "Didit approved the identity, but cross-account identity matching is unavailable." &&
        (["identity", "selfie", "address"] as const).every(key => b.verificationChecks?.[key] === "approved");
      const owner = b.accountId ? await ctx.db.get(b.accountId) : null;
      if (owner?.activeDiditVerification?.bookingId === b._id)
        await ctx.db.patch(owner._id, { activeDiditVerification: undefined });
      await ctx.db.patch(b._id, { status: "pending_verification", idVerifyStatus: "requires_input", diditSessionId: undefined, verificationReusedFrom: undefined,
        ...(previouslyApprovedDiditIdentity && !b.identityMatchSameAccountSourceBookingId ? { identityMatchSameAccountSourceBookingId: b._id } : {}),
        verificationExpiresAt: undefined, verificationUpdatedAt: now, verificationNote: "Your verification expired. Complete a new check before handover." });
      await verificationUpdateMessage(ctx, b._id, "verified", "requires_input");
      await queueRmv2Sync(ctx, b._id);
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.bookings.expireRentalVerifications, { cursor: `${statusIndex}|${page.continueCursor}` });
    else if (statusIndex + 1 < statuses.length) await ctx.scheduler.runAfter(0, internal.bookings.expireRentalVerifications, { cursor: `${statusIndex + 1}|` });
  },
});

export const adminRequireReverification = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), note: v.string() },
  handler: async (ctx, { token, bookingId, note }) => {
    const reason = note.trim();
    await assertAdmin(ctx, token, "bookings.adminRequireReverification", { entityId: String(bookingId), reason: reason.slice(0, 300) });
    const b = await ctx.db.get(bookingId);
    if (!b || b.status !== "confirmed" || b.idVerifyStatus !== "verified" || b.cancellationDecision || verificationWindowClosed(b) || reason.length < 10) throw Error("An upcoming, verified rental with an open verification window and a recorded reason are required.");
    const previousStatus = b.idVerifyStatus;
    await retainVerificationArchiveLink(ctx,b);
    if (b.verificationReusedFrom) await revokeReuse(ctx, b.verificationReusedFrom);
    await revokeReuse(ctx, bookingId);
    const account = b.accountId ? await ctx.db.get(b.accountId) : null;
    if (account?.activeDiditVerification?.bookingId === bookingId)
      await ctx.db.patch(account._id, { activeDiditVerification: undefined });
    await ctx.db.patch(bookingId, { idVerifyStatus: "requires_input", verificationProvider: "didit", verificationFreshRequired: true,
      verificationReusedFrom: undefined, verificationChecks: undefined, verificationExpiresAt: undefined, documentExpiresAt: undefined,
      verificationInProgressFrom: undefined, idVerifiedAt: undefined, idVerificationSource: undefined, diditSessionId: undefined, stripeIdentitySessionId: undefined,
      diditEventId: undefined, diditEventAt: undefined, diditReviewClaim: undefined,
      diditSessionApprovalSeen: undefined, diditSessionApprovedAt: undefined, diditDecisionAt: undefined, diditManualDecisionAt: undefined,
      diditReconciledAt: undefined, diditRetryWindowAt: undefined, diditRetryAttempts: undefined,
      verificationNote: `A new check is required before handover: ${reason.slice(0, 300)}`, verificationUpdatedAt: Date.now() });
    await verificationUpdateMessage(ctx, bookingId, previousStatus, "requires_input");
    await queueRentalEmail(ctx, bookingId, "verification", { verificationStatus: "requires_input" });
    await queueRmv2Sync(ctx, bookingId);
  },
});

/** One rental subscription: authenticated account or its exact paid Checkout bearer. */
export const verificationProgress = query({
  args: { bookingId: v.id("bookings"), token: v.optional(v.string()), checkoutSessionId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.bookingId);
    if (!b) return null;
    let allowed = false;
    if (a.token) {
      const account = await accountForToken(ctx, a.token);
      if (account) { try { await ownedBooking(ctx, account, b._id); allowed = true; } catch {} }
    }
    if (!allowed && a.checkoutSessionId && a.checkoutSessionId === b.stripeCheckoutSessionId && verificationBookingOpen(b.status)) allowed = true;
    if (!allowed) return null;
    let verificationArchiveReady = false;
    if (b.idVerifyStatus === "verified") { try { await assertVerificationArchive(ctx, b); verificationArchiveReady = true; } catch {} }
    const images = new Map<string, string[]>();
    for (const line of b.lineItems) if (!images.has(String(line.listingId))) images.set(String(line.listingId), listingRentalImages(await ctx.db.get(line.listingId)));
    return { _id: b._id, status: b.status, idVerifyStatus: b.idVerifyStatus ?? "required",
      verificationAvailable: verificationCanStart(b),
      verificationWindowClosed: verificationWindowClosed(b),
      verificationSyncAvailable: verificationBookingOpen(b.status) && b.verificationProvider === "didit" && !!b.diditSessionId,
      verificationDeadlineAt: verificationDeadlineAt(b),
      rentalManagerSyncPending: b.status === "pending_verification" && b.rmv2SyncStatus !== "delivered",
      cancellationPending: !!b.cancellationDecision && b.status !== "cancelled",
      returnPending: !!b.returnDecision && b.status !== "returned",
      idVerificationSource: b.idVerificationSource ?? null,
      securityHoldPolicyVersion:b.securityHoldPolicyVersion??null, verificationArchiveReady, verificationExpiresAt: verificationValidUntil(b), documentExpiresAt: b.documentExpiresAt ?? null,
      requiresDroneLicence: await requiresDroneLicence(ctx, b), droneLicenceStatus: await droneLicenceStatusForRental(ctx, b), droneLicenceNote: b.droneLicenceNote ?? null,
      verificationNote: renterVerificationNote(b.verificationNote), verificationChecks: b.verificationChecks ?? null,
      verificationConfirmationIssue: b.verificationConfirmationIssue ?? null,
      lateVerificationApprovalBlocked: b.verificationLateBlockedProviderStatus === "Approved" && !!b.verificationLateBlockedAt,
      verificationUpdatedAt: b.verificationUpdatedAt ?? null, verificationReused: !!b.verificationReusedFrom,
      depositHoldAmount: b.depositHoldAmount ?? 0, depositHoldStatus: b.depositHoldStatus ?? null,
      securityPolicyVersion:b.securityPolicyVersion??null,savedCardStatus:b.savedCardStatus??null,savedCardLimit:b.savedCardLimit??null,
      depositHoldExpiresAt: b.depositHoldExpiresAt ?? null, securityHoldDueAt: b.securityHoldDueAt ?? null,
      fulfilment: b.fulfilment, total: b.total, subtotal: b.subtotal, discount: b.discount ?? 0,
      deliveryFee: b.deliveryFee ?? 0, depositAmount: b.depositAmount ?? 0,
      creditApplied: b.creditApplied ?? 0, membershipCreditApplied: b.membershipCreditApplied ?? 0,
      lineItems: b.lineItems.map(line => ({ title: line.title, start: line.start, end: line.end, qty: line.qty,
        pickupTime: "pickupTime" in line ? typeof line.pickupTime === "string" ? line.pickupTime : null : b.pickupTime ?? null,
        returnTime: line.returnTime === undefined ? b.returnTime ?? null : line.returnTime,
        images: images.get(String(line.listingId)) ?? [], lineTotal: line.lineTotal })),
    };
  },
});

/** Persist the first provider attempt before sending it; retries preserve that identity. */
export const recordDepositReturnReceipt=internalMutation({args:{bookingId:v.id("bookings"),receipt:depositReturnReceipt},handler:async(ctx,{bookingId,receipt})=>{
 const b=await ctx.db.get(bookingId);
 if(!b||!hasCashDepositPolicy(b.securityPolicyVersion)||!b.returnDecision||b.returnDecision.depositKept===undefined)throw Error("A frozen refundable-deposit decision is required.");
 const sources=await rentalPaymentSources(ctx,b),amountPence=Math.round((b.depositAmount-b.returnDecision.depositKept)*100);
 const allocation=securityReturnPlan(sources,amountPence).find(row=>row.paymentIntentId===receipt.paymentIntentId);
 if(!allocation||receipt.amountPence!==allocation.amountPence||!Number.isSafeInteger(receipt.attemptedAt)||receipt.attemptedAt<=0)throw Error("The refund receipt does not match the frozen deposit allocation.");
 const rows=b.depositReturnReceipts??[],previous=rows.find(row=>row.paymentIntentId===receipt.paymentIntentId);
 const duplicateInitialAttempt=!!previous&&previous.amountPence===receipt.amountPence&&previous.attemptKey===undefined&&receipt.attemptKey===undefined&&previous.status==="unknown"&&receipt.status==="unknown"&&!previous.stripeRefundId&&!receipt.stripeRefundId&&!previous.approvalRequestId&&!receipt.approvalRequestId;
 if(previous&&(previous.amountPence!==receipt.amountPence||previous.attemptedAt!==receipt.attemptedAt&&!duplicateInitialAttempt||previous.attemptKey!==receipt.attemptKey||(previous.stripeRefundId&&previous.stripeRefundId!==receipt.stripeRefundId)||(previous.approvalRequestId&&previous.approvalRequestId!==receipt.approvalRequestId)))throw Error("The original deposit refund identity cannot be replaced.");
 // Parallel mark-returned actions may race to persist the same not-yet-sent
 // refund. Keep the first timestamp as canonical so both use the same age and
 // immutable Stripe idempotency identity. A provider-backed or retry receipt
 // can never take this path.
 if(previous&&duplicateInitialAttempt)return previous;
 if(previous&&JSON.stringify(previous)===JSON.stringify(receipt))return previous;
 const updated=[...rows.filter(row=>row.paymentIntentId!==receipt.paymentIntentId),receipt],state=depositRefundState(updated,amountPence);
 await ctx.db.patch(bookingId,{depositReturnReceipts:updated,...(b.returnStatement?{returnStatement:{...b.returnStatement,...depositRefundStatementFields({...b,depositReturnReceipts:updated})}}:{}),...(["failed","awaiting_approval","processing"].includes(state)?{depositRefunded:false}:{})});await queueRmv2Sync(ctx,bookingId);
 if(["failed","awaiting_approval"].includes(receipt.status)&&previous?.status!==receipt.status)await queueOwnerNotification(ctx,{eventKey:`deposit-refund-${receipt.status}:${bookingId}:${receipt.stripeRefundId??receipt.approvalRequestId??receipt.attemptedAt}`,kind:"deposit_refund_failure",bookingId,...(b.accountId?{accountId:b.accountId}:{}),title:"Deposit refund needs attention",body:receipt.status==="failed"?"Stripe reports a failed deposit refund. Open the rental and review the original payment before retrying.":"Stripe requires approval for a deposit refund. Open the rental to review it."});
 return receipt;
}});

export const alertDepositRecovery=internalMutation({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
 const b=await ctx.db.get(bookingId);if(!b?.returnDecision)return;
 const cashPolicy=hasCashDepositPolicy(b.securityPolicyVersion);
 const hasHoldIntent=!!(b.stripeDepositIntentId||b.depositHoldRenewalIntentId||(b.depositHoldPreviousIntentIds??[]).length);
 const savedCardHoldReturn=!cashPolicy&&isSavedCardRental(b)&&hasHoldIntent;
 if(!cashPolicy&&!savedCardHoldReturn)return;
 if(cashPolicy){
  const state=depositRefundState(b.depositReturnReceipts??[],Math.round(Math.max(0,b.depositAmount-(b.returnDecision.depositKept??0))*100));
  if(b.actualReturnedAt&&b.depositRefunded&&state==="succeeded")return;
 }
 await queueOwnerNotification(ctx,{eventKey:`deposit-return-recovery:${bookingId}:${b.returnDecision.startedAt}`,kind:cashPolicy?"deposit_refund_failure":"checkout_failure",bookingId,...(b.accountId?{accountId:b.accountId}:{}),title:cashPolicy?"Deposit return needs attention":"Card hold release needs attention",body:cashPolicy?"The saved return has not fully settled. Open the rental and check the Stripe refund before taking action.":"A saved return could not finish releasing its card authorisation. Open the rental to check the hold status before retrying."});
}});

export const beginDepositRefundRetry=internalMutation({args:{bookingId:v.id("bookings"),refundId:v.string(),requestId:v.string(),expectedSnapshot:v.string()},handler:async(ctx,a)=>{
 const b=await ctx.db.get(a.bookingId);if(!b||!hasCashDepositPolicy(b.securityPolicyVersion)||!b.returnDecision||!/^[a-zA-Z0-9-]{16,80}$/.test(a.requestId))throw Error("Invalid deposit refund retry.");
 const history=b.depositReturnReceiptHistory??[],rows=b.depositReturnReceipts??[];
 const replay=rows.find(r=>r.attemptKey===a.requestId);if(replay&&history.some(r=>r.stripeRefundId===a.refundId&&r.paymentIntentId===replay.paymentIntentId))return replay;
 const refunds=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",a.bookingId)).take(101);if(refunds.length>100||rentalControlsSnapshot(b,refunds)!==a.expectedSnapshot)throw Error("The refund changed after review. Refresh and review again.");
 const old=rows.find(r=>r.stripeRefundId===a.refundId);if(!old||old.status!=="failed"||history.length>=100)throw Error("Only a provider-confirmed failed refund can be retried.");
 const receipt={paymentIntentId:old.paymentIntentId,amountPence:old.amountPence,attemptedAt:Date.now(),attemptKey:a.requestId,status:"unknown" as const};
 await ctx.db.patch(b._id,{depositRefunded:false,depositReturnReceiptHistory:[...history,old],depositReturnReceipts:rows.map(r=>r===old?receipt:r)});await queueRmv2Sync(ctx,b._id);return receipt;
}});
export const depositSettlementStatus=query({args:{token:v.string(),bookingId:v.id("bookings")},handler:async(ctx,a)=>{if(!checkAdminToken(a.token))throw Error("unauthorized");const b=await ctx.db.get(a.bookingId);if(!b)return null;const refunds=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",a.bookingId)).take(101);if(refunds.length>100)throw Error("Refund history requires review.");return {...depositRefundProjection(b),decided:!!b.returnDecision,snapshot:rentalControlsSnapshot(b,refunds)};}});
