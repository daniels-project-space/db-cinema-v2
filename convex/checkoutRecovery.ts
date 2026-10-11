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
import { basketKey, recoveryBookingState, recoveryBookingsForAccount } from "./lib/checkoutRecovery";
import {quote} from "./lib/pricing";
import {belongsToRentalAccount} from "./lib/rentalAccount";
import {listingImages} from "./lib/catalogImages";
const line = v.object({
  listingId: v.id("listings"),
  qty: v.number(),
  start: v.number(),
  end: v.number(),pickupTime:v.optional(v.string()),returnTime:v.optional(v.string()),
});
export const sync = mutation({
  // Accept the old flag for deployed clients; populated account baskets are
  // automatically scheduled unless the account has explicitly opted out.
  args: { token: v.string(), enabled: v.optional(v.boolean()), lines: v.array(line) },
  handler: async (ctx, a) => {
    const account = await requireAccount(ctx, a.token);
    if(!(await bump(ctx,`basket-activity:${account._id}`,60,60000)).allowed)
      throw new Error("Please wait before updating your basket again.");
    const rows = await ctx.db
      .query("checkout_recoveries")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const preference = await ctx.db
      .query("checkout_recovery_email_preferences")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .unique();
    if (preference?.disabledAt) {
      for (const r of rows)
        if (r.state === "waiting")
          await ctx.db.patch(r._id, { state: "stopped", leaseUntil: undefined });
      return null;
    }
    const current = rows.find((r) => r.state !== "stopped");
    if (!a.lines.length) {
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
    const bookings = await recoveryBookingsForAccount(ctx,account);
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
          basketKey(b.lineItems) === basketKey(a.lines) &&
          recoveryBookingState(b) === "stopped",
      )
    )
      return null;
    if (current && basketKey(current.lines) === basketKey(a.lines)) {
      const now=Date.now();
      const changed=JSON.stringify(current.lines)!==JSON.stringify(a.lines);
      if(current.state==="waiting"&&(changed||now-current.updatedAt>=30_000))
        await ctx.db.patch(current._id,{lines:a.lines,updatedAt:now,dueAt:now+30*60000,attempts:0,leaseUntil:undefined});
      else if(current.state==="sent"&&changed)await ctx.db.patch(current._id,{lines:a.lines,updatedAt:now});
      return current._id;
    }
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
      activityRecordedAt: now,
      updatedAt: now,
      dueAt: now + 30 * 60000,
      expiresAt: Math.min(
        now + 7 * 86400000,
        Math.min(...a.lines.map((l) => l.start)) + 86400000,
      ),
      state: "waiting",
      attempts: 0,
    });
  },
});
export const preference = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const account = await requireAccount(ctx, token);
    const row = await ctx.db
      .query("checkout_recovery_email_preferences")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .unique();
    return { disabled: !!row?.disabledAt };
  },
});
async function stopPendingForAccount(ctx: any, accountId: any) {
  const rows = await ctx.db
    .query("checkout_recoveries")
    .withIndex("by_account", (q: any) => q.eq("accountId", accountId))
    .take(100);
  for (const row of rows)
    if (row.state === "waiting")
      await ctx.db.patch(row._id, { state: "stopped", leaseUntil: undefined });
}
export const setPreference = mutation({
  args: { token: v.string(), disabled: v.boolean() },
  handler: async (ctx, a) => {
    const account = await requireAccount(ctx, a.token);
    const existing = await ctx.db
      .query("checkout_recovery_email_preferences")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .unique();
    const now = Date.now();
    if (existing)
      await ctx.db.patch(existing._id, {
        email: account.email,
        disabledAt: a.disabled ? (existing.disabledAt ?? now) : undefined,
        updatedAt: now,
      });
    else
      await ctx.db.insert("checkout_recovery_email_preferences", {
        accountId: account._id,
        email: account.email,
        disabledAt: a.disabled ? now : undefined,
        createdAt: now,
        updatedAt: now,
      });
    if (a.disabled) await stopPendingForAccount(ctx, account._id);
    return { disabled: a.disabled };
  },
});
export const ensureUnsubscribeToken = internalMutation({
  args: {
    accountId: v.id("accounts"),
    email: v.string(),
    candidate: v.string(),
  },
  handler: async (ctx, a) => {
    const account = await ctx.db.get(a.accountId);
    if (!account || account.blockedAt != null || account.email !== a.email) return null;
    const existing = await ctx.db
      .query("checkout_recovery_email_preferences")
      .withIndex("by_account", (q) => q.eq("accountId", a.accountId))
      .unique();
    if (existing?.disabledAt) return null;
    if (existing?.unsubscribeToken) return existing.unsubscribeToken;
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        email: account.email,
        unsubscribeToken: a.candidate,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("checkout_recovery_email_preferences", {
        accountId: account._id,
        email: account.email,
        unsubscribeToken: a.candidate,
        createdAt: now,
        updatedAt: now,
      });
    }
    return a.candidate;
  },
});
export const unsubscribe = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const preference = await ctx.db
      .query("checkout_recovery_email_preferences")
      .withIndex("by_unsubscribe_token", (q) => q.eq("unsubscribeToken", token))
      .unique();
    if (!preference) return false;
    const account = await ctx.db.get(preference.accountId);
    if (!account) return false;
    const now = Date.now();
    if (!preference.disabledAt)
      await ctx.db.patch(preference._id, { disabledAt: now, updatedAt: now });
    await stopPendingForAccount(ctx, account._id);
    return true;
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
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const account = await requireAccount(ctx, a.token);
    const id=ctx.db.normalizeId("checkout_recoveries",a.id);
    const r=id?await ctx.db.get(id):null;
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
      cartLines: await Promise.all(r.lines.map(async line=>{
        const listing=await ctx.db.get(line.listingId);if(!listing)return null;
        const days=Math.round((line.end-line.start)/86400000)+1,price=quote(listing.pricing,days);
        return {listingId:line.listingId,qty:line.qty,title:listing.title,slug:listing.slug,heroImage:listingImages(listing)[0]??null,
          start:new Date(line.start).toISOString().slice(0,10),end:new Date(line.end).toISOString().slice(0,10),
          pickupTime:line.pickupTime,returnTime:line.returnTime,days,perDay:price.perDay,total:price.total,deposit:listing.depositAmount};
      })),
    };
  },
});
export const _due = internalQuery({
  args: {},
  handler: async (ctx) => {
    if(process.env.CHECKOUT_RECOVERY_ENABLED!=="true"||process.env.RENTAL_CHECKOUT_ENABLED!=="true"||(await ctx.db.query("settings").first())?.acceptingOrders===false)return [];
    return await ctx.db
      .query("checkout_recoveries")
      .withIndex("by_state_due", (q) =>
        q.eq("state", "waiting").lte("dueAt", Date.now()),
      )
      .take(100);
  },
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
    if (process.env.CHECKOUT_RECOVERY_ENABLED !== "true" || process.env.RENTAL_CHECKOUT_ENABLED !== "true") return null;
    if ((await ctx.db.query("settings").first())?.acceptingOrders === false) return null;
    const account = await ctx.db.get(r.accountId);
    const preference = account ? await ctx.db
      .query("checkout_recovery_email_preferences")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .unique() : null;
    if (!account || account.blockedAt!=null || preference?.disabledAt ||
        account.emailVerificationRequired&&!account.emailVerifiedAt) {
      await ctx.db.patch(id,{state:"stopped",leaseUntil:undefined});return null;
    }
    // Recheck permanent ownership and payment state immediately before claiming.
    const bookings = await recoveryBookingsForAccount(ctx,account);
    const related = bookings.filter(
      (b) =>
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
    // Unavailable/marketing items still deserve recovery; the live quote supplies alternatives.
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
    await ctx.db.patch(id, { leaseUntil, dueAt:leaseUntil, attempts: r.attempts + 1 });
    return { id, leaseUntil, email: account.email, accountId: account._id };
  },
});
export const _finish = internalMutation({
  args: {
    id: v.id("checkout_recoveries"),
    leaseUntil: v.number(),
    sent: v.boolean(),
    stop: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || r.state !== "waiting" || r.leaseUntil !== a.leaseUntil) return;
    await ctx.db.patch(
      a.id,
      a.stop
        ? { state: "stopped", leaseUntil: undefined }
        : a.sent
        ? { state: "sent", deliveredAt: Date.now(), leaseUntil: undefined }
        : { dueAt: Date.now() + 5*60000*2**Math.max(0,r.attempts-1), leaseUntil: undefined },
    );
  },
});

