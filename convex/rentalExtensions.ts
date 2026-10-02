import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { accountForToken, ownedBooking, rentalThread, postRentalMessage } from "./lib/rentalChat";
import { assertRentalInventory } from "./lib/rentalInventory";
import { lateFeeQuote } from "./lib/lateFee";
import { londonStartOfDay } from "../src/lib/cancellationPolicy";

import { isAllowedReturnTime, HOURS_LABEL } from "../src/lib/site";

const DAY = 86400000;
const iso = (at: number) => new Date(at).toISOString().slice(0, 10);
const baseLines = (b: any) => JSON.stringify([b.lineItems, b.returnTime ?? null]);
const openStatuses = ["pending", "approved", "awaiting_payment", "refund_pending"];
const quoteIdentity = (items: any[]) => JSON.stringify(items.map(i => [i.lineIndex, i.listingId, i.title, i.start, i.end, i.qty, i.dailyRate, i.lineTotal]));

async function mutableRental(ctx: any, b: any, ownRequest?: any) {
  if (!b || !["confirmed", "active"].includes(b.status)) throw Error("Only confirmed or collected rentals can be extended.");
  if (b.cancellationDecision || b.returnDecision || b.activeAdditionId || (b.activeExtensionId && b.activeExtensionId !== ownRequest))
    throw Error("Finish the open rental operation first.");
  const reservations = await ctx.db.query("reservations").withIndex("by_booking", (q: any) => q.eq("bookingId", b._id)).collect();
  if (!reservations.length || reservations.some((r: any) => r.source !== "site")) throw Error("Manage this rental through its original booking platform.");
  // Catalogue sync must not silently release the physical units already on hire.
  const expected = new Map<string, number>(), actual = new Map<string, number>();
  const add = (map: Map<string, number>, listingId: any, unit: any, start: number, end: number, qty: number) => {
    const key = JSON.stringify([listingId, unit, start, end]); map.set(key, (map.get(key) ?? 0) + qty);
  };
  for (const li of b.lineItems) {
    const listing = await ctx.db.get(li.listingId);
    if (!listing?.components?.length) throw Error("The kit inventory mapping needs a team check.");
    for (const comp of listing.components) add(expected, li.listingId, comp.inventoryUnitId, li.start, li.end, comp.qty * li.qty);
  }
  for (const res of reservations) if (!res.extensionRequestId && ["confirmed", "active"].includes(res.status)) add(actual, res.listingId, res.inventoryUnitId, res.start, res.end, res.qty);
  const fingerprint = (map: Map<string, number>) => JSON.stringify([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  if (fingerprint(expected) !== fingerprint(actual)) throw Error("The kit inventory mapping changed. The team must reconcile the current rental before extending it.");
  const refunds = await ctx.db.query("rental_refunds").withIndex("by_booking", (q: any) => q.eq("bookingId", b._id)).collect();
  if (refunds.some((r: any) => ["prepared", "pending"].includes(r.status))) throw Error("Wait for the open refund to settle first.");
}

function indexes(b: any, selected?: number[]) {
  const result = selected?.length ? selected : b.lineItems.map((_: any, i: number) => i);
  if (!result.length || new Set(result).size !== result.length || result.some((i: number) => !Number.isSafeInteger(i) || !b.lineItems[i])) throw Error("Choose valid rental items.");
  return result as number[];
}

/** A server-owned daily-rate quote; no deposits, delivery charges or stacked promotions. */
async function quoteFor(ctx: any, b: any, extraDays: number, selected?: number[]) {
  if (!Number.isSafeInteger(extraDays) || extraDays < 1 || extraDays > 30) throw Error("Choose between 1 and 30 extra days.");
  const chosen = indexes(b, selected);
  const chosenLines = chosen.map(i => b.lineItems[i]);
  if (chosenLines.some(li => li.end < londonStartOfDay(Date.now())) || lateFeeQuote(chosenLines, b.returnTime ?? null, Date.now()).breakdown.length)
    throw Error("This return is already due. Please ask the team in chat about additional rental time.");
  const items = await Promise.all(chosen.map(async lineIndex => {
    const li = b.lineItems[lineIndex], listing = await ctx.db.get(li.listingId);
    const unitRate = listing?.pricing?.daily;
    if (!Number.isFinite(unitRate) || unitRate <= 0) throw Error("An item needs a team price before it can be extended.");
    const dailyRate = Math.round(unitRate * li.qty * 100) / 100;
    return { lineIndex, listingId: li.listingId, title: li.title, start: li.end + DAY, end: li.end + extraDays * DAY, qty: li.qty, dailyRate, lineTotal: Math.round(dailyRate * extraDays * 100) / 100 };
  }));
  const proposed = b.lineItems.map((li: any, i: number) => chosen.includes(i) ? { ...li, end: li.end + extraDays * DAY } : li);
  await assertRentalInventory(ctx, proposed, b._id);
  return { items, proposed, priceDelta: Math.round(items.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100 };
}

async function customer(ctx: any, token: string, bookingId: any) {
  const a = await accountForToken(ctx, token);
  if (!a || a.blockedAt) throw Error("Please sign in again.");
  return { a, b: await ownedBooking(ctx, a, bookingId) };
}

export const quote = query({
  args: { token: v.string(), bookingId: v.id("bookings"), extraDays: v.number(), lineItemIndexes: v.optional(v.array(v.number())), refreshKey: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { b } = await customer(ctx, args.token, args.bookingId);
    try {
      await mutableRental(ctx, b);
      const q = await quoteFor(ctx, b, args.extraDays, args.lineItemIndexes);
      return { available: true, items: q.items, priceDelta: q.priceDelta, baseLines: baseLines(b) };
    } catch (e: any) { return { available: false, reason: e.message }; }
  },
});

export const request = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), requestKey: v.string(), extraDays: v.number(), lineItemIndexes: v.optional(v.array(v.number())), expectedAmount: v.number(), expectedBase: v.string(), requestedReturnTime: v.string() },
  handler: async (ctx, args) => {
    const { a, b } = await customer(ctx, args.token, args.bookingId);
    if (!isAllowedReturnTime(args.requestedReturnTime)) throw Error(`Choose a return time within ${HOURS_LABEL} (London time).`);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestKey)) throw Error("Invalid request.");
    const previous = await ctx.db.query("booking_change_requests").withIndex("by_booking", q => q.eq("bookingId", b._id)).collect();
    const prior = previous.find(r => r.requestKey === args.requestKey);
    const chosen = indexes(b, args.lineItemIndexes);
    if (prior) {
      if (prior.requestedReturnTime !== args.requestedReturnTime || prior.accountId !== a._id || prior.extraDays !== args.extraDays || JSON.stringify(prior.lineItemIndexes) !== JSON.stringify(chosen) || prior.baseLines !== args.expectedBase || prior.priceDelta !== args.expectedAmount) throw Error("Request contents changed.");
      return { ok: true, requestId: prior._id };
    }
    await mutableRental(ctx, b);
    if (previous.some(r => openStatuses.includes(r.status))) throw Error("You already have an open change request for this rental.");
    const q = await quoteFor(ctx, b, args.extraDays, chosen);
    if (args.expectedBase !== baseLines(b) || args.expectedAmount !== q.priceDelta) throw Error("The rental or quote changed. Review the fresh quote before requesting.");
    const requestId = await ctx.db.insert("booking_change_requests", { bookingId: b._id, accountId: a._id, type: "extend", requestedReturnTime: args.requestedReturnTime, requestKey: args.requestKey, lineItemIndexes: chosen, extraDays: args.extraDays, baseLines: baseLines(b), quoteItems: q.items, priceDelta: q.priceDelta, status: "pending", createdAt: Date.now() });
    const thread = await rentalThread(ctx, a._id, b._id);
    if (thread) await ctx.db.patch(thread._id, { escalated: true });
    else await ctx.db.insert("chat_threads", { accountId: a._id, bookingId: b._id, escalated: true, updatedAt: Date.now(), unreadOwner: 0, unreadRenter: 0 });
    await postRentalMessage(ctx, { accountId: a._id, bookingId: b._id, sender: "renter", text: `Extension request · ${args.extraDays} extra day${args.extraDays === 1 ? "" : "s"} · £${q.priceDelta.toFixed(2)}\n${q.items.map(i => `${i.qty}× ${i.title} → ${iso(i.end)} at ${args.requestedReturnTime} London time`).join("\n")}\nPlease approve this request. The team may adjust the proposed time. The original return deadlines remain in place until approval and payment.`, meta: { kind: "extension_request", requestId } });
    await ctx.scheduler.runAfter(0, internal.notify.renterChat, { email: a.email, bookingId: b._id, text: "Rental extension requested — owner approval required." });
    return { ok: true, requestId };
  },
});

