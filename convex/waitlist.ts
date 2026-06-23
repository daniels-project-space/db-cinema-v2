import { mutation, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { bump } from "./rateLimit";

/** Renter asks to be emailed when a booked-out item frees up for their dates. */
export const add = mutation({
  args: { email: v.string(), listingId: v.id("listings"), start: v.number(), end: v.number() },
  handler: async (ctx, a) => {
    const email = a.email.trim().toLowerCase().slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Please enter a valid email address.");
    if (!(a.end >= a.start)) throw new Error("Please pick valid dates.");
    const rl = await bump(ctx, `waitlist:${email}`, 12, 60 * 60 * 1000);
    if (!rl.allowed) throw new Error("You've set a few alerts already — we'll be in touch.");
    const listing: any = await ctx.db.get(a.listingId);
    if (!listing) throw new Error("Item not found.");
    const dup = (
      await ctx.db.query("availability_waitlist").withIndex("by_notified", (q) => q.eq("notified", false)).collect()
    ).find((w) => w.email === email && String(w.listingId) === String(a.listingId) && w.start === a.start && w.end === a.end);
    if (dup) return { ok: true, already: true };
    await ctx.db.insert("availability_waitlist", {
      email,
      listingId: a.listingId,
      listingTitle: listing.title,
      slug: listing.slug,
      start: a.start,
      end: a.end,
      createdAt: Date.now(),
      notified: false,
    });
    return { ok: true };
  },
});

export const _pending = internalQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db.query("availability_waitlist").withIndex("by_notified", (q) => q.eq("notified", false)).collect(),
});

export const _markNotified = internalMutation({
  args: { id: v.id("availability_waitlist") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { notified: true });
  },
});

/** Cron: email waiters whose item is now free for their window; retire expired requests. */
export const checkAndNotify = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; sent: number }> => {
    const pending: any[] = await ctx.runQuery(internal.waitlist._pending, {});
    const now = Date.now();
    let sent = 0;
    for (const w of pending) {
      if (w.end < now) {
        await ctx.runMutation(internal.waitlist._markNotified, { id: w._id });
        continue;
      }
      const av: any = await ctx.runQuery(api.availability.forListing, {
        listingId: w.listingId,
        start: w.start,
        end: w.end,
      });
      if ((av?.available ?? 0) > 0) {
        await ctx.runMutation(internal.waitlist._markNotified, { id: w._id });
        await ctx.runAction(internal.notify.waitlistEmail, {
          email: w.email,
          title: w.listingTitle,
          slug: w.slug,
          start: w.start,
          end: w.end,
        });
        sent++;
      }
    }
    return { checked: pending.length, sent };
  },
});
