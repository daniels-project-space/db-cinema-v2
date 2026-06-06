import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const lineItem = v.object({
  listingId: v.id("listings"),
  title: v.string(),
  start: v.number(),
  end: v.number(),
  qty: v.number(),
  lineTotal: v.number(),
});

export const createPending = internalMutation({
  args: {
    customerEmail: v.string(),
    customerName: v.optional(v.string()),
    phone: v.optional(v.string()),
    fulfilment: v.union(v.literal("pickup"), v.literal("delivery")),
    address: v.optional(v.string()),
    deliveryFee: v.number(),
    lineItems: v.array(lineItem),
    subtotal: v.number(),
    depositAmount: v.number(),
    total: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, a) => {
    let customer = await ctx.db
      .query("customers")
      .withIndex("by_email", (q) => q.eq("email", a.customerEmail))
      .first();
    if (!customer) {
      const id = await ctx.db.insert("customers", {
        email: a.customerEmail,
        name: a.customerName,
        phone: a.phone,
      });
      customer = await ctx.db.get(id);
    }
    const bookingId = await ctx.db.insert("bookings", {
      customerId: customer!._id,
      guestEmail: a.customerEmail,
      status: "pending_payment",
      lineItems: a.lineItems,
      fulfilment: a.fulfilment,
      address: a.address,
      deliveryFee: a.deliveryFee,
      subtotal: a.subtotal,
      discount: 0,
      depositAmount: a.depositAmount,
      total: a.total,
      currency: a.currency,
    });
    return bookingId;
  },
});

export const confirm = internalMutation({
  args: { bookingId: v.id("bookings"), paymentIntentId: v.optional(v.string()) },
  handler: async (ctx, { bookingId, paymentIntentId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) throw new Error("booking not found");
    if (booking.status === "confirmed" || booking.status === "active") {
      return { already: true };
    }
    await ctx.db.patch(bookingId, {
      status: "confirmed",
      stripePaymentIntentId: paymentIntentId,
    });
    // write the reservation ledger (source:site) per BOM component
    for (const li of booking.lineItems) {
      const listing = await ctx.db.get(li.listingId);
      if (!listing) continue;
      for (const comp of listing.components) {
        await ctx.db.insert("reservations", {
          inventoryUnitId: comp.inventoryUnitId,
          listingId: li.listingId,
          bookingId,
          start: li.start,
          end: li.end,
          qty: comp.qty * li.qty,
          source: "site",
          status: "confirmed",
        });
      }
    }
    return { already: false };
  },
});

export const get = query({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      _id: b._id,
      status: b.status,
      lineItems: b.lineItems,
      subtotal: b.subtotal,
      depositAmount: b.depositAmount,
      deliveryFee: b.deliveryFee,
      total: b.total,
      currency: b.currency,
      fulfilment: b.fulfilment,
      guestEmail: b.guestEmail,
    };
  },
});