export const state = query({
  args: { token: v.string(), bookingId: v.id("bookings"), admin: v.optional(v.boolean()) },
  handler: async (ctx, { token, bookingId, admin }) => {
    if (admin) { if (!checkAdminToken(token)) return null; }
    else await customer(ctx, token, bookingId);
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const rows = await ctx.db.query("booking_change_requests").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc").take(20);
    return { status: b.status, locked: !!(b.activeAdditionId || b.activeExtensionId || b.returnDecision || b.cancellationDecision), items: b.lineItems.map((li, i) => ({ index: i, title: li.title, qty: li.qty, end: li.end, returnTime: li.returnTime === undefined ? b.returnTime ?? null : li.returnTime })), requests: rows.filter(r => r.type === "extend").map(r => ({ id: r._id, status: r.status, items: r.quoteItems ?? [], amount: r.priceDelta ?? null, days: r.extraDays, requestedReturnTime: r.requestedReturnTime, approvedReturnTime: r.approvedReturnTime, url: r.status === "awaiting_payment" ? r.paymentLinkUrl : undefined, expiresAt: r.expiresAt, reason: r.approvalReason, createdAt: r.createdAt })), paymentsEnabled: process.env.RENTAL_CHECKOUT_ENABLED === "true" || /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "") };
  },
});

