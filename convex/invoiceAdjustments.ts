import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const SWAP_ADJUSTMENT_EMAIL_LEASE_MS = 5 * 60_000;

/** Due adjustments remain queryable until delivery is recorded. */
export const dueSwapAdjustmentEmails = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("rental_swap_adjustment_receipts")
      .withIndex("by_email_state_attempt", (q) =>
        q
          .eq("emailState", "pending")
          .lte("lastAttemptAt", Date.now() - SWAP_ADJUSTMENT_EMAIL_LEASE_MS),
      )
      .take(50);
    return rows.map((row) => row._id);
  },
});

/** Atomically claims a pending email and checks its swap and stock receipt. */
export const claimSwapAdjustmentEmail = internalMutation({
  args: { receiptId: v.id("rental_swap_adjustment_receipts") },
  handler: async (ctx, { receiptId }) => {
    const now = Date.now();
    const receipt = await ctx.db.get(receiptId);
    if (
      !receipt ||
      receipt.emailState !== "pending" ||
      receipt.lastAttemptAt > now - SWAP_ADJUSTMENT_EMAIL_LEASE_MS
    ) {
      return null;
    }

    const [swap, booking, account] = await Promise.all([
      ctx.db.get(receipt.swapId),
      ctx.db.get(receipt.bookingId),
      ctx.db.get(receipt.accountId),
    ]);
    if (
      !swap ||
      swap.status !== "applied" ||
      !booking ||
      !account ||
      booking._id !== swap.bookingId ||
      swap.accountId !== receipt.accountId
    ) {
      return null;
    }

    if (receipt.requiresStockAck) {
      if (booking.activeItemSwapId === swap._id) return null;
      const stock = await ctx.db
        .query("swap_stock_applied_receipts")
        .withIndex("by_swap", (q) => q.eq("swapId", swap._id))
        .unique();
      if (!stock || stock.deliveryState !== "acknowledged" || stock.stockRisk === true) {
        return null;
      }
    }

    const recipientEmail = receipt.recipientEmail || booking.guestEmail || account.email;
    if (typeof recipientEmail !== "string" || !recipientEmail.includes("@")) return null;
    await ctx.db.patch(receipt._id, { recipientEmail, lastAttemptAt: now });
    return { ...receipt, recipientEmail, claimAt: now };
  },
});

/** Marks delivery only while the action still owns the unexpired claim. */
export const markSwapAdjustmentEmailSent = internalMutation({
  args: {
    receiptId: v.id("rental_swap_adjustment_receipts"),
    claimAt: v.number(),
  },
  handler: async (ctx, { receiptId, claimAt }) => {
    const receipt = await ctx.db.get(receiptId);
    if (!receipt || receipt.emailState === "sent") return false;
    if (
      receipt.lastAttemptAt !== claimAt ||
      claimAt < Date.now() - SWAP_ADJUSTMENT_EMAIL_LEASE_MS
    ) {
      throw Error("The equipment adjustment email claim expired.");
    }
    await ctx.db.patch(receipt._id, { emailState: "sent", sentAt: Date.now() });
    return true;
  },
});
