import { tierByKey } from "../shared/membership";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import type { Id } from "./_generated/dataModel";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { assertRenterExposure, replacementValues } from "./lib/rentalExposure";
import { assertRentalInventory } from "./lib/rentalInventory";
import {
  accountForToken,
  ownedBooking,
  postRentalMessage,
} from "./lib/rentalChat";
import { quote } from "./lib/pricing";
import { securityForPolicy } from "../shared/rentalSecurity";

async function note(ctx: any, b: any, text: string, meta?: any) {
  const a = await ctx.db
    .query("accounts")
    .withIndex("by_email", (q: any) =>
      q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()),
    )
    .first();
  if (a)
    await postRentalMessage(ctx, {
      accountId: a._id,
      bookingId: b._id,
      sender: "system",
      text,
      meta,
    });
}
export const context = internalQuery({
  args: { id: v.id("rental_additions") },
  handler: async (ctx, { id }) => {
    const addition = await ctx.db.get(id);
    if (!addition) return null;
    return { addition, booking: await ctx.db.get(addition.bookingId) };
  },
});
export const existing = internalQuery({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) =>
    ctx.db
      .query("rental_additions")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .first(),
});
export const list = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    if (!checkAdminToken(token)) return [];
    const rows = await ctx.db.query("rental_additions").withIndex("by_booking", q => q.eq("bookingId", bookingId)).collect();
    return rows.map(({ securityCreationParams: _privateParams, ...row }) => row);
  },
});
export const prepare = internalMutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    requestId: v.string(),
    listingId: v.id("listings"),
    qty: v.number(),
    reason: v.string(),
    start: v.optional(v.number()),
    end: v.optional(v.number()),
    complimentary: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "rentalAdditions.prepare");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(a.requestId))
      throw Error("Invalid addition request");
    const prior = await ctx.db
      .query("rental_additions")
      .withIndex("by_request", (q) => q.eq("requestId", a.requestId))
      .first();
    if (prior) {
      if (prior.bookingId !== a.bookingId)
        throw Error("Request belongs to another rental");
      return prior;
    }
    const b = await ctx.db.get(a.bookingId);
    if (
      !b ||
      !["pending_payment", "confirmed", "active"].includes(b.status) ||
      b.cancellationDecision ||
      b.returnDecision
    )
      throw Error("This rental cannot accept items");
    if (b.activeAdditionId || b.activeExtensionId)
      throw Error("Finish or withdraw the current item addition or approved extension first");
    if (
      ["starting", "requires_action", "failed"].includes(
        b.depositHoldRenewalStatus ?? "",
      )
    )
      throw Error("Resolve the existing card hold renewal before adding items");
    if (
      b.status !== "pending_payment" &&
      (b.depositHoldExpiresAt ?? 0) <= Date.now() + 36 * 3600000
    )
      throw Error(
        "Renew the current security hold before adding items; the proposal must not interrupt rental coverage",
      );
    const jobs = await ctx.db
      .query("rental_refunds")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    if (jobs.some((r) => r.status === "prepared" || r.status === "pending"))
      throw Error("Wait for the refund to settle before adding items");
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    if (reservations.some((r) => r.source !== "site"))
      throw Error("Use the original booking platform for this rental");
    if (
      a.reason.trim().length < 5 ||
      !Number.isSafeInteger(a.qty) ||
      a.qty < 1 ||
      a.qty > 20
    )
      throw Error("Choose a quantity from 1–20 and record the reason");
    const l = await ctx.db.get(a.listingId);
    if (!l?.active || l.suppressed) throw Error("Item is unavailable");
    const start =
      a.start ??
      Math.max(
        Math.min(...b.lineItems.map((li) => li.start)),
        new Date().setUTCHours(0, 0, 0, 0),
      );
    const end = a.end ?? Math.max(...b.lineItems.map((li) => li.end));
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start % 86400000 !== 0 ||
      end % 86400000 !== 0 ||
      end < start ||
      end < new Date().setUTCHours(0, 0, 0, 0)
    )
      throw Error("Choose valid current or future rental dates");
    const line = {
      listingId: l._id,
      title: l.title,
      start,
      end,
      qty: a.qty,
      lineTotal: a.complimentary
        ? 0
        : quote(l.pricing, Math.round((end - start) / 86400000) + 1).total *
          a.qty,
    };
    await assertRenterExposure(ctx, b, [...b.lineItems, line]);
    await assertRentalInventory(ctx, [...b.lineItems, line], b._id);
    const catalog = await Promise.all(
      b.lineItems.map((li) => ctx.db.get(li.listingId)),
    );
    const value =
      catalog.reduce(
        (sum, item, i) => sum + (item?.depositAmount ?? 0) * b.lineItems[i].qty,
        0,
      ) +
      l.depositAmount * a.qty;
    const security = securityForPolicy(b.securityPolicyVersion, b.protection === "deposit" ? "deposit" : "verify", value);
    const holdTotal = Math.max(
      b.depositHoldAmount ?? 0,
      security.hold,
    );
    const securityCharge = ["paid_membership","new_paid_membership"].includes(b.securityWaiverReason??"") ? 0 : Math.max(
      0,
      security.deposit - b.depositAmount,
    );
    const membership=b.status==="pending_payment"&&b.membershipCheckoutId?await ctx.db.get(b.membershipCheckoutId):null;
    if(membership&&(!membership.sessionParams||!["creating","open"].includes(membership.state)||membership.bookingId!==b._id))throw Error("Refresh the initial membership checkout before changing its order.");
    const membershipParams=membership?.sessionParams?JSON.parse(membership.sessionParams):null;
    const membershipFee=membership?membershipParams?.metadata?.membershipFeePence?Number(membershipParams.metadata.membershipFeePence)/100:membership.intro==="trial"?0:tierByKey(membership.tier)?.monthlyGbp:undefined;
    if(membership&&membershipFee===undefined)throw Error("Membership price snapshot is unavailable.");
    const id = await ctx.db.insert("rental_additions", {
      ...line,
      bookingId: b._id,
      requestId: a.requestId,
      dailyRate: a.complimentary ? 0 : l.pricing.daily * a.qty,
      complimentary: !!a.complimentary || line.lineTotal === 0,
      securityCharge,
      holdTotal,
      oldHoldId: b.stripeDepositIntentId,
      draftReplacement: b.status === "pending_payment",
      baseTotal: b.total,
      baseSecurity: b.depositAmount,
      baseSessionId: b.stripeCheckoutSessionId,
      ...(membership?{membershipCheckoutId:membership._id,membershipFee,membershipSessionParams:membership.sessionParams}:{}),
      status: "prepared",
      reason: a.reason.trim().slice(0, 400),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(b._id, { activeAdditionId: id });
    for (const comp of l.components)
      await ctx.db.insert("reservations", {
        inventoryUnitId: comp.inventoryUnitId,
        listingId: l._id,
        bookingId: b._id,
        start,
        end,
        qty: comp.qty * a.qty,
        source: "site",
        status: "hold",
        externalRef: `addition:${id}`,
        holdExpiresAt: Date.now() + 35 * 60000,
      });
    return (await ctx.db.get(id))!;
  },
});
export const bindSession = internalMutation({
  args: {
    id: v.id("rental_additions"),
    sessionId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, { id, sessionId, url }) => {
    const r = await ctx.db.get(id);
    if (!r) return;
    if (r.sessionId && r.sessionId !== sessionId)
      throw Error("Addition already has a checkout session");
    const b = await ctx.db.get(r.bookingId);
    if (!b || b.activeAdditionId !== id)
      throw Error("Item addition is no longer open");
    if (r.sessionId === sessionId) return;
    await ctx.db.patch(id, {
      sessionId,
      paymentUrl: url,
      status: r.withdrawalRequestedAt ? r.status : "awaiting_payment",
      updatedAt: Date.now(),
    });
    if (r.draftReplacement){
      await assertRentalInventory(ctx,[...b.lineItems,{listingId:r.listingId,qty:r.qty,start:r.start,end:r.end}],b._id);
      const deadline=r.createdAt+24*3600000;
      await ctx.db.patch(b._id, { stripeCheckoutSessionId: sessionId });
      const held=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",b._id)).collect();
      for(const row of held)if(row.status==="hold")await ctx.db.patch(row._id,{holdExpiresAt:deadline});
    }
    if(r.membershipCheckoutId){
      const member=await ctx.db.get(r.membershipCheckoutId);if(!member||member.state==="complete"||member.bookingId!==b._id||member.sessionId!==r.baseSessionId)throw Error("The membership checkout changed before this edit was bound.");
      await ctx.db.patch(member._id,{sessionId,state:"open",expiresAt:r.createdAt+24*3600000});
    }
    if (r.withdrawalRequestedAt) return;
    await note(
      ctx,
      b,
      r.draftReplacement
        ? `The team proposed adding ${r.qty}× ${r.title}. Review the updated rental and complete its checkout.${r.membershipCheckoutId ? ` Your membership is preserved: £${(r.membershipFee??0).toFixed(2)} membership fee in this checkout${r.membershipFee===0?" (free-week trial)":""}; renewal remains as agreed.`:""}`
        : `The team proposed adding ${r.qty}× ${r.title}: £${r.lineTotal.toFixed(2)} rental${r.securityCharge ? ` + £${r.securityCharge.toFixed(2)} refundable security` : ""}. The updated card hold is £${r.holdTotal.toFixed(2)}. Items are confirmed after payment and any bank approval.`,
      {
        kind: "paylink",
        url,
        amount: r.draftReplacement
          ? (r.baseTotal ?? 0) + r.lineTotal + r.securityCharge + (r.membershipFee??0)
          : r.lineTotal + r.securityCharge,
      },
    );
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId: b._id,
      kind: "item addition proposed",
      detail: `${r.qty}× ${r.title}. Review the secure payment link in your rental conversation.`,
    });
  },
});
export const markPaid = internalMutation({
  args: { id: v.id("rental_additions"), paymentIntentId: v.string() },
  handler: async (ctx, { id, paymentIntentId }) => {
    const r = await ctx.db.get(id);
    if (!r) throw Error("Addition missing");
    if (r.paymentIntentId && r.paymentIntentId !== paymentIntentId)
      throw Error("Addition payment mismatch");
    if (["applied", "applied_draft", "refunded"].includes(r.status)) return;
    await ctx.db.patch(id, {
      paymentIntentId,
      status: r.withdrawalRequestedAt ? r.status : "paid",
      updatedAt: Date.now(),
    });
  },
});
export const bindHold = internalMutation({
  args: {
    id: v.id("rental_additions"),
    intentId: v.string(),
    status: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { id, intentId, status, expiresAt }) => {
    const r = await ctx.db.get(id);
    if (!r) return;
    if (r.holdIntentId && r.holdIntentId !== intentId)
      throw Error("Addition hold mismatch");
    await ctx.db.patch(id, {
      holdIntentId: intentId,
      securityCreationPending: false,
      holdExpiresAt: expiresAt,
      status: r.withdrawalRequestedAt ? r.status : status,
      updatedAt: Date.now(),
    });
  },
});
export const apply = internalMutation({
  args: { id: v.id("rental_additions") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (!r) return { closed: true };
    if (r.status === "applied" || r.status === "applied_draft")
      return { applied: true, already: true };
    if (r.withdrawalRequestedAt) return { closed: true };
    if (r.securityCreationPending) throw Error("Wait for the pending security authorisation");
    const b = await ctx.db.get(r.bookingId);
    if (
      !b ||
      b.cancellationDecision ||
      b.returnDecision ||
      b.activeAdditionId !== id ||
      !["pending_payment", "confirmed", "active"].includes(b.status) ||
      (r.draftReplacement && b.status !== "pending_payment")
    )
      return { closed: true };
    if (
      (!r.paymentIntentId && !r.complimentary) ||
      (!r.draftReplacement && r.holdTotal > 0 && r.status !== "held")
    )
      throw Error(
        "Payment and replacement card hold must be ready before items are attached",
      );
    const line = {
      listingId: r.listingId,
      title: r.title,
      start: r.start,
      end: r.end,
      qty: r.qty,
      lineTotal: r.lineTotal,
      dailyRate: r.dailyRate,
    };
    try {
      await assertRenterExposure(ctx, b, [...b.lineItems, line]);
      await assertRentalInventory(ctx, [...b.lineItems, line], b._id);
    } catch (e) {
      if (/unavailable|already reserved|Inventory capacity|£15,000|replacement value|overlapping rentals/.test(String(e)))
        return { closed: true };
      throw e;
    }
    const patch: any = {
      replacementValues: await replacementValues(ctx, b, [...b.lineItems, line]),
      lineItems: [...b.lineItems, line],
      subtotal: b.subtotal + r.lineTotal,
      total: b.total + r.lineTotal + r.securityCharge,
      depositAmount: b.depositAmount + r.securityCharge,
      depositHoldAmount: r.holdTotal,
      activeAdditionId: undefined,
    };
    if (
      !r.draftReplacement &&
      r.holdIntentId &&
      r.holdIntentId !== b.stripeDepositIntentId
    ) {
      patch.stripeDepositIntentId = r.holdIntentId;
      patch.depositHoldStatus = "held";
      patch.depositHoldExpiresAt = r.holdExpiresAt;
      patch.depositHoldPreviousIntentIds = [
        ...(b.depositHoldPreviousIntentIds ?? []),
        ...(b.stripeDepositIntentId ? [b.stripeDepositIntentId] : []),
      ];
    }
    if (r.draftReplacement) patch.stripeCheckoutSessionId = r.sessionId;
    if(b.securityWaiverReason==="safe_repeat_kit"&&r.securityCharge>0)patch.securityWaiverReason=undefined;
    if(r.membershipCheckoutId)patch.rentalPaidPence=Math.round((b.total+r.lineTotal+r.securityCharge)*100);
    await ctx.db.patch(b._id, patch);
    await ctx.db.patch(id, {
      status: r.draftReplacement ? "applied_draft" : "applied",
      updatedAt: Date.now(),
    });
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    for (const reservation of reservations)
      if (!r.draftReplacement && reservation.externalRef === `addition:${id}`)
        await ctx.db.patch(reservation._id, {
          status: b.status === "active" ? "active" : "confirmed",
          holdExpiresAt: undefined,
        });
    await note(
      ctx,
      b,
      `Added to your rental: ${r.qty}× ${r.title}. Rental charge £${r.lineTotal.toFixed(2)}${r.securityCharge ? `; refundable security £${r.securityCharge.toFixed(2)}` : ""}.`,
    );
    await queueRmv2Sync(ctx, b._id);
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId: b._id,
      kind: "item added",
      detail: `${r.qty}× ${r.title}. £${r.lineTotal.toFixed(2)} rental charge${r.securityCharge ? ` and £${r.securityCharge.toFixed(2)} refundable security` : ""}.`,
    });
    return { applied: true };
  },
});
/** Persist the exact approved attempt before sending any new card hold. */
export const beginSecurityAuthorization = internalMutation({
  args: { id: v.id("rental_additions"), params: v.string() },
  handler: async (ctx, { id, params }) => {
    const r = await ctx.db.get(id);
    if (!r || r.withdrawalRequestedAt || ["applied", "applied_draft", "refunded", "expired"].includes(r.status)) return { closed: true as const };
    const b = await ctx.db.get(r.bookingId);
    if (!b || b.activeAdditionId !== id || !r.paymentIntentId || b.cancellationDecision || b.returnDecision) return { closed: true as const };
    const p = JSON.parse(params);
    if (p.amount !== Math.round(r.holdTotal * 100) || p.amount <= 0 || p.currency !== "gbp" || p.capture_method !== "manual" || p.confirm !== true || p.off_session !== true || typeof p.customer !== "string" || !p.customer || typeof p.payment_method !== "string" || !p.payment_method || p.metadata?.rentalAdditionId !== id || p.metadata?.bookingId !== r.bookingId || p.metadata?.purpose !== "replacement_rental_security_hold") throw Error("Security authorisation does not match the saved proposal");
    if (r.securityCreationParams && r.securityCreationParams !== params) throw Error("The prepared security authorisation changed");
    if (!r.securityCreationPending) await ctx.db.patch(id, { securityCreationPending: true, securityCreationPreparedAt: Date.now(), securityCreationParams: params });
    return { closed: false as const, params: r.securityCreationParams ?? params };
  },
});

