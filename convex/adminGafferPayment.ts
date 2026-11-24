import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken } from "./adminAuth";
import { adminSessionMigrationReady, assertAdminScopeSession, assertCustomerReadSession } from "./adminAccountSessionV2";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { expectedCheckoutPaymentPence, hasCheckoutPaymentProof } from "./lib/cleanCompletedRental";

export const checkoutEvidence = internalQuery({
  args: { token: v.string(), accountId: v.id("accounts"), bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    if (process.env.ADMIN_SESSION_CUSTOMER_READ_V2 === "enabled" || process.env.ADMIN_SESSION_BILLING_PORTAL_V2 === "enabled") {
      if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
      await assertCustomerReadSession(ctx, args.token);
      await assertAdminScopeSession(ctx, args.token, "rentals:read");
      await assertAdminScopeSession(ctx, args.token, "payments:read");
    } else if (!checkAdminToken(args.token)) throw Error("unauthorized");
    const [account, booking] = await Promise.all([ctx.db.get(args.accountId), ctx.db.get(args.bookingId)]);
    if (!belongsToRentalAccount(booking, account)) throw Error("Conversation unavailable.");
    const expected = expectedCheckoutPaymentPence(booking);
    const proof = hasCheckoutPaymentProof(booking, expected);
    return {
      state: proof ? "recorded_checkout_evidence" : "not_established",
      recordedAt: proof ? booking!.checkoutPaidAt ?? null : null,
      recordedCardAmountPence: proof && Number.isSafeInteger(booking!.checkoutPaymentAmountPence) ? booking!.checkoutPaymentAmountPence : null,
      currency: proof ? "GBP" : null,
      source: "saved_booking_record",
      currentProviderStatusChecked: false,
    };
  },
});
