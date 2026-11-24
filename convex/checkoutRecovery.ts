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
import {listingImages} from "./lib/catalogImages";
import { rentalPricingDays } from "../shared/rentalDuration";
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60000;

function followupDueAt(updatedAt:number,stage:"day_one"|"week_one") {
  return updatedAt + (stage === "day_one" ? DAY_MS : WEEK_MS);
}

function recoveryExpiry(lines:any[],now:number) {
  return Math.min(now + 8 * DAY_MS, Math.min(...lines.map((line:any)=>line.start)) + DAY_MS);
}

const line = v.object({
  listingId: v.id("listings"),
  qty: v.number(),
  start: v.number(),
  end: v.number(),pickupTime:v.optional(v.string()),returnTime:v.optional(v.string()),
});
export const sync = mutation({
  // Follow-up mail is sent only after the renter opts in for the current basket.
  args: { token: v.string(), enabled: v.optional(v.boolean()), emailFollowupConsent: v.optional(v.boolean()), lines: v.array(line) },
  handler: async (ctx, a) => {
    const account = await requireAccount(ctx, a.token);
    const rows = await ctx.db
      .query("checkout_recoveries")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const current = rows.find((r) => r.state !== "stopped");
    if (!a.lines.length) {
      for (const r of rows)
        if (r.state !== "stopped")
          await ctx.db.patch(r._id, {
            state: "stopped",
            followupStage: "complete",
            emailFollowupConsentAt: undefined,
            leaseUntil: undefined,
          });
      return null;
    }
    linesValid(a.lines);
    for (const l of a.lines) dates(l.start, l.end);
    for (const l of a.lines)
      if (!(await ctx.db.get(l.listingId))) throw new Error("Item not found.");
    const emailFollowupConsent = a.emailFollowupConsent ?? !!current?.emailFollowupConsentAt;
    if (!emailFollowupConsent) {
      if (current && (current.state === "waiting" || current.emailFollowupConsentAt))
        await ctx.db.patch(current._id, {
          state: "sent",
          followupStage: "complete",
          emailFollowupConsentAt: undefined,
          leaseUntil: undefined,
        });
      return current?._id ?? null;
    }
    const isNewConsent = !current?.emailFollowupConsentAt || current.followupStage === "complete";
    if (!isNewConsent && !(await bump(ctx,`basket-activity:${account._id}`,60,60000)).allowed)
      throw new Error("Please wait before updating your basket again.");
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
    ) {
      if (current) await ctx.db.patch(current._id,{state:"stopped",followupStage:"complete",emailFollowupConsentAt:undefined,leaseUntil:undefined});
      return null;
    }
    if (current && basketKey(current.lines) === basketKey(a.lines)) {
      const now=Date.now();
      const changed=JSON.stringify(current.lines)!==JSON.stringify(a.lines);
      if (changed || !current.emailFollowupConsentAt || current.followupStage === "complete") {
        await ctx.db.patch(current._id,{
          lines:a.lines,
          updatedAt:now,
          dueAt:followupDueAt(now,"day_one"),
          expiresAt:recoveryExpiry(a.lines,now),
          state:"waiting",
          followupStage:"day_one",
          emailFollowupConsentAt:current.followupStage === "complete" ? now : current.emailFollowupConsentAt ?? now,
          attempts:0,
          leaseUntil:undefined,
        });
      } else if(current.state === "waiting" && now - current.updatedAt >= ACTIVITY_WRITE_INTERVAL_MS) {
        const stage = current.followupStage === "week_one" ? "week_one" : "day_one";
        await ctx.db.patch(current._id,{
          lines:a.lines,
          updatedAt:now,
          dueAt:followupDueAt(now,stage),
          expiresAt:recoveryExpiry(a.lines,now),
          attempts:0,
          leaseUntil:undefined,
        });
      }
      return current._id;
    }
    if (!(await bump(ctx, `checkout-recovery:${account._id}`, 30, 3600000)).allowed)
      throw new Error("Please wait before saving another checkout.");
    if (current)
      await ctx.db.patch(current._id, {
        state: "stopped",
        followupStage: "complete",
        emailFollowupConsentAt: undefined,
        leaseUntil: undefined,
      });
    const now = Date.now();
    return ctx.db.insert("checkout_recoveries", {
      accountId: account._id,
      lines: a.lines,
      consentAt: now,
      emailFollowupConsentAt: now,
      followupStage: "day_one",
      updatedAt: now,
      dueAt: followupDueAt(now,"day_one"),
      expiresAt: recoveryExpiry(a.lines,now),
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
      emailFollowupsEnabled: Boolean(r.emailFollowupConsentAt && r.followupStage !== "complete"),
      items: await kitDetails(ctx, r.lines),
      cartLines: await Promise.all(r.lines.map(async line=>{
        const listing=await ctx.db.get(line.listingId);if(!listing)return null;
        const days=rentalPricingDays(line.start,line.end,line.pickupTime,line.returnTime),price=quote(listing.pricing,days);
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
    if (!r.emailFollowupConsentAt || r.followupStage === "complete") {
      await ctx.db.patch(id,{state:"sent",followupStage:"complete",emailFollowupConsentAt:undefined,leaseUntil:undefined});
      return null;
    }
    if (!r.followupStage) {
      const dueAt=followupDueAt(r.updatedAt,"day_one");
      await ctx.db.patch(id,{followupStage:"day_one",dueAt});
      return null;
    }
    if (process.env.CHECKOUT_RECOVERY_ENABLED !== "true" || process.env.RENTAL_CHECKOUT_ENABLED !== "true") return null;
    if ((await ctx.db.query("settings").first())?.acceptingOrders === false) return null;
    const account = await ctx.db.get(r.accountId);
    if (!account || account.blockedAt!=null || account.emailVerificationRequired&&!account.emailVerifiedAt) {
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
    return { id, leaseUntil, email: account.email, stage:r.followupStage, updatedAt:r.updatedAt, emailFollowupConsentAt:r.emailFollowupConsentAt };
  },
});
export const _finish = internalMutation({
  args: {
    id: v.id("checkout_recoveries"),
    leaseUntil: v.number(),
    sent: v.boolean(),
    stage: v.union(v.literal("day_one"),v.literal("week_one")),
    updatedAt: v.number(),
    emailFollowupConsentAt: v.number(),
  },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || r.state !== "waiting" || r.leaseUntil !== a.leaseUntil || r.followupStage !== a.stage || r.updatedAt !== a.updatedAt || r.emailFollowupConsentAt !== a.emailFollowupConsentAt) return;
    if (!a.sent) {
      await ctx.db.patch(a.id,{dueAt:Date.now()+5*60000*2**Math.max(0,r.attempts-1),leaseUntil:undefined});
      return;
    }
    const deliveredAt=Date.now();
    if (a.stage === "day_one") {
      await ctx.db.patch(a.id,{
        state:"waiting",
        followupStage:"week_one",
        deliveredAt,
        dueAt:followupDueAt(r.updatedAt,"week_one"),
        attempts:0,
        leaseUntil:undefined,
      });
      return;
    }
    await ctx.db.patch(a.id,{state:"sent",followupStage:"complete",deliveredAt,attempts:0,leaseUntil:undefined});
  },
});

/** Fence a claimed email against basket activity, payment, account changes and pause controls. */
export const _ready=internalQuery({args:{id:v.id("checkout_recoveries"),leaseUntil:v.number(),email:v.string(),stage:v.union(v.literal("day_one"),v.literal("week_one")),updatedAt:v.number(),emailFollowupConsentAt:v.number()},handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id),account=r?await ctx.db.get(r.accountId):null;
 return !!r&&r.state==="waiting"&&r.leaseUntil===a.leaseUntil&&r.followupStage===a.stage&&r.updatedAt===a.updatedAt&&r.emailFollowupConsentAt===a.emailFollowupConsentAt&&a.leaseUntil>Date.now()&&!!account&&account.email===a.email&&account.blockedAt==null&&!(account.emailVerificationRequired&&!account.emailVerifiedAt)&&process.env.CHECKOUT_RECOVERY_ENABLED==="true"&&process.env.RENTAL_CHECKOUT_ENABLED==="true"&&(await ctx.db.query("settings").first())?.acceptingOrders!==false;
}});

export const disableFollowups = mutation({
  args:{token:v.string(),id:v.string()},
  handler:async(ctx,a)=>{
    const account=await requireAccount(ctx,a.token),id=ctx.db.normalizeId("checkout_recoveries",a.id),row=id?await ctx.db.get(id):null;
    if(!row||row.accountId!==account._id)return false;
    if(row.followupStage==="complete"&&!row.emailFollowupConsentAt)return true;
    await ctx.db.patch(row._id,{state:"sent",followupStage:"complete",emailFollowupConsentAt:undefined,leaseUntil:undefined});
    return true;
  },
});