/** Serialize the withdrawal decision against attachment before provider effects. */
export const beginWithdrawal = internalMutation({
  args: { id: v.id("rental_additions") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (!r) throw Error("Addition missing");
    if (["applied", "applied_draft"].includes(r.status)) throw Error("Applied items are settled through the rental");
    if (["refunded", "expired"].includes(r.status) || r.withdrawalRequestedAt) return r;
    const patch = { withdrawalRequestedAt: Date.now(), status: "withdrawing", updatedAt: Date.now() };
    await ctx.db.patch(id, patch);
    return { ...r, ...patch };
  },
});

export const recordWithdrawalRefund = internalMutation({
  args: { id: v.id("rental_additions"), paymentIntentId: v.string(), refundId: v.string(), status: v.string(), amountPence: v.number() },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.id);
    if (!r?.withdrawalRequestedAt || r.paymentIntentId !== args.paymentIntentId) throw Error("Withdrawal payment mismatch");
    if (r.withdrawalRefundId && r.withdrawalRefundId !== args.refundId) throw Error("Withdrawal refund mismatch");
    const expected = Math.round(((r.draftReplacement ? r.baseTotal ?? 0 : 0) + r.lineTotal + r.securityCharge + (r.membershipFee ?? 0)) * 100);
    if (args.amountPence !== expected || !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(args.status)) throw Error("Withdrawal refund result mismatch");
    if (r.withdrawalRefundStatus === "succeeded") return;
    await ctx.db.patch(args.id, { withdrawalRefundId: args.refundId, withdrawalRefundStatus: args.status,
      status: ["failed", "canceled"].includes(args.status) ? "refund_failed" : "refund_pending", updatedAt: Date.now() });
  },
});

