import { query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { assertCreditOffer, creditOfferFingerprint } from "./lib/rentalCreditPolicy";

export const byId = internalQuery({ args: { offerId: v.id("rental_credit_offers") }, handler: async (ctx, { offerId }) => ctx.db.get(offerId) });
export const context = internalQuery({
  args: { bookingId: v.id("bookings") }, handler: async (ctx, { bookingId }) => ctx.db.get(bookingId),
});
export const get = query({
  args: { token: v.string(), offerId: v.id("rental_credit_offers") },
  handler: async (ctx, { token, offerId }) => {
    const account = await accountForToken(ctx, token), offer = await ctx.db.get(offerId);
    if (!account || !offer || offer.accountId !== account._id) return null;
    const booking = await ownedBooking(ctx, account, offer.bookingId);
    const processing = booking.status === "confirmed" && booking.cancellationDecision?.fullCreditOfferId === offerId;
    let eligible = processing;
    try { assertCreditOffer(offer, booking); eligible = processing || (offer.status === "offered" && !booking.cancellationDecision); } catch {}
    return { amountPence: offer.amountPence, status: offer.status, eligible, enabled: process.env.CUSTOMER_BOOKING_ACTIONS === "true" };
  },
});
export const create = internalMutation({
  args: { accountId: v.id("accounts"), bookingId: v.id("bookings"), amountPence: v.number(), fingerprint: v.string() },
  handler: async (ctx, args) => {
    if (process.env.CUSTOMER_BOOKING_ACTIONS !== "true") return null;
    const account = await ctx.db.get(args.accountId), booking = await ownedBooking(ctx, account, args.bookingId);
    assertCreditOffer({ ...args, expiresAt: Date.now() + 1000 }, booking);
    if (booking.cancellationDecision || !Number.isSafeInteger(args.amountPence) || args.amountPence <= 0) return null;
    const refunds = await ctx.db.query("rental_refunds").withIndex("by_booking", q => q.eq("bookingId", args.bookingId)).collect();
    if (refunds.some(r => ["prepared", "pending"].includes(r.status))) return null;
    const offers = await ctx.db.query("rental_credit_offers").withIndex("by_booking", q => q.eq("bookingId", args.bookingId)).collect();
    const existing = offers.find(o => o.status === "offered" && o.expiresAt > Date.now() && o.fingerprint === args.fingerprint && o.amountPence === args.amountPence);
    if (existing) return existing._id;
    const id = await ctx.db.insert("rental_credit_offers", { ...args, createdAt: Date.now(), expiresAt: Date.now() + 30 * 60000, status: "offered" });
    await postRentalMessage(ctx, { accountId: args.accountId, bookingId: args.bookingId, sender: "bot",
      text: `You can choose to cancel for £${(args.amountPence / 100).toFixed(2)} account credit, valid for one year and applied automatically to a future rental. This includes the remaining paid security payment; choosing it replaces a card refund. Any unused card holds will be released. Nothing changes unless you accept the offer below. A card refund under the usual cancellation policy remains available through the team.`,
      meta: { kind: "full_credit_offer", offerId: id } });
    return id;
  },
});
export const accepted = internalMutation({
  args: { offerId: v.id("rental_credit_offers") }, handler: async (ctx, { offerId }) => {
    const offer = await ctx.db.get(offerId); if (!offer) return;
    const b = await ctx.db.get(offer.bookingId);
    if (b?.status !== "cancelled" || b.cancellationDecision?.fullCreditOfferId !== offerId || !b.creditIssuedId) throw Error("Credit settlement is not complete.");
    await ctx.db.patch(offerId, { status: "accepted", acceptedAt: Date.now() });
  },
});
