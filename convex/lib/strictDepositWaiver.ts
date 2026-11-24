import { loyaltyProgress } from "./loyalty";
import { accountVerificationReady } from "./accountVerificationReady";
import { checkoutCreditFullyCoversDue } from "./cleanCompletedRental";
import { ASSESSMENT_SECURITY_POLICY_VERSION, isCardHoldSecurityPolicy } from "../../shared/rentalSecurity";

export { checkoutCreditFullyCoversDue };

export async function checkoutWaiverReason(ctx: any, booking: any, replacementValuePence: number, customerAccount: any) {
  const waiverPolicy = booking.securityPolicyVersion === ASSESSMENT_SECURITY_POLICY_VERSION || isCardHoldSecurityPolicy(booking.securityPolicyVersion);
  const signedAccount = booking.accountId ? await ctx.db.get(booking.accountId) : null;
  return waiverPolicy && !booking.membershipCheckoutId && signedAccount && signedAccount._id === customerAccount?._id
    ? strictDepositWaiverReason(ctx, signedAccount, replacementValuePence, booking.lineItems.map((line: any) => line.start), booking.agreementName, booking.billingAddress) : undefined;
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

  const progress = await loyaltyProgress(ctx, account);
  if (progress.hasCleanCompletedRental !== true) return undefined;
  // The membership route needs one clean settled return. Encore III remains
  // the separate review-earned route; manual assignments never waive security.
  if (progress.completed !== null && progress.completed >= 3) return "encore" as const;

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
