import { loyaltyProgress } from "./loyalty";
import { firstCleanRentalCompletionAt } from "./membershipTrialActivation";

const validTimestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

export async function firstEligibleRentalConfirmationAt(ctx: any, account: any) {
  const knownAt = [account?.firstRentalPaidAt, account?.membershipFirstRentalConfirmedAt, account?.membershipTrialFirstRentalCompletedAt]
    .find(validTimestamp);
  if (knownAt !== undefined) return knownAt;
  const statuses = ["confirmed", "active", "returned", "cancelled"];
  const feeds = await Promise.all(statuses.flatMap(status => [
    ctx.db.query("bookings").withIndex("by_account_status", (q: any) => q.eq("accountId", account._id).eq("status", status)).order("asc").take(1),
    ctx.db.query("bookings").withIndex("by_guestEmail_status", (q: any) => q.eq("guestEmail", account.email.trim().toLowerCase()).eq("status", status))
      .filter((q: any) => q.eq(q.field("accountId"), undefined)).order("asc").take(1),
  ]));
  const rentals = feeds.flat();
  let firstConfirmedAt: number | undefined;
  for (const booking of rentals) {
    const paidConfirmedAt = validTimestamp(booking.paidConfirmedAt) ? booking.paidConfirmedAt : undefined;
    const confirmedStatus = ["confirmed", "active", "returned"].includes(booking.status);
    const cancelledAfterConfirmation = booking.status === "cancelled" && paidConfirmedAt !== undefined;
    const legacyConfirmedAt = confirmedStatus && validTimestamp(booking._creationTime) ? booking._creationTime : undefined;
    const confirmedAt = paidConfirmedAt ?? (cancelledAfterConfirmation ? undefined : legacyConfirmedAt);
    if (confirmedAt !== undefined && (firstConfirmedAt === undefined || confirmedAt < firstConfirmedAt))
      firstConfirmedAt = confirmedAt;
  }
  return firstConfirmedAt;
}

/** Existing accounts may predate the firstRentalPaidAt marker. Recover it from
 * a bounded slice of rental history without treating an unpaid basket or a
 * pending-verification booking as the first eligible rental. */
export async function membershipRentalBenefitAccount(ctx: any, account: any) {
  if (!account) return account;
  if (account.blockedAt != null) return { ...account, membershipFirstCleanRentalCompletedAt: undefined };
  const completedAt = [account.firstCleanRentalCompletedAt, account.membershipTrialFirstRentalCompletedAt]
    .find(validTimestamp) ?? await firstCleanRentalCompletionAt(ctx, account);
  return { ...account, membershipFirstCleanRentalCompletedAt: completedAt };
}

export async function checkoutBenefitAccount(ctx: any, account: any) {
  if (!account) return null;
  const benefitAccount = await membershipRentalBenefitAccount(ctx, account);
  const loyalty = await loyaltyProgress(ctx, benefitAccount);
  return { ...benefitAccount, loyaltyEligible: loyalty.eligible, loyaltyLevel: loyalty.level, loyaltyPercent: loyalty.percent,
    loyaltyCompleted: loyalty.completed, loyaltyHistoricalLevel: loyalty.historicalLevel, loyaltyAdminAssigned: loyalty.adminAssigned };
}

export async function rentalBenefitAccount(ctx: any, account: any) {
  if (!account) return account;
  const withRentalMarker = await membershipRentalBenefitAccount(ctx, account);
  if (account.rentalBenefitsResolved) return withRentalMarker;
  if (account.blockedAt != null) return { ...withRentalMarker, loyaltyEligible: false, loyaltyLevel: 0, loyaltyPercent: 0, loyaltyCompleted: 0, loyaltyAdminAssigned: false, rentalBenefitsResolved: true };
  const progress = await loyaltyProgress(ctx, account);
  return { ...withRentalMarker, loyaltyEligible: progress.eligible, loyaltyLevel: progress.level ?? 0, loyaltyPercent: progress.percent, loyaltyCompleted: progress.completed, loyaltyAdminAssigned: account.adminEncoreLevel != null, rentalBenefitsResolved: true };
}
