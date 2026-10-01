import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import {
  dates,
  linesValid,
  requireAccount,
  londonDay,
  kitDetails,
} from "./lib/kitPlanning";
import { bump } from "./rateLimit";
import { basketKey, recoveryBookingState } from "./lib/checkoutRecovery";
import { assertRentalInventory } from "./lib/rentalInventory";
const line = v.object({
  listingId: v.id("listings"),
  qty: v.number(),
  start: v.number(),
  end: v.number(),
});
export const sync = mutation({
  args: { token: v.string(), enabled: v.boolean(), lines: v.array(line) },
  handler: async (ctx, a) => {
    const account = await requireAccount(ctx, a.token);
    const rows = await ctx.db
      .query("checkout_recoveries")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const current = rows.find((r) => r.state !== "stopped");
    if (!a.enabled || !a.lines.length) {
      for (const r of rows)
        if (r.state !== "stopped")
          await ctx.db.patch(r._id, {
            state: "stopped",
            leaseUntil: undefined,
          });
      return null;
    }
    linesValid(a.lines);
    for (const l of a.lines) dates(l.start, l.end);
    for (const l of a.lines)
      if (!(await ctx.db.get(l.listingId))) throw new Error("Item not found.");
    // Never re-arm a completed/cancelled checkout from another open browser tab.
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_guestEmail", (q) =>
        q.eq("guestEmail", account.email.trim().toLowerCase()),
      )
      .collect();
    const linked = rows.filter(
      (r) => r.bookingId && basketKey(r.lines) === basketKey(a.lines),
    );
    let alreadyUsed = false;
    for (const row of linked)
      if (recoveryBookingState(await ctx.db.get(row.bookingId!)) === "stopped")
        alreadyUsed = true;
    if (
      alreadyUsed ||
      bookings.some(
        (b) =>
          b._creationTime >= (current?.consentAt ?? Date.now()) &&
          basketKey(b.lineItems) === basketKey(a.lines) &&
          recoveryBookingState(b) === "stopped",
      )
    )
      return null;
    if (current && basketKey(current.lines) === basketKey(a.lines))
      return current._id;
    if (
      !(await bump(ctx, `checkout-recovery:${account._id}`, 30, 3600000))
        .allowed
    )
      throw new Error("Please wait before saving another checkout.");
    if (current)
      await ctx.db.patch(current._id, {
        state: "stopped",
        leaseUntil: undefined,
      });
    const now = Date.now();
    return ctx.db.insert("checkout_recoveries", {
      accountId: account._id,
      lines: a.lines,
      consentAt: now,
      updatedAt: now,
      dueAt: now + 2 * 3600000,
      expiresAt: Math.min(
        now + 7 * 86400000,
        Math.min(...a.lines.map((l) => l.start)) + 86400000,
      ),
      state: "waiting",
      attempts: 0,
    });
  },
});
export const mine = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a = await requireAccount(ctx, token);
    const rows = await ctx.db
      .query("checkout_recoveries")
      .withIndex("by_account", (q) => q.eq("accountId", a._id))
      .collect();
    return rows.find((r) => r.state !== "stopped") ?? null;
  },
});
export const resume = query({
  args: { token: v.string(), id: v.id("checkout_recoveries") },
  handler: async (ctx, a) => {
    const account = await requireAccount(ctx, a.token),
      r = await ctx.db.get(a.id);
    if (
      !r ||
      r.accountId !== account._id ||
      r.state === "stopped" ||
      r.expiresAt <= Date.now()
    )
      return null;
    if (
      r.bookingId &&
      recoveryBookingState(await ctx.db.get(r.bookingId)) !== "recoverable"
    )
      return null;
    return {
      title: "Your saved checkout",
      lines: r.lines,
      items: await kitDetails(ctx, r.lines),
    };
  },
});
export const _due = internalQuery({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("checkout_recoveries")
      .withIndex("by_state_due", (q) =>
        q.eq("state", "waiting").lte("dueAt", Date.now()),
      )
      .take(100),
});
export const _claim = internalMutation({
  args: { id: v.id("checkout_recoveries") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id),
      now = Date.now();
    if (
      !r ||
      r.state !== "waiting" ||
      r.dueAt > now ||
      (r.leaseUntil ?? 0) > now
    )
      return null;
    if (
      r.expiresAt <= now ||
      r.lines.some((l) => l.start < londonDay()) ||
      r.attempts >= 3
    ) {
      await ctx.db.patch(id, { state: "stopped" });
      return null;
    }
    if (process.env.RENTAL_CHECKOUT_ENABLED !== "true") return null;
    const account = await ctx.db.get(r.accountId);
    if (!account) return null;
    // Recheck consent and booking state at the point of claiming the send.
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_guestEmail", (q) =>
        q.eq("guestEmail", account.email.trim().toLowerCase()),
      )
      .collect();
    const related = bookings.filter(
      (b) =>
        b._creationTime >= r.consentAt &&
        basketKey(b.lineItems) === basketKey(r.lines),
    );
    if (r.bookingId) {
      const linked = await ctx.db.get(r.bookingId);
      if (linked && !related.some((b) => b._id === linked._id))
        related.push(linked);
    }
    if (related.some((b) => recoveryBookingState(b) === "stopped")) {
      await ctx.db.patch(id, { state: "stopped" });
      return null;
    }
    if (related.some((b) => recoveryBookingState(b) === "waiting")) {
      await ctx.db.patch(id, { dueAt: now + 15 * 60000 });
      return null;
    }
    try {
      await assertRentalInventory(ctx, r.lines);
    } catch {
      await ctx.db.patch(id, { dueAt: now + 15 * 60000 });
      return null;
    }
    const all = await ctx.db
      .query("checkout_recoveries")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const recent = all.find(
      (row) => row.deliveredAt && row.deliveredAt > now - 86400000,
    );
    if (recent) {
      await ctx.db.patch(id, { dueAt: recent.deliveredAt! + 86400000 });
      return null;
    }
    const leaseUntil = now + 10 * 60000;
    await ctx.db.patch(id, { leaseUntil, attempts: r.attempts + 1 });
    return { id, leaseUntil, email: account.email };
  },
});
export const _finish = internalMutation({
  args: {
    id: v.id("checkout_recoveries"),
    leaseUntil: v.number(),
    sent: v.boolean(),
  },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || r.state !== "waiting" || r.leaseUntil !== a.leaseUntil) return;
    await ctx.db.patch(
      a.id,
      a.sent
        ? { state: "sent", deliveredAt: Date.now(), leaseUntil: undefined }
        : { dueAt: Date.now() + 3600000, leaseUntil: undefined },
    );
  },
});