export const close = internalMutation({
  args: {
    id: v.id("rental_additions"),
    refunded: v.boolean(),
    preserveBooking: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, refunded, preserveBooking }) => {
    const r = await ctx.db.get(id);
    if (!r) return;
    if (["applied", "applied_draft"].includes(r.status))
      throw Error("Applied items are settled through the rental");
    if (r.status === "refunded" || r.status === "expired") return;
    if (r.securityCreationPending) throw Error("Wait for the pending security authorisation to be reconciled");
    if (r.withdrawalRequestedAt && r.paymentIntentId && (!refunded || r.withdrawalRefundStatus !== "succeeded")) throw Error("Wait for the withdrawal refund to be confirmed");
    const b = await ctx.db.get(r.bookingId);
    await ctx.db.patch(id, {
      status: refunded ? "refunded" : "expired",
      updatedAt: Date.now(),
    });
    if(r.draftReplacement&&!preserveBooking&&b?.status==="pending_payment"&&r.membershipCheckoutId){const member=await ctx.db.get(r.membershipCheckoutId);if(member&&["creating","open"].includes(member.state))await ctx.db.patch(member._id,{state:"expired"});}
    if (b?.activeAdditionId === id)
      await ctx.db.patch(
        b._id,
        r.draftReplacement && !preserveBooking && b.status === "pending_payment"
          ? {
              activeAdditionId: undefined,
              status: "cancelled",
              cancelledAt: Date.now(),
            }
          : { activeAdditionId: undefined },
      );
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", r.bookingId))
      .collect();
    for (const reservation of reservations)
      if (
        reservation.externalRef === `addition:${id}` ||
        (r.draftReplacement &&
          !preserveBooking &&
          reservation.status === "hold")
      )
        await ctx.db.delete(reservation._id);
    if (b)
      await note(
        ctx,
        b,
        refunded
          ? `The proposed addition of ${r.title} was withdrawn. Its payment is being returned to the card.`
          : r.draftReplacement && !preserveBooking
            ? `The updated checkout for ${r.title} closed without payment. This unpaid rental was cancelled; its conversation remains available.`
            : `The proposed addition of ${r.title} closed without payment. Your rental is unchanged.`,
      );
  },
});

