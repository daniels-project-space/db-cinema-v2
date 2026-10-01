import { rentalPaymentSources } from "./rentalPaymentSources";

export async function reviewContext(ctx: any, booking: any) {
  const additions = await ctx.db.query("rental_additions")
    .withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).collect();
  const rentalRefunds = await ctx.db.query("rental_refunds").withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).collect();
  const rentalRefundIds = rentalRefunds.flatMap((job: any) => job.parts
    ? job.parts.filter((part: any) => part.status === "succeeded").map((part: any) => part.stripeRefundId)
    : job.status === "succeeded" && job.stripeRefundId ? [job.stripeRefundId] : []);
  return { ...booking, paymentSources: await rentalPaymentSources(ctx, booking), rentalRefundIds,
    unappliedSecurityPayments: additions.filter((r: any) => r.paymentIntentId &&
      !["applied", "applied_draft"].includes(r.status) &&
      (r.securityCharge > 0 || r.draftReplacement && (r.baseSecurity ?? 0) > 0))
      .map((r: any) => r.paymentIntentId),
  };
}
