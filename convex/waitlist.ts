import { paginationOptsValidator } from "convex/server";
import {
  mutation,
  query,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { bump } from "./rateLimit";
import { dates, londonDay, requireAccount } from "./lib/kitPlanning";
import { assertRentalInventory } from "./lib/rentalInventory";
export const add = mutation({
  args: {
    email: v.string(),
    token: v.optional(v.string()),
    listingId: v.id("listings"),
    start: v.number(),
    end: v.number(),
  },
  handler: async (ctx, a) => {
    const account = a.token ? await requireAccount(ctx, a.token) : null;
    const email = (account?.email ?? a.email).trim().toLowerCase();
    if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      throw new Error("Please enter a valid email address.");
    dates(a.start, a.end);
    if (!(await bump(ctx, `waitlist:${email}`, 12, 3600000)).allowed)
      throw new Error("You've set a few alerts already — we'll be in touch.");
    if (!(await bump(ctx, "waitlist:global", 120, 3600000)).allowed)
      throw new Error("Please try your alert again shortly.");
    const listing = await ctx.db.get(a.listingId);
    if (!listing?.active || listing.suppressed)
      throw new Error("Item not available.");
    if ((a.end - a.start) / 86400000 + 1 < (listing.minimumRentalDays ?? 1))
      throw new Error("Choose the minimum rental period for this item.");
    const pending = await ctx.db
      .query("availability_waitlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    if (
      pending.some(
        (w) =>
          !w.notified &&
          !w.cancelled &&
          w.listingId === a.listingId &&
          w.start === a.start &&
          w.end === a.end,
      )
    )
      return { ok: true, already: true };
    await ctx.db.insert("availability_waitlist", {
      email,
      accountId: account?._id,
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
export const mine = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a = await requireAccount(ctx, token);
    return ctx.db
      .query("availability_waitlist")
      .withIndex("by_email", (q) => q.eq("email", a.email.trim().toLowerCase()))
      .order("desc")
      .take(100);
  },
});
export const cancel = mutation({
  args: { token: v.string(), id: v.id("availability_waitlist") },
  handler: async (ctx, a) => {
    const account = await requireAccount(ctx, a.token),
      w = await ctx.db.get(a.id);
    if (!w || w.email !== account.email.trim().toLowerCase())
      throw new Error("Alert not found.");
    await ctx.db.patch(a.id, { cancelled: true, notified: true });
  },
});
export const _pending = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: (ctx, a) =>
    ctx.db
      .query("availability_waitlist")
      .withIndex("by_notified", (q) => q.eq("notified", false))
      .paginate(a.paginationOpts),
});
export const _claim = internalMutation({
  args: { id: v.id("availability_waitlist") },
  handler: async (ctx, { id }) => {
    const w = await ctx.db.get(id);
    if (!w || w.notified || w.cancelled || (w.leaseUntil ?? 0) > Date.now())
      return null;
    // A date stamp represents the whole London rental day, not an expired midnight.
    if (w.start < londonDay()) {
      await ctx.db.patch(id, { notified: true });
      return null;
    }
    try {
      await assertRentalInventory(ctx, [
        { listingId: w.listingId, qty: 1, start: w.start, end: w.end },
      ]);
    } catch {
      return null;
    }
    const leaseUntil = Date.now() + 10 * 60000;
    await ctx.db.patch(id, { leaseUntil, attempts: (w.attempts ?? 0) + 1 });
    return { ...w, leaseUntil };
  },
});
export const _finish = internalMutation({
  args: {
    id: v.id("availability_waitlist"),
    leaseUntil: v.number(),
    sent: v.boolean(),
  },
  handler: async (ctx, a) => {
    const w = await ctx.db.get(a.id);
    if (!w || w.leaseUntil !== a.leaseUntil) return;
    await ctx.db.patch(
      a.id,
      a.sent
        ? { notified: true, deliveredAt: Date.now(), leaseUntil: undefined }
        : { leaseUntil: undefined },
    );
  },
});
export const checkAndNotify = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ checked: number; sent: number }> => {
    const page: any = await ctx.runQuery(internal.waitlist._pending, {
      paginationOpts: { numItems: 50, cursor: a.cursor ?? null },
    });
    const pending: any[] = page.page;
    let sent = 0;
    for (const item of pending) {
      const w: any = await ctx.runMutation(internal.waitlist._claim, {
        id: item._id,
      });
      if (!w) continue;
      let ok = false;
      try {
        ok =
          (await ctx.runAction(internal.notify.waitlistEmail, {
            email: w.email,
            title: w.listingTitle,
            slug: w.slug,
            start: w.start,
            end: w.end,
          })) === true;
      } catch {}
      await ctx.runMutation(internal.waitlist._finish, {
        id: w._id,
        leaseUntil: w.leaseUntil,
        sent: ok,
      });
      if (ok) sent++;
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.waitlist.checkAndNotify, {
        cursor: page.continueCursor,
      });
    return { checked: pending.length, sent };
  },
});