export const context = internalQuery({
  args: { requestId: v.id("booking_change_requests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    return r ? { request: r, booking: await ctx.db.get(r.bookingId) } : null;
  },
});

/** Only the owner action or authenticated owner Telegram approval calls this mutation. */
export const prepare = internalMutation({
  args: { requestId: v.id("booking_change_requests"), reason: v.string(), approvedReturnTime: v.optional(v.string()) },
  handler: async (ctx, { requestId, reason, approvedReturnTime }) => {
    const r = await ctx.db.get(requestId);
    if (!r || r.type !== "extend") throw Error("Extension request unavailable.");
    if (["approved", "awaiting_payment", "applied"].includes(r.status)) return r;
    if (r.status !== "pending") throw Error("This request is closed.");
    const returnTime = approvedReturnTime ?? r.requestedReturnTime;
    if (!returnTime || !isAllowedReturnTime(returnTime)) throw Error(`Choose a return time within ${HOURS_LABEL} (London time).`);
    if (reason.trim().length < 5 || reason.length > 500) throw Error("Record an approval reason.");
    const b = await ctx.db.get(r.bookingId);
    await mutableRental(ctx, b);
    if (b?.depositHoldAmount && ((b.depositHoldExpiresAt ?? 0) <= Date.now() + 25 * 3600000 || ["starting", "requires_action", "failed"].includes(b.depositHoldRenewalStatus ?? ""))) throw Error("Renew or resolve the existing security hold before approving an extension.");
    if (!r.baseLines || r.baseLines !== baseLines(b)) throw Error("The rental changed. Decline this request and ask for a new quote.");
    const q = await quoteFor(ctx, b, r.extraDays!, r.lineItemIndexes);
    if (q.priceDelta !== r.priceDelta || quoteIdentity(q.items) !== quoteIdentity(r.quoteItems ?? [])) throw Error("The price changed. Decline this request and ask the renter to review a fresh quote.");
    const expiresAt = Date.now() + DAY;
    for (const item of q.items) {
      const listing = await ctx.db.get(item.listingId as Id<"listings">);
      for (const comp of listing!.components) await ctx.db.insert("reservations", { bookingId: b!._id, extensionRequestId: requestId, listingId: item.listingId, inventoryUnitId: comp.inventoryUnitId, qty: comp.qty * item.qty, start: item.start, end: item.end, source: "site", status: "hold", holdExpiresAt: expiresAt });
    }
    const patch = { approvedReturnTime: returnTime, status: "approved" as const, approvedAt: Date.now(), approvalReason: reason.trim(), expiresAt };
    await ctx.db.patch(requestId, patch);
    await ctx.db.patch(b!._id, { activeExtensionId: requestId });
    return { ...r, ...patch };
  },
});

export const bindPayment = internalMutation({
  args: { requestId: v.id("booking_change_requests"), sessionId: v.string(), url: v.string() },
  handler: async (ctx, { requestId, sessionId, url }) => {
    const r = await ctx.db.get(requestId);
    if (!r || !["approved", "awaiting_payment"].includes(r.status)) throw Error("The extension approval is closed.");
    if (r.stripePaymentLinkId) { if (r.stripePaymentLinkId !== sessionId) throw Error("Payment session mismatch."); return; }
    await ctx.db.patch(requestId, { status: "awaiting_payment", stripePaymentLinkId: sessionId, paymentLinkUrl: url });
    await postRentalMessage(ctx, { accountId: r.accountId, bookingId: r.bookingId, sender: "system", text: `The team approved your extension.\n${r.quoteItems?.map(i => `${i.title} → return ${iso(i.end)} at ${r.approvedReturnTime} London time`).join("\n")}\nPay £${r.priceDelta!.toFixed(2)} to confirm ${r.extraDays} extra day${r.extraDays === 1 ? "" : "s"}. Your original return dates still apply until payment succeeds. This payment link expires in 24 hours.`, meta: { kind: "extension_payment", requestId, url, amount: r.priceDelta } });
  },
});

export const decline = mutation({
  args: { token: v.string(), requestId: v.id("booking_change_requests"), reason: v.string() },
  handler: async (ctx, { token, requestId, reason }) => {
    await assertAdmin(ctx, token, "rentalExtensions.decline");
    const r = await ctx.db.get(requestId);
    if (!r || r.status !== "pending") throw Error("Only an unapproved request can be declined.");
    if (reason.trim().length < 5 || reason.length > 500) throw Error("Record a reason for declining.");
    await ctx.db.patch(requestId, { status: "declined", approvalReason: reason.trim(), resolvedAt: Date.now() });
    await postRentalMessage(ctx, { accountId: r.accountId, bookingId: r.bookingId, sender: "system", text: `The team couldn't approve your extension. ${reason.trim()} Your original rental dates and charges are unchanged.` });
  },
});

async function release(ctx: any, r: any) {
  const reservations = await ctx.db.query("reservations").withIndex("by_booking", (q: any) => q.eq("bookingId", r.bookingId)).collect();
  for (const res of reservations) if (res.extensionRequestId === r._id && res.status === "hold") await ctx.db.patch(res._id, { status: "cancelled" });
  const b = await ctx.db.get(r.bookingId);
  if (b?.activeExtensionId === r._id) await ctx.db.patch(b._id, { activeExtensionId: undefined });
}

export const close = internalMutation({
  args: { requestId: v.id("booking_change_requests"), refundId: v.optional(v.string()), paymentIntentId: v.optional(v.string()), refundPending: v.optional(v.boolean()), withdrawn: v.optional(v.boolean()) },
  handler: async (ctx, { requestId, refundId, paymentIntentId, refundPending, withdrawn }) => {
    const r = await ctx.db.get(requestId);
    if (!r || r.status === "applied" || r.status === "refunded") return;
    if (refundPending) {
      await ctx.db.patch(requestId, { status: "refund_pending", refundId, paymentIntentId });
      return; // Keep the operation lock until the provider attests its refund.
    }
    await release(ctx, r);
    const status = refundId ? "refunded" : withdrawn ? "withdrawn" : "expired";
    await ctx.db.patch(requestId, { status, refundId, paymentIntentId, resolvedAt: Date.now() });
    if (r.status !== status) await postRentalMessage(ctx, { accountId: r.accountId, bookingId: r.bookingId, sender: "system", text: refundId ? "The extension couldn't be applied. Its payment has been refunded; the original rental dates remain unchanged." : withdrawn ? "The team withdrew the unpaid extension approval. Your original return dates and charges remain unchanged." : "The extension approval expired without a completed payment. Your original return dates and charges remain unchanged." });
  },
});

/** Called only after a server-retrieved Stripe session and intent are attested. */
export const applyPaid = internalMutation({
  args: { requestId: v.id("booking_change_requests"), sessionId: v.string(), paymentIntentId: v.string(), amountPence: v.number() },
  handler: async (ctx, { requestId, sessionId, paymentIntentId, amountPence }) => {
    const r = await ctx.db.get(requestId);
    if (!r || r.type !== "extend") throw Error("Extension request missing.");
    if (r.stripePaymentLinkId !== sessionId || Math.round((r.priceDelta ?? -1) * 100) !== amountPence) throw Error("Extension payment does not match its approved quote.");
    if (r.status === "applied") { if (r.paymentIntentId !== paymentIntentId) throw Error("Payment identity mismatch."); return { ok: true, bookingId: r.bookingId }; }
    const b = await ctx.db.get(r.bookingId);
    if (r.status !== "awaiting_payment" || !r.approvedAt || !r.quoteItems || !r.approvedReturnTime || !isAllowedReturnTime(r.approvedReturnTime) || (r.expiresAt ?? 0) <= Date.now() || !b || b.activeExtensionId !== requestId || r.baseLines !== baseLines(b)) return { ok: false, closed: true, bookingId: r.bookingId };
    try { await mutableRental(ctx, b, requestId); } catch { return { ok: false, closed: true, bookingId: r.bookingId }; }
    const byIndex = new Map(r.quoteItems.map(i => [i.lineIndex, i]));
    const lines = b.lineItems.map((li, i) => byIndex.has(i) ? { ...li, end: byIndex.get(i)!.end, returnTime: r.approvedReturnTime } : { ...li, returnTime: li.returnTime === undefined ? b.returnTime ?? null : li.returnTime });
    // External reservations or calendar blocks may have changed even while our hold was active.
    try { await assertRentalInventory(ctx, lines, b._id); } catch { return { ok: false, closed: true, bookingId: r.bookingId }; }
    const reservations = await ctx.db.query("reservations").withIndex("by_booking", q => q.eq("bookingId", b._id)).collect();
    for (const res of reservations) if (["confirmed", "active", "hold"].includes(res.status)) await ctx.db.patch(res._id, { status: "cancelled" });
    for (const li of lines) {
      const listing = await ctx.db.get(li.listingId);
      for (const comp of listing!.components) await ctx.db.insert("reservations", { bookingId: b._id, listingId: li.listingId, inventoryUnitId: comp.inventoryUnitId, start: li.start, end: li.end, qty: comp.qty * li.qty, source: "site", status: b.status === "active" ? "active" : "confirmed" });
    }
    const charges = r.quoteItems.map(i => ({ requestId, returnTime: r.approvedReturnTime, title: `${i.title} · approved extension`, start: i.start, end: i.end, qty: i.qty, lineTotal: i.lineTotal }));
    await ctx.db.patch(b._id, { lineItems: lines, returnTime: [...lines].sort((a, b) => b.end - a.end)[0]?.returnTime ?? undefined, remindedReturn: false, total: Math.round((b.total + r.priceDelta!) * 100) / 100, subtotal: Math.round((b.subtotal + r.priceDelta!) * 100) / 100, extensionCharges: [...(b.extensionCharges ?? []), ...charges], activeExtensionId: undefined });
    await ctx.db.patch(requestId, { status: "applied", paymentIntentId, paidAt: Date.now(), resolvedAt: Date.now() });
    await postRentalMessage(ctx, { accountId: r.accountId, bookingId: b._id, sender: "system", text: `Extension confirmed · £${r.priceDelta!.toFixed(2)} paid.\n${r.quoteItems.map(i => `${i.qty}× ${i.title} → return ${iso(i.end)} at ${r.approvedReturnTime} London time`).join("\n")}\nSecurity amounts are unchanged.` });
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, { bookingId: b._id, kind: "extended", detail: r.quoteItems.map(i => `${i.title}: return ${iso(i.end)} at ${r.approvedReturnTime} London time`).join("; ") });
    await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId: b._id });
    return { ok: true, bookingId: b._id };
  },
});

export const pendingPayments = internalQuery({
  args: {},
  handler: async ctx => (await Promise.all(["approved", "awaiting_payment", "refund_pending"].map(status => ctx.db.query("booking_change_requests").withIndex("by_status", q => q.eq("status", status as "approved" | "awaiting_payment" | "refund_pending")).take(100)))).flat().filter(r => r.type === "extend"),
});