export const open = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await Promise.all(
      [
        "prepared",
        "awaiting_payment",
        "paid",
        "requires_action",
        "held",
        "failed",
        "withdrawing",
        "refund_pending",
        "refund_failed",
      ].map((status) =>
        ctx.db
          .query("rental_additions")
          .withIndex("by_status_updated", (q) => q.eq("status", status))
          .order("asc")
          .take(30),
      ),
    );
    return rows
      .flat()
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, 50);
  },
});
export const touch = internalMutation({
  args: { id: v.id("rental_additions") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.patch(id, { updatedAt: Date.now() });
  },
});

export const customerState = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    const account = await accountForToken(ctx, token);
    if (!account) return null;
    const b = await ownedBooking(ctx, account, bookingId);
    if (!b.activeAdditionId) return null;
    const r = await ctx.db.get(b.activeAdditionId as Id<"rental_additions">);
    if (!r) return null;
    return {
      id: r._id,
      status: r.status,
      title: r.title,
      qty: r.qty,
      amount:
        (r.draftReplacement ? (r.baseTotal ?? 0) : 0) +
        r.lineTotal +
        r.securityCharge,
      securityCharge: r.securityCharge,
      holdTotal: r.holdTotal,
      url: r.withdrawalRequestedAt ? null : r.paymentUrl ?? null,
      sessionId: r.withdrawalRequestedAt ? null : r.sessionId ?? null,
      expiresAt: r.createdAt + 24 * 3600000,
    };
  },
});
