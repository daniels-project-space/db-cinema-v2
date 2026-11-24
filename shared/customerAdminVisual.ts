import { membershipActiveNow } from "./membership";

/** A subscription badge/filter must reflect an active Stripe plan, not a complimentary access grant. */
export function customerSubscriptionTier(account: any): "plus" | "pro" | "studio" | null {
  const tier = account?.membershipTier;
  if (!account?.stripeSubscriptionId || account.membershipSource === "collective-comp" ||
      !["plus", "pro", "studio"].includes(tier)) return null;
  // A live free trial is a real plan to display and filter in admin, but it is
  // not rental-benefit entitlement. `membershipActiveNow` remains the price/credit gate.
  if (account.membershipStatus === "trialing" && account.membershipActive === true &&
      (account.membershipTrialEnd ?? 0) > Date.now() && account.blockedAt == null &&
      !account.membershipPerksPendingBookingId) return tier;
  return membershipActiveNow({ ...account, adminMembershipTier: undefined }) ? tier : null;
}

export function customerAdminVisual(account: any, earnedEncoreLevel = 0): "guest" | "assigned" | "encore1" | "encore2" | "encore3" | "subscriber" {
  if (customerSubscriptionTier(account)) return "subscriber";
  const earned = [1, 2, 3].includes(earnedEncoreLevel) ? earnedEncoreLevel : 0;
  if (earned) return `encore${earned}` as "encore1" | "encore2" | "encore3";
  return [1, 2, 3].includes(account.adminEncoreLevel) ? "assigned" : "guest";
}
