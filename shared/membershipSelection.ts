import { tierByKey } from "./membership";
export type MembershipSelection = {
  tier: string;
  intro: "trial" | "none";
  termsAccepted: boolean;
};
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