/** Fence a claimed email against basket activity, payment, account changes and pause controls. */
export const _ready = internalQuery({
  args: { id: v.id("checkout_recoveries"), leaseUntil: v.number(), email: v.string() },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id), now = Date.now();
    if (!r || r.state !== "waiting" || r.leaseUntil !== a.leaseUntil ||
        a.leaseUntil <= now || r.expiresAt <= now ||
        r.lines.some(line => line.start < londonDay())) return false;
    const account = await ctx.db.get(r.accountId);
    const preference = account ? await ctx.db
      .query("checkout_recovery_email_preferences")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .unique() : null;
    if (!account || account.email !== a.email || account.blockedAt != null ||
        preference?.disabledAt ||
        (account.emailVerificationRequired && !account.emailVerifiedAt) ||
        process.env.CHECKOUT_RECOVERY_ENABLED !== "true" ||
        process.env.RENTAL_CHECKOUT_ENABLED !== "true" ||
        (await ctx.db.query("settings").first())?.acceptingOrders === false) return false;
    // A payment or cancellation can commit after the claim, before its recovery
    // link is updated. Check the actual account-owned bookings again before mail.
    const key = basketKey(r.lines);
    const related = (await recoveryBookingsForAccount(ctx, account))
      .filter(booking => basketKey(booking.lineItems) === key);
    if (r.bookingId) {
      const linked = await ctx.db.get(r.bookingId);
      if (linked && !belongsToRentalAccount(linked, account)) return false;
      if (linked && !related.some(booking => booking._id === linked._id)) related.push(linked);
    }
    return related.every(booking => recoveryBookingState(booking) === "recoverable");
  },
});
