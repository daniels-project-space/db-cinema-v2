import { rentalPaymentSources } from "./rentalPaymentSources";
import { accountForRental } from "./rentalAccount";

const OPEN_EXTENSION_STATUSES = new Set(["pending", "approved", "awaiting_payment", "refund_pending"]);

export async function reviewContext(ctx: any, booking: any) {
  const account = await accountForRental(ctx, booking);
  const additions = await ctx.db.query("rental_additions")
    .withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).collect();
  const rentalRefunds = await ctx.db.query("rental_refunds").withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).collect();
  const extensionRequests = await ctx.db.query("booking_change_requests")
    .withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).order("desc").take(20);
  const hasOpenExtensionRequest = extensionRequests.some((request: any) =>
    request.type === "extend" && OPEN_EXTENSION_STATUSES.has(request.status));
  const rentalRefundIds = rentalRefunds.flatMap((job: any) => job.parts
    ? job.parts.filter((part: any) => part.status === "succeeded").map((part: any) => part.stripeRefundId)
    : job.status === "succeeded" && job.stripeRefundId ? [job.stripeRefundId] : []);
  return { ...booking, accountRestricted: account?.blockedAt != null, hasOpenExtensionRequest,
    paymentSources: await rentalPaymentSources(ctx, booking), rentalRefundIds,
    unappliedSecurityPayments: additions.filter((r: any) => r.paymentIntentId &&
      !["applied", "applied_draft"].includes(r.status) &&
      (r.securityCharge > 0 || r.draftReplacement && (r.baseSecurity ?? 0) > 0))
      .map((r: any) => r.paymentIntentId),
  };
}
