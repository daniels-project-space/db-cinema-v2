export type MembershipSelection = {
  tier: string;
  intro: "trial" | "none";
  termsAccepted: boolean;
};
/** An offer preview can survive only a membership toggle. Changes to the kit,
 * dates, identity, benefits, delivery or promotion invalidate it immediately.
 * This key is never used to accept a billing quote or enable payment. */
export function membershipOfferContext(args: Record<string, unknown>) {
  const { selectedMembership: _selection, ...context } = args;
  return JSON.stringify(context);
}
export function membershipRecommendationPreview<T>(
  previous: { offerContext: string; recommendations: T[] } | null,
  context: string,
  unavailable: boolean,
): T[] | undefined {
  return !unavailable && previous?.offerContext === context
    ? previous.recommendations
    : undefined;
}
/** These live account values affect quotes even when the basket stays the same. */
export function accountPricingContext(account?: {
  membershipActive?: boolean;
  membershipTier?: string | null;
  membershipIntroUsed?: boolean;
  membershipPaidThrough?: number | null;
  membershipTrialEnd?: number | null;
  earnedCredit?: number;
  refundCredit?: number;
  loyaltyPercent?: number;
} | null) {
  return JSON.stringify([
    account?.membershipActive, account?.membershipTier,
    account?.membershipIntroUsed, account?.membershipPaidThrough,
    account?.membershipTrialEnd, account?.earnedCredit,
    account?.refundCredit, account?.loyaltyPercent,
  ]);
}
/** Reopened preferences are not consent. Let a profitable offer replace a
 * stale, unconfirmed plan after authoritative repricing, never a confirmed one. */
export function shouldResetMembershipPreference(
  selection: MembershipSelection | null,
  quote: { membershipNetSaving: number; recommendations: { netSaving: number }[] },
): boolean {
  return !!selection && !selection.termsAccepted &&
    quote.membershipNetSaving <= 0 &&
    quote.recommendations.some((offer) => offer.netSaving > 0);
}
/** Restoring an unchecked plan applied its credits without fresh opt-in.
 * A new subscription is session-only; paid account entitlement is server-owned. */
export function restoreMembershipSelection(
  _value: unknown,
): MembershipSelection | null {
  return null;
}
