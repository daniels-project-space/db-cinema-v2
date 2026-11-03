import { membershipActiveNow } from "./membership";

export function customerAdminVisual(account: any): "guest" | "encore1" | "encore2" | "encore3" | "subscriber" {
  const subscriber = !!account.stripeSubscriptionId && account.membershipSource !== "collective-comp" &&
    ["plus", "pro", "studio"].includes(account.membershipTier) &&
    membershipActiveNow({ ...account, adminMembershipTier: undefined });
  if (subscriber) return "subscriber";
  const level = account.adminEncoreLevel;
  return level === 1 ? "encore1" : level === 2 ? "encore2" : level === 3 ? "encore3" : "guest";
}
