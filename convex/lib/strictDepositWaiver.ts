import { loyaltyProgress } from "./loyalty";
import { returnInspectionSchedule } from "./returnInspection";
import { sameReturnInspection } from "../../shared/returnInspection";

const MAX_PRIOR_RENTALS = 100;
const MAX_RENTAL_HISTORY = 100;

async function cleanCompletedRental(ctx: any, booking: any, account: any) {
  const decision = booking?.returnDecision;
  const statement = booking?.returnStatement;
  const inspection = decision?.inspection;
  if (!booking || booking.status !== "returned" || booking.accountId !== account._id ||
      !Number.isSafeInteger(booking.paidConfirmedAt) || !Number.isSafeInteger(booking.actualReturnedAt) ||
      !decision || decision.actualReturnedAt !== booking.actualReturnedAt || decision.chargeLate ||
      (decision.lateClaimReason ?? "").trim() || (decision.damageKept ?? 0) !== 0 || (decision.depositKept ?? 0) !== 0 ||
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

export async function strictDepositWaiverReason(ctx: any, account: any, replacementValuePence: number, now = Date.now()) {
  if (!account?._id || account.blockedAt != null || !Number.isSafeInteger(replacementValuePence) ||
      replacementValuePence <= 0 || replacementValuePence >= 400000) return undefined;

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
