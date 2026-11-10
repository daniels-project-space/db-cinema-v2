import { loyaltyProgress } from "./loyalty";
import { returnInspectionSchedule } from "./returnInspection";
import { sameReturnInspection } from "../../shared/returnInspection";
import { accountVerificationReady } from "./accountVerificationReady";

const MAX_PRIOR_RENTALS = 100;
const MAX_RENTAL_HISTORY = 100;

export function checkoutCreditFullyCoversDue(booking:any){
  const fullDue=booking?.subtotal+(booking?.deliveryFee??0)+(booking?.depositAmount??0)-(booking?.discount??0);
  const applied=booking?.creditApplied??0;
  return Number.isFinite(fullDue)&&fullDue>0&&Number.isFinite(applied)&&applied>0&&
    Math.round(applied*100)>=Math.round(fullDue*100);
}

function hasCheckoutPaymentProof(booking:any,expectedPaidPence:number){
  const at=booking?.checkoutPaidAt;
  if(!Number.isSafeInteger(at)||at<=0||!Number.isSafeInteger(booking?.checkoutPaymentAmountPence===undefined?0:booking.checkoutPaymentAmountPence))return false;
  const currency=typeof booking.checkoutPaymentCurrency==="string"?booking.checkoutPaymentCurrency:booking.currency;
  if(typeof currency!=="string"||currency.toLowerCase()!==String(booking.currency??"GBP").toLowerCase()||booking.currency?.toLowerCase()!=="gbp")return false;
  const hasNewFields=booking.checkoutPaymentAmountPence!==undefined||booking.checkoutPaymentCurrency!==undefined||booking.checkoutPaymentStatus!==undefined;
  if(hasNewFields){
    const amount=booking.checkoutPaymentAmountPence;
    if(!Number.isSafeInteger(amount)||amount<expectedPaidPence||booking.checkoutPaymentCurrency?.toLowerCase()!==booking.currency?.toLowerCase())return false;
    if(Number.isSafeInteger(booking.checkoutExpectedAmountPence)&&amount!==booking.checkoutExpectedAmountPence)return false;
    if(amount>0)return !!booking.stripePaymentIntentId&&booking.checkoutPaymentStatus==="paid";
    return booking.checkoutPaymentStatus==="no_payment_required"&&expectedPaidPence===0&&checkoutCreditFullyCoversDue(booking)&&booking.checkoutCreditState==="spent";
  }
  // Legacy confirmed rentals recorded a paid Checkout timestamp and intent ID
  // before amount/currency fields were persisted. Stripe Checkout's paid state
  // is already the committed agreement for these closed rentals; preserve that
  // evidence without retroactively changing their terms.
  if(booking.stripePaymentIntentId)return expectedPaidPence>0;
  return expectedPaidPence===0&&checkoutCreditFullyCoversDue(booking)&&booking.checkoutCreditState==="spent";
}

