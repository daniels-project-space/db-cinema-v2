import {stockWindow} from "./lib/stockWindows";
import { assertSwapStockReconciled } from "./lib/swapStockFence";
import {bookingStockLines,rentalWindow} from "../shared/rentalWindow";
import { assertRentalAllocation } from "./lib/rentalAllocation";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import type { Id } from "./_generated/dataModel";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { accountForToken, ownedBooking, rentalThread, postRentalMessage, scheduleGafferAutoResume } from "./lib/rentalChat";
import { assertRenterExposure } from "./lib/rentalExposure";
import { assertRentalInventory } from "./lib/rentalInventory";
import { lateFeeQuote } from "./lib/lateFee";
import { londonStartOfDay } from "../src/lib/cancellationPolicy";
import { bestBenefit, loyaltyPercent } from "../shared/rentalBenefits";
import { allocateSaving, membershipActiveNow, membershipTierFor, tierByKey, weekendDays } from "../shared/membership";
import { listingRentalImages } from "./lib/catalogImages";
import { assertRenterRentalActionReady, renterRentalActionReady } from "./lib/renterRentalActionGate";

import { isAllowedReturnTime, HOURS_LABEL } from "../src/lib/site";

import { rentalUnavailable } from "./lib/marketingInventory";
import { rentableCandidate } from "../shared/recommendationPolicy";
const DAY = 86400000;
const iso = (at: number) => new Date(at).toISOString().slice(0, 10);
const baseLines = (b: any) => JSON.stringify([b.lineItems, b.returnTime ?? null]);
const openStatuses = ["pending", "approved", "awaiting_payment", "refund_pending"];
const quoteIdentity = (items: any[]) => JSON.stringify(items.map(i => [i.lineIndex, i.listingId, i.title, i.start, i.end, i.qty, i.dailyRate, i.lineTotal]));

async function mutableRental(ctx: any, b: any, ownRequest?: any) {
  assertRenterRentalActionReady(b);
  if (!b || !["confirmed", "active"].includes(b.status)) throw Error("Only confirmed or collected rentals can be extended.");
  await assertSwapStockReconciled(ctx, b._id);
  if (b.cancellationDecision || b.returnDecision || b.activePriceAdjustmentId || b.activeItemSwapId || b.activeAdditionId || b.activeDeliveryQuoteId || (b.activeExtensionId && b.activeExtensionId !== ownRequest))
    throw Error("Finish the open rental operation first.");
  const reservations = await ctx.db.query("reservations").withIndex("by_booking", (q: any) => q.eq("bookingId", b._id)).collect();
  if (!reservations.length || reservations.some((r: any) => r.source !== "site")) throw Error("Manage this rental through its original booking platform.");
  await assertRentalAllocation(ctx, b, reservations);
  const refunds = await ctx.db.query("rental_refunds").withIndex("by_booking", (q: any) => q.eq("bookingId", b._id)).collect();
  if (refunds.some((r: any) => ["prepared", "pending"].includes(r.status))) throw Error("Wait for the open refund to settle first.");
}

function indexes(b: any, selected?: number[]) {
  const result = selected === undefined ? b.lineItems.map((_: any, i: number) => i) : selected;
  if (!result.length || new Set(result).size !== result.length || result.some((i: number) => !Number.isSafeInteger(i) || !b.lineItems[i])) throw Error("Choose valid rental items.");
  return result as number[];
}

