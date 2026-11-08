import { membershipActiveNow } from "./membership";

/** A subscription badge/filter must reflect an active Stripe plan, not a complimentary access grant. */
export function customerSubscriptionTier(account: any): "plus" | "pro" | "studio" | null {
  const tier = account?.membershipTier;
  if (!account?.stripeSubscriptionId || account.membershipSource === "collective-comp" ||
      !["plus", "pro", "studio"].includes(tier)) return null;
  return membershipActiveNow({ ...account, adminMembershipTier: undefined }) ? tier : null;
}

export function customerAdminVisual(account: any, earnedEncoreLevel = 0): "guest" | "encore1" | "encore2" | "encore3" | "subscriber" {
  if (customerSubscriptionTier(account)) return "subscriber";
  const level = account.adminEncoreLevel ?? earnedEncoreLevel;
  return level === 1 ? "encore1" : level === 2 ? "encore2" : level === 3 ? "encore3" : "guest";
}
