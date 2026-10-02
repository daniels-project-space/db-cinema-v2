import { tierByKey } from "./membership";
export type MembershipSelection = {
  tier: string;
  intro: "trial" | "none";
  termsAccepted: boolean;
};
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
/** Local storage is a preference, never subscription entitlement or consent. */
export function restoreMembershipSelection(
  value: unknown,
): MembershipSelection | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.tier !== "string" ||
    !tierByKey(v.tier) ||
    !["trial", "none"].includes(String(v.intro))
  )
    return null;
  return {
    tier: v.tier,
    intro: "none",
    termsAccepted: false,
  };
}
