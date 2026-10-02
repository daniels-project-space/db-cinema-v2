import { membershipActiveNow, membershipTierFor } from "../../shared/membership";
import { tierByKey } from "../../shared/membership";
export function londonMonth(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
}
/** Pending reservations stay reserved until provider reconciliation, including beyond their soft TTL. */
export async function studioDeliveryAvailable(ctx: any, account: any, month: string, prospective = false) {
  if (!account || (!prospective && (!membershipActiveNow(account) || tierByKey(membershipTierFor(account))?.key !== "studio"))) return false;
  const rentals = await ctx.db.query("bookings").withIndex("by_guestEmail", (q: any) => q.eq("guestEmail", account.email)).collect();
  return !rentals.some((b: any) => b.deliveryBenefitAccountId === account._id && b.deliveryBenefitMonth === month &&
    (b.deliveryBenefitConsumed || b.status !== "cancelled"));
}