async function cleanCompletedRental(ctx: any, booking: any, account: any) {
  const decision = booking?.returnDecision;
  const statement = booking?.returnStatement;
  const inspection = decision?.inspection;
  const expectedPaidPence=Number.isSafeInteger(booking?.rentalPaidPence)?booking.rentalPaidPence:Math.round((booking?.total??0)*100);
  const paymentProof=hasCheckoutPaymentProof(booking,expectedPaidPence);
  if (!booking || booking.status !== "returned" || booking.accountId !== account._id ||
      !Number.isSafeInteger(booking.paidConfirmedAt) || !Number.isSafeInteger(booking.actualReturnedAt) ||
      !Number.isSafeInteger(expectedPaidPence) || expectedPaidPence < 0 || !paymentProof ||
      !decision || decision.actualReturnedAt !== booking.actualReturnedAt || decision.chargeLate ||
      (decision.lateClaimReason ?? "").trim() || (decision.damageKept ?? 0) !== 0 || (decision.depositKept ?? 0) !== 0 ||
      booking.stripeDisputedAt != null ||
      !statement || statement.actualReturnedAt !== booking.actualReturnedAt || !Array.isArray(inspection) || !inspection.length ||
      !Array.isArray(statement.inspection) || !sameReturnInspection(inspection, statement.inspection) ||
      (booking.depositKept ?? 0) !== 0 || (booking.depositHoldCapturedForDamage ?? 0) !== 0 ||
      (booking.lateFeeAmount ?? 0) !== 0 || (booking.lateFeeWaivedAmount ?? 0) !== 0 ||
      (statement.damageTotal ?? 0) !== 0 || (statement.damageFromHold ?? 0) !== 0 ||
      (statement.lateAssessed ?? 0) !== 0 || (statement.lateWaived ?? 0) !== 0 ||
      (statement.rentalRefunded ?? 0) !== 0 || booking.cancellationDecision) return false;

  if (inspection.some((item: any) => item.condition !== "good" || item.details?.trim() || item.openCase)) return false;

  const history = await ctx.db.query("reservations")
    .withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id))
    .take(501);
  if (history.length > 500) return false;
  const active = history.filter((row: any) => ["confirmed", "active", "returned"].includes(row.status));
  if (active.some((row: any) => row.status !== "returned" || row.extensionRequestId)) return false;

  let schedule: any[];
  try {
    schedule = await returnInspectionSchedule(ctx, { ...booking, returnDecision: undefined }, history);
  } catch {
    return false;
  }
  if (!schedule.length || schedule.length !== inspection.length) return false;
  const inspected = new Map(inspection.map((item: any) => [item.key, item]));
  if (inspected.size !== schedule.length || schedule.some((item: any) => {
    const actual: any = inspected.get(item.key);
    return !actual || actual.title !== item.title || (actual.sku ?? null) !== (item.sku ?? null) ||
      String(actual.inventoryUnitId ?? "") !== String(item.inventoryUnitId ?? "");
  })) return false;

  if ((booking.depositAmount ?? 0) > 0 && (!booking.depositRefunded ||
      Math.round((booking.depositRefundAmount ?? 0) * 100) !== Math.round(booking.depositAmount * 100) ||
      Math.round((statement.securityRefunded ?? 0) * 100) !== Math.round((statement.securityPaid ?? 0) * 100))) return false;
  if ((booking.depositHoldAmount ?? 0) > 0 &&
      (!(["released", "canceled", "not_applicable"].includes(statement.holdStatus ?? booking.depositHoldStatus ?? "")) ||
        (booking.depositHoldCapturedForDamage ?? 0) > 0)) return false;

  const cases = await ctx.db.query("rental_damage_cases")
    .withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).take(1);
  if (cases.length) return false;
  const securityClaims = await ctx.db.query("rental_security_charges")
    .withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).take(1);
  if (securityClaims.length) return false;
  const refunds = await ctx.db.query("rental_refunds")
    .withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).take(1);
  if (refunds.length) return false;

  for (const [table, allowed] of [
    ["rental_additions", new Set(["applied", "applied_draft", "expired", "refunded"])],
    ["rental_price_adjustments", new Set(["applied", "withdrawn", "expired", "refunded"])],
    ["booking_change_requests", new Set(["applied", "approved", "declined", "expired", "withdrawn", "refunded"])],
  ] as const) {
    const rows = await ctx.db.query(table)
      .withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).take(MAX_RENTAL_HISTORY + 1);
    if (rows.length > MAX_RENTAL_HISTORY || rows.some((row: any) => !allowed.has(row.status))) return false;
  }

  return true;
}

export async function strictDepositWaiverReason(
  ctx: any,
  account: any,
  replacementValuePence: number,
  starts: number[] = [Date.now()],
  agreementName = account?.name,
  billingAddress = account?.address,
  now = Date.now(),
) {
  if (!account?._id || account.blockedAt != null || !Number.isSafeInteger(replacementValuePence) ||
      replacementValuePence <= 0 || replacementValuePence >= 400000) return undefined;
  if (!await accountVerificationReady(ctx, account, agreementName, billingAddress, starts)) return undefined;

  const history = await ctx.db.query("bookings")
    .withIndex("by_account_status", (q: any) => q.eq("accountId", account._id).eq("status", "returned"))
    .order("desc").take(MAX_PRIOR_RENTALS);
  let hasCleanRental = false;
  for (const booking of history) {
    if (await cleanCompletedRental(ctx, booking, account)) {
      hasCleanRental = true;
      break;
    }
  }
  if (!hasCleanRental) return undefined;

  const progress = await loyaltyProgress(ctx, account);
  // Deposit waivers require earned Encore III. An admin Encore override is a
  // display/pricing setting and must not replace three qualifying rentals.
  if (progress.completed >= 3) return "encore" as const;

  if (!account.stripeSubscriptionId || !account.membershipActive || account.membershipStatus !== "active" ||
      account.membershipSource === "collective-comp" || account.membershipPerksPendingBookingId ||
      (account.membershipPaidThrough ?? 0) <= now) return undefined;

  const grants = await ctx.db.query("membership_credit_grants")
    .withIndex("by_account", (q: any) => q.eq("accountId", account._id))
    .order("desc").take(100);
  const paid = grants.some((grant: any) => grant.subscriptionId === account.stripeSubscriptionId &&
    grant.periodEnd > now && Number.isSafeInteger(grant.paidMembershipPence) && grant.paidMembershipPence > 0 &&
    Number.isSafeInteger(grant.membershipRefundedPence ?? 0) &&
    (grant.membershipRefundedPence ?? 0) >= 0 && (grant.membershipRefundedPence ?? 0) < grant.paidMembershipPence);
  return paid ? "active_membership" as const : undefined;
}