/** A server-owned daily-rate quote; no deposits, delivery charges or stacked promotions. */
async function quoteFor(ctx: any, b: any, extraDays: number, selected?: number[], accountOverride?: any) {
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
  const account = accountOverride ?? (b.accountId ? await ctx.db.get(b.accountId) : null);
  const activeMembership = membershipActiveNow(account);
  const member = activeMembership ? tierByKey(membershipTierFor(account)) : undefined;
  const grossPence = items.reduce((sum, item) => sum + Math.round(item.lineTotal * 100), 0);
  const weekendSavingPence = member?.weekend
    ? Math.min(10000, items.reduce((sum, item) => weekendDays(item.start, item.end) ? sum + Math.round(item.dailyRate * 100) : sum, 0))
    : 0;
  const encorePercent = !activeMembership
    ? account?.loyaltyPercent ?? (account?.loyaltyEligible ? loyaltyPercent(3) : 0)
    : 0;
  const encoreSavingPence = Number.isFinite(encorePercent) && encorePercent > 0
    ? Math.min(grossPence, Math.round(grossPence * Math.min(encorePercent, 100) / 100))
    : 0;
  const benefit = bestBenefit([
    { kind: "weekend", savingPence: weekendSavingPence, label: "Member weekend deal · £100 cap" },
    { kind: "loyalty", savingPence: encoreSavingPence, label: `Encore · ${encorePercent}% rental saving` },
  ]);
  const discountedLineTotals = allocateSaving(items.map(item => item.lineTotal), benefit.savingPence / 100);
  const pricedItems = items.map((item, index) => ({ ...item, lineTotal: discountedLineTotals[index] }));
  const benefitSaving = benefit.savingPence / 100;
  const proposed = bookingStockLines<any>(b).map((li: any, i: number) => chosen.includes(i) ? { ...li, end: li.end + extraDays * DAY } : li);
  await assertRenterExposure(ctx, b, proposed);
  const cache = { records: new Map(), reservations: new Map() };
  await assertRentalInventory(ctx, proposed, b._id, cache);
  return { items: pricedItems, proposed, priceDelta: Math.round(pricedItems.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100, benefitKind: benefit.kind, benefitLabel: benefitSaving > 0 ? benefit.label : undefined, benefitSaving };
}


async function quoteSelection(ctx: any, b: any, account: any, extraDays: number, chosen: number[]) {
  try {
    const q = await quoteFor(ctx, b, extraDays, chosen, account);
    return {
      available: true,
      partialAvailability: false,
      availableIndexes: chosen,
      individuallyAvailableIndexes: chosen,
      selectionConflictItems: [],
      unavailableItems: [],
      items: q.items,
      priceDelta: q.priceDelta,
      benefitKind: q.benefitKind,
      benefitLabel: q.benefitLabel ?? "",
      benefitSaving: q.benefitSaving,
      baseLines: baseLines(b),
    };
  } catch (fullError: any) {
    const individuallyAvailableIndexes: number[] = [];
    const unavailableItems: { lineIndex: number; title: string; qty: number; reason: string }[] = [];
    for (const lineIndex of chosen) {
      try {
        await quoteFor(ctx, b, extraDays, [lineIndex], account);
        individuallyAvailableIndexes.push(lineIndex);
      } catch (itemError: any) {
        const line = b.lineItems[lineIndex];
        unavailableItems.push({
          lineIndex,
          title: line.title,
          qty: line.qty,
          reason: itemError?.message ?? "This item could not be extended for those dates.",
        });
      }
    }
    const availableIndexes: number[] = [];
    const selectionConflictItems: { lineIndex: number; title: string; qty: number; reason: string }[] = [];
    for (const lineIndex of individuallyAvailableIndexes) {
      try {
        await quoteFor(ctx, b, extraDays, [...availableIndexes, lineIndex], account);
        availableIndexes.push(lineIndex);
      } catch {
        const line = b.lineItems[lineIndex];
        selectionConflictItems.push({
          lineIndex,
          title: line.title,
          qty: line.qty,
          reason: "This item can be extended on its own, but conflicts with another selected item.",
        });
      }
    }
    if (!availableIndexes.length) {
      return {
        available: false,
        partialAvailability: false,
        availableIndexes,
        individuallyAvailableIndexes,
        selectionConflictItems,
        unavailableItems,
        items: [],
        priceDelta: 0,
        benefitKind: "none",
        benefitLabel: "",
        benefitSaving: 0,
        reason: fullError?.message ?? "No selected items are available for those dates.",
        baseLines: baseLines(b),
      };
    }
    const q = await quoteFor(ctx, b, extraDays, availableIndexes, account);
    return {
      available: true,
      partialAvailability: unavailableItems.length > 0 || selectionConflictItems.length > 0,
      availableIndexes,
      individuallyAvailableIndexes,
      selectionConflictItems,
      unavailableItems,
      items: q.items,
      priceDelta: q.priceDelta,
      benefitKind: q.benefitKind,
      benefitLabel: q.benefitLabel ?? "",
      benefitSaving: q.benefitSaving,
      baseLines: baseLines(b),
    };
  }
}

async function customer(ctx: any, token: string, bookingId: any) {
  const a = await accountForToken(ctx, token, true);
  if (!a || a.blockedAt) throw Error("Please sign in again.");
  return { a, b: await ownedBooking(ctx, a, bookingId) };
}


export const gafferPreview = internalQuery({
  args: {
    accountId: v.id("accounts"),
    bookingId: v.id("bookings"),
    extraDays: v.optional(v.number()),
  },
  handler: async (ctx, { accountId, bookingId, extraDays }) => {
    const account = await ctx.db.get(accountId);
    if (!account || account.blockedAt != null) {
      return { bookingId, quoteStatus: "unavailable" as const, availableIndexes: [], items: [], unavailableItems: [], reason: "This rental needs help from the team.", approvalRequired: true, paymentLinkAfterApprovalOnly: true, datesChanged: false };
    }
    let b: any;
    try { b = await ownedBooking(ctx, account, bookingId); }
    catch {
      return { bookingId, quoteStatus: "unavailable" as const, availableIndexes: [], items: [], unavailableItems: [], reason: "This rental could not be checked.", approvalRequired: true, paymentLinkAfterApprovalOnly: true, datesChanged: false };
    }
    const originalItems = await Promise.all((b.lineItems ?? []).map(async (line: any, index: number) => {
      const listing: any = await ctx.db.get(line.listingId);
      return {
        index,
        listingId: line.listingId,
        ...(listing?.slug ? { slug: listing.slug } : {}),
        title: line.title ?? listing?.title ?? "Rental item",
        qty: line.qty,
        originalEnd: line.end,
        originalReturnTime: line.returnTime === undefined ? b.returnTime ?? null : line.returnTime,
        imageSources: listingRentalImages(listing).slice(0, 4),
      };
    }));
    const cardBase = {
      version: 1 as const,
      bookingId,
      availableIndexes: [] as number[],
      approvalRequired: true as const,
      paymentLinkAfterApprovalOnly: true as const,
      datesChanged: false as const,
    };
    if (!Number.isFinite(extraDays)) {
      return {
        ...cardBase,
        quoteStatus: "duration_required" as const,
        items: originalItems.map((item: any) => ({ ...item, availability: "unchecked" as const })),
        unavailableItems: [],
      };
    }
    if (!Number.isSafeInteger(extraDays) || extraDays! < 1 || extraDays! > 30) {
      const reason = "Choose between 1 and 30 extra days.";
      return {
        ...cardBase,
        quoteStatus: "unavailable" as const,
        extraDays,
        items: [],
        unavailableItems: originalItems.map((item: any) => ({ ...item, reason, alternatives: [] })),
        reason,
      };
    }
    if (!["confirmed", "active"].includes(b.status) || !Array.isArray(b.lineItems) || !b.lineItems.length) {
      const reason = "Only a confirmed or collected rental can be extended.";
      return {
        ...cardBase,
        quoteStatus: "unavailable" as const,
        extraDays,
        items: [],
        unavailableItems: originalItems.map((item: any) => ({ ...item, reason, alternatives: [] })),
        reason,
      };
    }
    try {
      await mutableRental(ctx, b);
    } catch (error: any) {
      const reason = error?.message ?? "This rental needs a team check before it can be extended.";
      return {
        ...cardBase,
        quoteStatus: "unavailable" as const,
        extraDays,
        items: [],
        unavailableItems: originalItems.map((item: any) => ({ ...item, reason, alternatives: [] })),
        reason,
      };
    }
    const chosen = indexes(b);
    const quoted = await quoteSelection(ctx, b, account, extraDays!, chosen);
    const availableItems = (quoted.items ?? []).map((item: any) => {
      const original = originalItems[item.lineIndex];
      return {
        ...original,
        proposedEnd: item.end,
        days: extraDays,
        dailyRate: item.dailyRate,
        lineTotal: item.lineTotal,
        availability: "available" as const,
      };
    });
    const unavailableRows = [...(quoted.unavailableItems ?? []), ...(quoted.selectionConflictItems ?? [])];
    const unavailableItems = await Promise.all(unavailableRows.map(async (unavailable: any) => {
      const original = originalItems[unavailable.lineIndex];
      const line = b.lineItems[unavailable.lineIndex];
      const listing: any = await ctx.db.get(line?.listingId);
      const stockBlocked = (quoted.unavailableItems ?? []).some((row: any) => row.lineIndex === unavailable.lineIndex)
        && /reserved|unavailable|inventory capacity|blocked|no longer available/i.test(unavailable.reason);
      let alternatives: any[] = [];
      if (stockBlocked && listing?.category) {
        const candidates = await ctx.db.query("listings")
          .withIndex("by_category_active_demand", (q: any) => q.eq("category", listing.category).eq("active", true))
          .order("desc")
          .take(24);
        for (const candidate of candidates) {
          if (alternatives.length >= 2) break;
          if (String(candidate._id) === String(line.listingId) || rentalUnavailable(candidate) || !rentableCandidate(candidate)) continue;
          if (!Array.isArray(candidate.components) || !candidate.components.length
            || !candidate.components.every((component: any) => !!component.inventoryUnitId && Number.isSafeInteger(component.qty) && component.qty > 0)
            || !Number.isFinite(candidate.pricing?.daily) || candidate.pricing.daily <= 0) continue;
          const alternativeLine = {
            listingId: candidate._id,
            title: candidate.title,
            qty: line.qty,
            start: line.end + DAY,
            end: line.end,
            pickupTime: line.pickupTime === undefined ? b.pickupTime ?? null : line.pickupTime,
            returnTime: line.returnTime === undefined ? b.returnTime ?? null : line.returnTime,
          };
          const alternativeRental = {
            accountId: account._id,
            guestEmail: b.guestEmail ?? account.email,
            pickupTime: b.pickupTime ?? null,
            returnTime: b.returnTime ?? null,
            lineItems: [alternativeLine],
          };
          try {
            const quote = await quoteFor(ctx, alternativeRental, extraDays!, [0], account);
            const imageSources = listingRentalImages(candidate).slice(0, 4);
            if (!imageSources.length) continue;
            alternatives.push({
              listingId: candidate._id,
              ...(candidate.slug ? { slug: candidate.slug } : {}),
              title: candidate.title,
              qty: line.qty,
              imageSources,
              days: extraDays,
              dailyRate: quote.items[0].dailyRate,
              total: quote.priceDelta,
              ...(quote.benefitSaving > 0 ? { benefit: { label: quote.benefitLabel, saving: quote.benefitSaving } } : {}),
              availability: "available" as const,
              informationalOnly: true as const,
            });
          } catch {
            // An alternative is shown only after the same live inventory and member-price checks pass.
          }
        }
      }
      return {
        ...(original ?? {
          index: unavailable.lineIndex,
          listingId: line?.listingId,
          title: unavailable.title ?? "Rental item",
          qty: unavailable.qty ?? line?.qty ?? 1,
          originalEnd: line?.end ?? 0,
          originalReturnTime: line?.returnTime === undefined ? b.returnTime ?? null : line?.returnTime,
          imageSources: listingRentalImages(listing).slice(0, 4),
        }),
        reason: unavailable.reason,
        alternatives,
      };
    }));
    const quoteStatus = !quoted.availableIndexes.length
      ? "unavailable" as const
      : quoted.partialAvailability
        ? "partial" as const
        : "available" as const;
    return {
      ...cardBase,
      quoteStatus,
      extraDays,
      ...(quoted.available ? { total: quoted.priceDelta } : {}),
      ...((quoted.benefitSaving ?? 0) > 0 ? { benefit: { label: quoted.benefitLabel, saving: quoted.benefitSaving } } : {}),
      availableIndexes: quoted.availableIndexes,
      items: availableItems,
      unavailableItems,
      ...(quoted.reason ? { reason: quoted.reason } : {}),
    };
  },
});
export const quote = query({
  args: { token: v.string(), bookingId: v.id("bookings"), extraDays: v.number(), lineItemIndexes: v.optional(v.array(v.number())), refreshKey: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { a, b } = await customer(ctx, args.token, args.bookingId);
    try {
      await mutableRental(ctx, b);
      const chosen = indexes(b, args.lineItemIndexes);
      return await quoteSelection(ctx, b, a, args.extraDays, chosen);
    } catch (e: any) {
      return {
        available: false,
        partialAvailability: false,
        availableIndexes: [],
        individuallyAvailableIndexes: [],
        selectionConflictItems: [],
        unavailableItems: [],
        items: [],
        priceDelta: 0,
        benefitKind: "none",
        benefitLabel: "",
        benefitSaving: 0,
        baseLines: "",
        reason: e.message,
      };
    }
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
    const q = await quoteFor(ctx, b, args.extraDays, chosen, a);
    if (args.expectedBase !== baseLines(b) || args.expectedAmount !== q.priceDelta) throw Error("The rental or quote changed. Review the fresh quote before requesting.");
    const chatItems = await Promise.all(q.items.map(async (item) => {
      const line = b.lineItems[item.lineIndex];
      const listing = line ? await ctx.db.get(line.listingId) : null;
      return {
        lineIndex: item.lineIndex,
        title: item.title,
        qty: item.qty,
        end: item.end,
        lineTotal: item.lineTotal,
        imageSources: listingRentalImages(listing).slice(0, 4),
      };
    }));
    const requestId = await ctx.db.insert("booking_change_requests", { bookingId: b._id, accountId: a._id, type: "extend", requestedReturnTime: args.requestedReturnTime, requestKey: args.requestKey, lineItemIndexes: chosen, extraDays: args.extraDays, baseLines: baseLines(b), quoteItems: q.items, priceDelta: q.priceDelta, benefitKind: q.benefitKind, benefitLabel: q.benefitLabel, benefitSaving: q.benefitSaving, status: "pending", createdAt: Date.now() });
    const thread = await rentalThread(ctx, a._id, b._id);
    const escalationAt=Date.now();
    if (thread) await ctx.db.patch(thread._id, { escalated: true, ...(!thread.escalated?{escalatedAt:escalationAt,lastHumanActivityAt:undefined}:{}) });
    else await ctx.db.insert("chat_threads", { accountId: a._id, bookingId: b._id, escalated: true, escalatedAt:escalationAt, updatedAt: escalationAt, unreadOwner: 0, unreadRenter: 0 });
    await scheduleGafferAutoResume(ctx,a._id,b._id);
    await postRentalMessage(ctx, { accountId: a._id, bookingId: b._id, sender: "renter", text: `Extension request · awaiting team approval. Original return times stay in place until approval and payment.`, meta: { kind: "extension_request", requestId, amount: q.priceDelta, extraDays: args.extraDays, returnTime: args.requestedReturnTime, benefitSaving: q.benefitSaving, benefitLabel: q.benefitLabel, items: chatItems } });
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
    const items = await Promise.all(b.lineItems.map(async (li, i) => {
      const listing = await ctx.db.get(li.listingId);
      return { index: i, listingId: li.listingId, slug: listing?.slug ?? null, title: li.title, qty: li.qty, start: li.start, end: li.end, returnTime: li.returnTime === undefined ? b.returnTime ?? null : li.returnTime, imageSources: listingRentalImages(listing) };
    }));
    return { status: b.status, actionReady: renterRentalActionReady(b), locked: !!(b.activeAdditionId || b.activeDeliveryQuoteId || b.activeExtensionId || b.activePriceAdjustmentId || b.activeItemSwapId || b.returnDecision || b.cancellationDecision), pickupTime: b.pickupTime ?? null, returnTime: b.returnTime ?? null, items, requests: rows.filter(r => r.type === "extend").map(r => ({ id: r._id, status: r.status, items: r.quoteItems ?? [], amount: r.priceDelta ?? null, benefitKind: r.benefitKind, benefitLabel: r.benefitLabel, benefitSaving: r.benefitSaving ?? 0, days: r.extraDays, requestedReturnTime: r.requestedReturnTime, approvedReturnTime: r.approvedReturnTime, url: r.status === "awaiting_payment" ? r.paymentLinkUrl : undefined, expiresAt: r.expiresAt, reason: r.approvalReason, createdAt: r.createdAt })), paymentsEnabled: process.env.RENTAL_CHECKOUT_ENABLED === "true" || /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "") };
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
    const account = await ctx.db.get(r.accountId);
    const q = await quoteFor(ctx, b, r.extraDays!, r.lineItemIndexes, account);
    if (q.priceDelta !== r.priceDelta || q.benefitKind !== (r.benefitKind ?? "none") || q.benefitSaving !== (r.benefitSaving ?? 0) || quoteIdentity(q.items) !== quoteIdentity(r.quoteItems ?? [])) throw Error("The price changed because the member benefit changed. Decline this request and ask the renter to review a fresh quote.");
    const proposed=bookingStockLines(b!).map((li,index)=>q.items.some(item=>item.lineIndex===index)?{...li,end:q.items.find(item=>item.lineIndex===index)!.end,returnTime}:li);
    await assertRentalInventory(ctx,proposed,b!._id);
    const expiresAt = Date.now() + DAY;
    for (const item of q.items) {
      const original=bookingStockLines(b!)[item.lineIndex],extended=proposed[item.lineIndex];
      // Reserve continuously from the previous agreed return, including the
      // remainder of that day, through the newly approved return clock.
      const start=stockWindow(original,true).end,end=stockWindow(extended,true).end;
      const listing = await ctx.db.get(item.listingId as Id<"listings">);
      for (const comp of listing!.components) await ctx.db.insert("reservations", { bookingId: b!._id, extensionRequestId: requestId, listingId: item.listingId, inventoryUnitId: comp.inventoryUnitId, qty: comp.qty * item.qty, start,end,endExclusive:true,turnaroundBufferMinutes:60, source: "site", status: "hold", holdExpiresAt: expiresAt });
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
    const chatItems = await Promise.all((r.quoteItems ?? []).map(async (item: any) => {
      const listing = item.listingId ? await ctx.db.get(item.listingId as Id<"listings">) : null;
      return {
        lineIndex: item.lineIndex,
        title: item.title,
        qty: item.qty,
        end: item.end,
        lineTotal: item.lineTotal,
        imageSources: listingRentalImages(listing).slice(0, 4),
      };
    }));
    await ctx.db.patch(requestId, { status: "awaiting_payment", stripePaymentLinkId: sessionId, paymentLinkUrl: url });
    await postRentalMessage(ctx, { accountId: r.accountId, bookingId: r.bookingId, sender: "system", text: `Extension approved · pay to confirm. Your original return times stay in place until payment succeeds. Link expires in 24 hours.`, meta: { kind: "extension_payment", requestId, url, amount: r.priceDelta, extraDays: r.extraDays, returnTime: r.approvedReturnTime, benefitSaving: r.benefitSaving ?? 0, benefitLabel: r.benefitLabel, items: chatItems } });
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
  args: {
    requestId: v.id("booking_change_requests"),
    sessionId: v.optional(v.string()),
    paymentIntentId: v.optional(v.string()),
    amountPence: v.number(),
    approvedZero: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { requestId, sessionId, paymentIntentId, amountPence } = args;
    const approvedZero = args.approvedZero === true;
    const r = await ctx.db.get(requestId);
    if (!r || r.type !== "extend") throw Error("Extension request missing.");
    if (approvedZero) {
      if (amountPence !== 0 || r.priceDelta !== 0 || r.stripePaymentLinkId) {
        throw Error("Only an approved zero-balance extension can settle without Stripe.");
      }
    } else if (!sessionId || !paymentIntentId || r.stripePaymentLinkId !== sessionId || Math.round((r.priceDelta ?? -1) * 100) !== amountPence) {
      throw Error("Extension payment does not match its approved quote.");
    }
    if (r.status === "applied") {
      if (approvedZero ? r.settlementKind !== "approved_zero" : r.paymentIntentId !== paymentIntentId) {
        throw Error("Payment identity mismatch.");
      }
      return { ok: true, bookingId: r.bookingId };
    }
    const b = await ctx.db.get(r.bookingId);
    if (b) await assertSwapStockReconciled(ctx, b._id);
    const settlementReady = approvedZero ? r.status === "approved" : r.status === "awaiting_payment";
    if (!settlementReady || !r.approvedAt || !r.quoteItems || !r.approvedReturnTime || !isAllowedReturnTime(r.approvedReturnTime)
      || (r.expiresAt ?? 0) <= Date.now() || !b || b.activeExtensionId !== requestId || r.baseLines !== baseLines(b)) {
      return { ok: false, closed: true, bookingId: r.bookingId };
    }
    try { await mutableRental(ctx, b, requestId); }
    catch { return { ok: false, closed: true, bookingId: r.bookingId }; }
    if (approvedZero) {
      const account = await ctx.db.get(r.accountId);
      const currentQuote = await quoteFor(ctx, b, r.extraDays!, r.lineItemIndexes, account);
      if (currentQuote.priceDelta !== 0 || currentQuote.priceDelta !== r.priceDelta
        || currentQuote.benefitKind !== (r.benefitKind ?? "none")
        || currentQuote.benefitSaving !== (r.benefitSaving ?? 0)
        || quoteIdentity(currentQuote.items) !== quoteIdentity(r.quoteItems)) {
        throw Error("The zero-balance extension quote changed. Review the request again before applying it.");
      }
    }
    const byIndex = new Map(r.quoteItems.map(i => [i.lineIndex, i]));
    const lines = bookingStockLines(b).map((li, i) => byIndex.has(i) ? { ...li, end: byIndex.get(i)!.end, returnTime: r.approvedReturnTime } : { ...li, returnTime: li.returnTime === undefined ? b.returnTime ?? null : li.returnTime });
    // External reservations or calendar blocks may have changed while approval was being recorded.
    try { await assertRenterExposure(ctx, b, lines); await assertRentalInventory(ctx, lines, b._id); }
    catch { return { ok: false, closed: true, bookingId: r.bookingId }; }
    const reservations = await ctx.db.query("reservations").withIndex("by_booking", q => q.eq("bookingId", b._id)).collect();
    for (const res of reservations) if (["confirmed", "active", "hold"].includes(res.status)) await ctx.db.patch(res._id, { status: "cancelled" });
    for (const li of lines) {
      const listing = await ctx.db.get(li.listingId);
      for (const comp of listing!.components) await ctx.db.insert("reservations", { bookingId: b._id, listingId: li.listingId, inventoryUnitId: comp.inventoryUnitId, ...stockWindow(li, true), qty: comp.qty * li.qty, source: "site", status: b.status === "active" ? "active" : "confirmed" });
    }
    const charges = r.quoteItems.map(i => ({ requestId, returnTime: r.approvedReturnTime, title: `${i.title} · approved extension`, start: i.start, end: i.end, qty: i.qty, lineTotal: i.lineTotal }));
    const now = Date.now();
    await ctx.db.patch(b._id, {
      lineItems: lines,
      returnTime: [...lines].sort((a, b) => b.end - a.end)[0]?.returnTime ?? undefined,
      remindedReturn: false,
      total: Math.round((b.total + r.priceDelta!) * 100) / 100,
      subtotal: Math.round((b.subtotal + r.priceDelta!) * 100) / 100,
      extensionCharges: [...(b.extensionCharges ?? []), ...charges],
      activeExtensionId: undefined,
    });
    await ctx.db.patch(requestId, {
      status: "applied",
      ...(approvedZero
        ? { settlementKind: "approved_zero", settledAt: now }
        : { settlementKind: "stripe", paymentIntentId, paidAt: now, settledAt: now }),
      resolvedAt: now,
    });
    const settlementText = approvedZero ? "Extension confirmed · no additional payment due." : `Extension confirmed · £${r.priceDelta!.toFixed(2)} paid.`;
    await postRentalMessage(ctx, {
      accountId: r.accountId,
      bookingId: b._id,
      sender: "system",
      text: `${settlementText}\\n${r.quoteItems.map(i => `${i.qty}× ${i.title} → return ${iso(i.end)} at ${r.approvedReturnTime} London time`).join("\\n")}${r.benefitSaving ? `\\n${r.benefitLabel} · saving £${r.benefitSaving.toFixed(2)}` : ""}\\nSecurity amounts are unchanged.`,
    });
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, { bookingId: b._id, kind: "extended", detail: r.quoteItems.map(i => `${i.title}: return ${iso(i.end)} at ${r.approvedReturnTime} London time`).join("; ") });
    await queueRmv2Sync(ctx, b._id);
    return { ok: true, bookingId: b._id };
  },
});

export const pendingPayments = internalQuery({
  args: {},
  handler: async ctx => (await Promise.all(["approved", "awaiting_payment", "refund_pending"].map(status => ctx.db.query("booking_change_requests").withIndex("by_status", q => q.eq("status", status as "approved" | "awaiting_payment" | "refund_pending")).take(100)))).flat().filter(r => r.type === "extend"),
});
