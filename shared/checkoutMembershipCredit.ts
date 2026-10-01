import { monthlyCreditPence, tierByKey } from "./membership";

export const MEMBERSHIP_BASKET_MINIMUM: Record<string, number> = {plus:100, pro:200, studio:300};
export function starterRentalOffer(tier: string | undefined, intro: string | undefined, rentalSpend: number, used = false) {
  return tier === "plus" && intro === "none" && !used && Math.round(rentalSpend * 100) >= 10000 ? 10 : 0;
}

/** First paid month's credit is tender for this rental, never the fee or security. */
export function checkoutMembershipCredit(tier: string | undefined, intro: string | undefined, rentalPence: number, debtPence = 0) {
  const plan = tier ? tierByKey(tier) : undefined;
  if (!plan || intro !== "none") return { earnedPence: 0, appliedPence: 0 };
  const earnedPence = monthlyCreditPence(Math.round(plan.monthlyGbp * 100), plan.key);
  const available = Math.max(0, earnedPence - Math.max(0, debtPence));
  return { earnedPence, appliedPence: Math.min(available, Math.max(0, rentalPence)) };
}
