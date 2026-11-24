import {stockWindow} from "./lib/stockWindows";
import { assertSwapStockReconciled } from "./lib/swapStockFence";
import {bookingStockLines,rentalWindow,dateLabel,londonRentalInstant} from "../shared/rentalWindow";
import { rentalPricingDays } from "../shared/rentalDuration";
import { adminLateBillingLines } from "./lib/adminLateLedger";
import { assertRentalAllocation } from "./lib/rentalAllocation";
import { storedBookingComponents } from "./lib/bookingComponentAllocation";
import { assertComponentReplacementExtensionPricing } from "./lib/componentReplacementPolicy";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import type { Id } from "./_generated/dataModel";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { accountForToken, ownedBooking, rentalThread, postRentalMessage, scheduleGafferAutoResume } from "./lib/rentalChat";
import { assertRenterExposure } from "./lib/rentalExposure";
import { assertRentalInventory } from "./lib/rentalInventory";
import { assertFreshSharedStock } from "./lib/shared_stock_sync";
import { lateFeeQuote } from "./lib/lateFee";
import { londonStartOfDay } from "../src/lib/cancellationPolicy";
import { bestBenefit, memberRentalBenefitCandidates } from "../shared/rentalBenefits";
import { allocateSaving, weekendDays } from "../shared/membership";
import { listingRentalImages } from "./lib/catalogImages";
import { assertRenterRentalActionReady, renterRentalActionReady } from "./lib/renterRentalActionGate";
import { rentalExtensionItemSelection } from "../shared/rentalExtensionConversation";
import { recommendationCompatible } from "../shared/recommendationPolicy";
import { verifiedKitEvidence } from "./lib/compatibilityEvidence";
import { rentalBenefitAccount } from "./lib/rentalBenefitAccount";
import { availableRentalCreditPence, reserveRentalCredit, releaseRentalCredit, consumeRentalCredit, reservationForOperation } from "./lib/rentalCreditFunding";
import { quote as pricingQuote } from "./lib/pricing";
import { RENTAL_REQUEST_HISTORY_LIMIT, summarizeBookingChangeRequests } from "./lib/rentalRequestStatus";

import { isAllowedReturnTime, HOURS_LABEL } from "../src/lib/site";

import { rentalUnavailable } from "./lib/marketingInventory";
import { rentableCandidate } from "../shared/recommendationPolicy";
const DAY = 86400000;
const iso = (at: number) => new Date(at).toISOString().slice(0, 10);
const baseLines = (b: any) => JSON.stringify([b.lineItems, b.returnTime ?? null]);
const quoteIdentity = (items: any[]) => JSON.stringify(items.map(i => [i.lineIndex, i.listingId, i.title, i.start, i.end, i.qty, i.dailyRate, i.lineTotal]));

async function expirePendingCreditRequest(ctx: any, requestId: any, now: number) {
  const request = await ctx.db.get(requestId);
  if (!request || request.type !== "extend" || request.status !== "pending" || !request.creditReservationId || (request.expiresAt ?? 0) > now) return false;
  await releaseRentalCredit(ctx, "extension", String(request._id));
  await ctx.db.patch(request._id, { status: "expired", resolvedAt: now });
  await postRentalMessage(ctx, {
    accountId: request.accountId,
    bookingId: request.bookingId,
    sender: "system",
    text: "Your extension request expired before approval. The original rental dates and charges are unchanged, and the reserved account credit is available again.",
  });
  return true;
}

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

/** A server-owned duration-tier quote; no deposits, delivery charges or stacked promotions. */
async function quoteFor(ctx: any, b: any, extraDays: number, selected?: number[], accountOverride?: any, requestedReturnTime?: string) {
  await assertComponentReplacementExtensionPricing(ctx, b);
  await assertFreshSharedStock(ctx);
  if (!Number.isSafeInteger(extraDays) || extraDays < 1 || extraDays > 30) throw Error("Choose between 1 and 30 extra days.");
  const chosen = indexes(b, selected);
  const chosenLines = chosen.map(i => b.lineItems[i]);
  if (chosenLines.some(li => li.end < londonStartOfDay(Date.now())) || lateFeeQuote(chosenLines, b.returnTime ?? null, Date.now()).breakdown.length)
    throw Error("This return is already due. Please ask the team in chat about additional rental time.");
  const items = await Promise.all(chosen.map(async lineIndex => {
    const li = b.lineItems[lineIndex], listing = await ctx.db.get(li.listingId);
    const unitRate = listing?.pricing?.daily;
    if (!Number.isFinite(unitRate) || unitRate <= 0) throw Error("An item needs a team price before it can be extended.");
    const pricing = pricingQuote(listing.pricing, extraDays);
    const adjustment = li.physicalAllocation?.extensionAdjustmentPence?.[extraDays - 1] ?? 0;
    const totalPence = Math.round(pricing.total * 100) + adjustment;
    if (!Number.isSafeInteger(totalPence) || totalPence < 0) throw Error("The substituted kit extension price needs review.");
    const dailyRate = li.physicalAllocation ? Math.round(totalPence * li.qty / extraDays) / 100 : Math.round(pricing.perDay * li.qty * 100) / 100;
    const start = li.end + DAY, end = li.end + extraDays * DAY;
    const previousAdjustment = li.physicalAllocation?.extensionAdjustmentPence?.[extraDays - 2] ?? 0;
    const previousTotalPence = Math.round(pricingQuote(listing.pricing, extraDays - 1).total * 100) + previousAdjustment;
    if (li.physicalAllocation && extraDays > 1 && previousTotalPence < 0) throw Error("The substituted kit extension price needs review.");
    const weekendSavingPence = weekendDays(start, end)
      ? Math.max(0, totalPence - previousTotalPence) * li.qty
      : 0;
    return { lineIndex, listingId: li.listingId, title: li.title, start, end, qty: li.qty, dailyRate, lineTotal: totalPence * li.qty / 100, weekendSavingPence };
  }));
  const grossPence = items.reduce((sum, item) => sum + Math.round(item.lineTotal * 100), 0);
  const account = await rentalBenefitAccount(ctx, accountOverride ?? (b.accountId ? await ctx.db.get(b.accountId) : null));
  const benefit = bestBenefit(memberRentalBenefitCandidates({
    account,
    subtotalPence: grossPence,
    weekendSavingPence: items.reduce((sum,item)=>sum+item.weekendSavingPence,0),
  }));
  const discountedLineTotals = allocateSaving(items.map(item => item.lineTotal), benefit.savingPence / 100);
  const pricedItems = items.map(({weekendSavingPence: _weekendSavingPence,...item}, index) => ({ ...item, lineTotal: discountedLineTotals[index] }));
  const benefitSaving = benefit.savingPence / 100;
  const proposed = bookingStockLines<any>(b).map((li: any, i: number) => chosen.includes(i) ? { ...li, end: li.end + extraDays * DAY, ...(requestedReturnTime ? { returnTime: requestedReturnTime } : {}) } : li);
  await assertRenterExposure(ctx, b, proposed, items.map(item => ({ start: item.start, end: item.end })));
  const cache = { records: new Map(), reservations: new Map() };
  await assertRentalInventory(ctx, proposed, b._id, cache);
  return { items: pricedItems, proposed, priceDelta: Math.round(pricedItems.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100, benefitKind: benefit.kind, benefitLabel: benefitSaving > 0 ? benefit.label : undefined, benefitSaving };
}


async function quoteSelection(ctx: any, b: any, account: any, extraDays: number, chosen: number[], requestedReturnTime?: string) {
  const benefitAccount = await rentalBenefitAccount(ctx, account);
  try {
    const q = await quoteFor(ctx, b, extraDays, chosen, benefitAccount, requestedReturnTime);
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
        await quoteFor(ctx, b, extraDays, [lineIndex], benefitAccount, requestedReturnTime);
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
        await quoteFor(ctx, b, extraDays, [...availableIndexes, lineIndex], benefitAccount, requestedReturnTime);
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
    const q = await quoteFor(ctx, b, extraDays, availableIndexes, benefitAccount, requestedReturnTime);
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
    requestText: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, bookingId, extraDays, requestText }) => {
    const account = await ctx.db.get(accountId);
    if (!account || account.blockedAt != null) {
      return { bookingId, quoteStatus: "unavailable" as const, availableIndexes: [], items: [], unavailableItems: [], reason: "This rental needs help from the team.", approvalRequired: true, paymentLinkAfterApprovalOnly: true, datesChanged: false };
    }
    let b: any;
    try { b = await ownedBooking(ctx, account, bookingId); }
    catch {
      return { bookingId, quoteStatus: "unavailable" as const, availableIndexes: [], items: [], unavailableItems: [], reason: "This rental could not be checked.", approvalRequired: true, paymentLinkAfterApprovalOnly: true, datesChanged: false };
    }
    const rentalListings: any[] = await Promise.all((b.lineItems ?? []).map((line: any) => ctx.db.get(line.listingId)));
    const originalItems = (b.lineItems ?? []).map((line: any, index: number) => {
      const listing: any = rentalListings[index];
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
    });
    const cardBase = {
      version: 1 as const,
      bookingId,
      availableIndexes: [] as number[],
      approvalRequired: true as const,
      paymentLinkAfterApprovalOnly: true as const,
      datesChanged: false as const,
    };
    const selection = requestText
      ? rentalExtensionItemSelection(requestText, originalItems)
      : { kind: "all" as const };
    if (selection.kind === "clarify") {
      return {
        ...cardBase,
        quoteStatus: "clarify" as const,
        items: [],
        unavailableItems: [],
        matchingTitles: selection.titles,
      };
    }
    const chosen = selection.kind === "selected" ? indexes(b, selection.lineIndexes) : indexes(b);
    const selectedOriginalItems = originalItems.filter((item: any) => chosen.includes(item.index));
    if (!Number.isFinite(extraDays)) {
      return {
        ...cardBase,
        quoteStatus: "duration_required" as const,
        items: selectedOriginalItems.map((item: any) => ({ ...item, availability: "unchecked" as const })),
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
        unavailableItems: selectedOriginalItems.map((item: any) => ({ ...item, reason, alternatives: [] })),
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
        unavailableItems: selectedOriginalItems.map((item: any) => ({ ...item, reason, alternatives: [] })),
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
        unavailableItems: selectedOriginalItems.map((item: any) => ({ ...item, reason, alternatives: [] })),
        reason,
      };
    }
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
      const selectionConflict = (quoted.selectionConflictItems ?? []).some((row: any) => row.lineIndex === unavailable.lineIndex);
      let alternatives: any[] = [];
      if ((stockBlocked || selectionConflict) && listing?.category) {
        const replacementIndexes = [...new Set([...(quoted.availableIndexes ?? []), unavailable.lineIndex])];
        const compatibilityContext = rentalListings.filter((_: any, index: number) => index !== unavailable.lineIndex);
        const compatibilityContextComplete = compatibilityContext.every((item: any) => !!item);
        let compatibilityEvidence: any[] = [];
        if (compatibilityContextComplete && compatibilityContext.length) {
          try { compatibilityEvidence = await verifiedKitEvidence(ctx); } catch { compatibilityEvidence = []; }
        }
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
          if (!compatibilityContextComplete) continue;
          if (compatibilityContext.length && !recommendationCompatible(candidate, compatibilityContext, compatibilityEvidence)) continue;
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
            _id: b._id,
            accountId: account._id,
            guestEmail: b.guestEmail ?? account.email,
            pickupTime: b.pickupTime ?? null,
            returnTime: b.returnTime ?? null,
            lineItems: replacementIndexes.map((index: number) => index === unavailable.lineIndex ? alternativeLine : b.lineItems[index]),
          };
          try {
            const combinedQuote = await quoteFor(ctx, alternativeRental, extraDays!, alternativeRental.lineItems.map((_: any, index: number) => index), account, undefined);
            const alternativeIndex = replacementIndexes.indexOf(unavailable.lineIndex);
            if (!combinedQuote.items.some((item: any) => item.lineIndex === alternativeIndex)) continue;
            const quote = await quoteFor(ctx, { ...alternativeRental, lineItems: [alternativeLine] }, extraDays!, [0], account, undefined);
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
  args: { token: v.string(), bookingId: v.id("bookings"), extraDays: v.number(), lineItemIndexes: v.optional(v.array(v.number())), requestedReturnTime: v.optional(v.string()), refreshKey: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { a, b } = await customer(ctx, args.token, args.bookingId);
    try {
      await mutableRental(ctx, b);
      const chosen = indexes(b, args.lineItemIndexes);
      return {...await quoteSelection(ctx, b, a, args.extraDays, chosen, args.requestedReturnTime),requestedReturnTime:args.requestedReturnTime,availableAccountCreditPence:await availableRentalCreditPence(ctx,a._id)};
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
        requestedReturnTime: args.requestedReturnTime,
        availableAccountCreditPence: 0,
      };
    }
  },
});

export const adminLatePreview = query({
  args: { token: v.string(), bookingId: v.id("bookings"), lineItemIndexes: v.optional(v.array(v.number())) },
  handler: async (ctx, { token, bookingId, lineItemIndexes }) => {
    if (!checkAdminToken(token)) throw Error("unauthorized");
    const booking = await ctx.db.get(bookingId);
    await mutableRental(ctx, booking);
    const selected = indexes(booking, lineItemIndexes);
    const lines = selected.map(index => booking!.lineItems[index]);
    const late = lateFeeQuote(lines, booking!.returnTime ?? null, Date.now());
    const needsReconciliation = !!booking!.lateFeeStatus || !!booking!.lateFeeIntentId || !!booking!.lateFeeChargingAt || (booking!.lateFeeAmount ?? 0) > 0 || (booking!.lateFeePaidFromHold ?? 0) > 0 || (booking!.lateFeePaidFromCard ?? 0) > 0;
    const oneDayRates = lines.map((line,index) => {
      const returnTime = line.returnTime === undefined ? booking!.returnTime : line.returnTime;
      const overdue = returnTime ? lateFeeQuote([line], booking!.returnTime ?? null, Date.now()).breakdown.length > 0 : false;
      const requiresManualRate = line.qty !== 1 || !Number.isFinite(line.dailyRate) || line.dailyRate! <= 0;
      return {lineIndex:selected[index],overdue,requiresManualRate,missingReturnTime:!returnTime,...(!requiresManualRate && overdue ? {amountPence:Math.round(line.dailyRate! * 100)} : {})};
    });
    const missingRates = oneDayRates.some(rate => rate.requiresManualRate || rate.missingReturnTime);
    return { selected, overdue: late.breakdown.length > 0, suggestedOneDayPence: oneDayRates.reduce((sum, item) => sum + (item.amountPence ?? 0), 0), oneDayRates, missingRates, needsReconciliation, paymentLinkAvailable: false as const };
  },
});

type AdminLateQuoteInput = { bookingId:Id<"bookings">; lineItemIndexes?:number[]; lateDays:number; targetEnd:number; requestedReturnTime:string; manualRates?:{lineIndex:number;dailyPence:number;confirmed:true}[]; customFee?:{description:string;amountPence:number} };

async function adminLateQuoteFor(ctx: any, args: AdminLateQuoteInput) {
      const booking = await ctx.db.get(args.bookingId);
      await mutableRental(ctx, booking);
      await assertFreshSharedStock(ctx);
      await assertComponentReplacementExtensionPricing(ctx, booking);
      if (booking!.lateFeeStatus || booking!.lateFeeIntentId || booking!.lateFeeChargingAt || (booking!.lateFeeAmount ?? 0) > 0 || (booking!.lateFeePaidFromHold ?? 0) > 0 || (booking!.lateFeePaidFromCard ?? 0) > 0) throw Error("An existing late charge needs reconciliation first.");
      if (!Number.isSafeInteger(args.lateDays) || args.lateDays < 1 || args.lateDays > 30 || !Number.isSafeInteger(args.targetEnd) || dateLabel(args.targetEnd) !== args.targetEnd || !isAllowedReturnTime(args.requestedReturnTime) || londonRentalInstant(args.targetEnd, args.requestedReturnTime) <= Date.now()) throw Error("Choose the late days and a future return date and time.");
      if (args.customFee && (args.customFee.description.trim().length < 3 || args.customFee.description.length > 120 || !Number.isSafeInteger(args.customFee.amountPence) || args.customFee.amountPence < 1 || args.customFee.amountPence > 100000000)) throw Error("Enter a description and a valid additional fee.");
      const chosen = indexes(booking, args.lineItemIndexes);
      const manualRates = args.manualRates ?? [];
      if (manualRates.length > chosen.length || new Set(manualRates.map(rate => rate.lineIndex)).size !== manualRates.length || manualRates.some(rate => !chosen.includes(rate.lineIndex) || rate.confirmed !== true || !Number.isSafeInteger(rate.dailyPence) || rate.dailyPence < 1 || rate.dailyPence > 100000000)) throw Error("Review the manual late rates.");
      const entries = await Promise.all(chosen.map(async index => {
        const line = booking!.lineItems[index], returnTime = line.returnTime === undefined ? booking!.returnTime : line.returnTime;
        if (!returnTime) throw Error("A selected item needs an agreed return time.");
        const requiresManualRate = line.qty !== 1 || !Number.isFinite(line.dailyRate) || line.dailyRate! <= 0;
        const manualRate = manualRates.find(rate => rate.lineIndex === index);
        if (requiresManualRate !== !!manualRate) throw Error(requiresManualRate ? "Confirm a manual one-day amount for the selected item." : "Manual rates are only needed when the saved rate is ambiguous.");
        const late = lateFeeQuote([line], booking!.returnTime ?? null, Date.now()).breakdown[0];
        if (!late || args.lateDays > late.days) throw Error("Late days cannot exceed the overdue period for any selected item.");
        const coveredEnd = dateLabel(line.end) + args.lateDays * DAY;
        if (londonRentalInstant(args.targetEnd, args.requestedReturnTime) <= londonRentalInstant(coveredEnd, returnTime)) throw Error("The new return must be after the covered late period.");
        const listing = await ctx.db.get(line.listingId);
        if (!listing?.active || !Number.isFinite(listing.pricing?.daily) || listing.pricing.daily <= 0) throw Error("A selected item needs a current extension price.");
        const days = rentalPricingDays(coveredEnd, args.targetEnd, returnTime, args.requestedReturnTime);
        if (days > 30) throw Error("Extensions are limited to 30 days.");
        const adjustment = line.physicalAllocation?.extensionAdjustmentPence?.[days - 1] ?? 0;
        const extensionPence = Math.round(pricingQuote(listing.pricing, days).total * 100) + adjustment;
        const previousAdjustment = line.physicalAllocation?.extensionAdjustmentPence?.[days - 2] ?? 0;
        const previousPence = Math.round(pricingQuote(listing.pricing, days - 1).total * 100) + previousAdjustment;
        const lateDailyPence = manualRate?.dailyPence ?? Math.round(late.dailyRate * 100);
        const latePence = lateDailyPence * args.lateDays;
        if (!Number.isSafeInteger(extensionPence) || extensionPence < 0 || days > 1 && previousPence < 0 || !Number.isSafeInteger(latePence) || latePence < 1) throw Error("The late or extension price needs review.");
        return { lineIndex: index, listingId: line.listingId, title: line.title, qty: line.qty, coveredEnd, coveredTime: returnTime, targetEnd: args.targetEnd, extensionDays: days, lateDailyPence, lateRateSource: manualRate ? "manual" as const : "booking" as const, latePence, extensionPence: extensionPence * line.qty, weekendSavingPence: weekendDays(coveredEnd, args.targetEnd) ? Math.max(0, extensionPence - previousPence) * line.qty : 0 };
      }));
      const account = booking!.accountId ? await ctx.db.get(booking!.accountId) : null;
      const benefit = bestBenefit(memberRentalBenefitCandidates({ account: await rentalBenefitAccount(ctx, account), subtotalPence: entries.reduce((sum, item) => sum + item.extensionPence, 0), weekendSavingPence: entries.reduce((sum, item) => sum + item.weekendSavingPence, 0) }));
      const discountPence = benefit.savingPence;
      const proposed = bookingStockLines<any>(booking!).map((line: any, index: number) => chosen.includes(index) ? { ...line, end: args.targetEnd, returnTime: args.requestedReturnTime } : line);
      await assertRenterExposure(ctx, booking, proposed, entries.map(item => ({ start: booking!.lineItems[item.lineIndex].end + DAY, end: item.targetEnd })));
      await assertRentalInventory(ctx, proposed, booking!._id);
      const latePence = entries.reduce((sum, item) => sum + item.latePence, 0), extensionPence = entries.reduce((sum, item) => sum + item.extensionPence, 0), customPence = args.customFee?.amountPence ?? 0;
      const totalPence = latePence + extensionPence - discountPence + customPence;
      if (![latePence,extensionPence,discountPence,totalPence].every(value => Number.isSafeInteger(value) && value >= 0)) throw Error("The quote amount needs review.");
      const quoteFingerprint = JSON.stringify({ base: baseLines(booking), chosen, lateDays: args.lateDays, targetEnd: args.targetEnd, requestedReturnTime: args.requestedReturnTime, manualRates, customFee: args.customFee ?? null, entries, latePence, extensionPence, discountPence, totalPence });
      return { available: true as const, entries, latePence, extensionPence, discountPence, customFee: args.customFee, totalPence, quoteFingerprint, paymentLinkAvailable: false as const };
}

export const adminLateQuote = query({
  args: { token: v.string(), bookingId: v.id("bookings"), lineItemIndexes: v.optional(v.array(v.number())), lateDays: v.number(), targetEnd: v.number(), requestedReturnTime: v.string(), manualRates: v.optional(v.array(v.object({ lineIndex:v.number(), dailyPence:v.number(), confirmed:v.literal(true) }))), customFee: v.optional(v.object({ description: v.string(), amountPence: v.number() })) },
  handler: async (ctx, args) => {
    if (!checkAdminToken(args.token)) throw Error("unauthorized");
    try {
      return await adminLateQuoteFor(ctx, args);
    } catch (error) {
      return { available: false as const, reason: error instanceof Error ? error.message : "The quote needs review.", paymentLinkAvailable: false as const };
    }
  },
});

export const createAdminLateOffer = internalMutation({
  args: { bookingId: v.id("bookings"), requestKey: v.string(), lineItemIndexes: v.optional(v.array(v.number())), lateDays: v.number(), targetEnd: v.number(), requestedReturnTime: v.string(), manualRates: v.optional(v.array(v.object({ lineIndex:v.number(), dailyPence:v.number(), confirmed:v.literal(true) }))), customFee: v.optional(v.object({ description:v.string(), amountPence:v.number() })), expectedFingerprint: v.string(), approvalReason: v.string() },
  handler: async (ctx, args) => {
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestKey) || args.approvalReason.trim().length < 5 || args.approvalReason.length > 500) throw Error("A valid request and approval reason are required.");
    const prior = await ctx.db.query("booking_change_requests").withIndex("by_booking_requestKey", q => q.eq("bookingId", args.bookingId).eq("requestKey", args.requestKey)).first();
    if (prior) {
      if (prior.adminLateTerms?.quoteFingerprint !== args.expectedFingerprint || prior.approvalReason !== args.approvalReason.trim()) throw Error("Request contents changed.");
      return { requestId: prior._id };
    }
    const quote = await adminLateQuoteFor(ctx, args);
    if (quote.quoteFingerprint !== args.expectedFingerprint) throw Error("The quote changed. Review it before sending.");
    if (quote.totalPence < 1) throw Error("The late extension needs a positive total.");
    const booking = await ctx.db.get(args.bookingId);
    if (!booking?.accountId || !await ctx.db.get(booking.accountId)) throw Error("An associated renter account is required for this offer.");
    const [extensions, other] = await Promise.all([
      ctx.db.query("booking_change_requests").withIndex("by_booking", q => q.eq("bookingId", booking._id)).order("desc").take(RENTAL_REQUEST_HISTORY_LIMIT + 1),
      ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", booking._id)).order("desc").take(RENTAL_REQUEST_HISTORY_LIMIT + 1),
    ]);
    const summary = summarizeBookingChangeRequests(other, extensions);
    if (!summary.ready || summary.any) throw Error("Resolve the existing rental change before creating another offer.");
    const discounted = allocateSaving(quote.entries.map(entry => entry.extensionPence / 100), quote.discountPence / 100);
    const quoteItems = quote.entries.map((entry, index) => ({ lineIndex:entry.lineIndex, listingId:entry.listingId, title:entry.title, start:booking.lineItems[entry.lineIndex].end + DAY, end:entry.targetEnd, qty:entry.qty, dailyRate:entry.extensionPence / entry.extensionDays / 100, lineTotal:discounted[index] }));
    const adminLateTerms = { lateDays:args.lateDays, targetEnd:args.targetEnd, requestedReturnTime:args.requestedReturnTime, manualRates:args.manualRates ?? [], ...(args.customFee ? {customFee:args.customFee} : {}), entries:quote.entries, latePence:quote.latePence, extensionPence:quote.extensionPence, discountPence:quote.discountPence, totalPence:quote.totalPence, quoteFingerprint:quote.quoteFingerprint };
    const createdAt = Date.now();
    const request = { bookingId:booking._id, accountId:booking.accountId, type:"extend" as const, requestKey:args.requestKey, lineItemIndexes:quote.entries.map(entry => entry.lineIndex), extraDays:args.lateDays, requestedReturnTime:args.requestedReturnTime, approvedReturnTime:args.requestedReturnTime, baseLines:baseLines(booking), quoteItems, adminLateTerms, priceDelta:quote.totalPence / 100, cardDuePence:quote.totalPence, approvalReason:args.approvalReason.trim(), status:"pending" as const, createdAt, expiresAt:createdAt + DAY };
    adminLateBillingLines(booking, request);
    const requestId = await ctx.db.insert("booking_change_requests", request);
    return { requestId };
  },
});

export const acceptAdminLateOffer = mutation({
  args: { token:v.string(), requestId:v.id("booking_change_requests"), expectedFingerprint:v.string(), accepted:v.literal(true) },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request?.adminLateTerms || request.type !== "extend") throw Error("This offer is unavailable.");
    const { a, b } = await customer(ctx, args.token, request.bookingId);
    if (a._id !== request.accountId || request.status !== "pending" || (request.expiresAt ?? 0) <= Date.now() || args.expectedFingerprint !== request.adminLateTerms.quoteFingerprint) throw Error("This offer has expired or changed.");
    if (request.adminLateAcceptedAt) {
      if (request.adminLateAcceptedFingerprint !== args.expectedFingerprint) throw Error("This offer has changed.");
      return { ok:true };
    }
    const terms = request.adminLateTerms;
    const current = await adminLateQuoteFor(ctx, { bookingId:request.bookingId, lineItemIndexes:request.lineItemIndexes, lateDays:terms.lateDays, targetEnd:terms.targetEnd, requestedReturnTime:terms.requestedReturnTime, manualRates:terms.manualRates, customFee:terms.customFee });
    if (current.quoteFingerprint !== terms.quoteFingerprint) throw Error("The offer changed. Ask the team for a new one.");
    adminLateBillingLines(b, request);
    await ctx.db.patch(request._id, { adminLateAcceptedAt:Date.now(), adminLateAcceptedFingerprint:terms.quoteFingerprint });
    return { ok:true };
  },
});

export const request = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), requestKey: v.string(), extraDays: v.number(), lineItemIndexes: v.optional(v.array(v.number())), expectedAmount: v.number(), expectedBase: v.string(), requestedReturnTime: v.string(),useAccountCredit:v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { a, b } = await customer(ctx, args.token, args.bookingId);
    if (!isAllowedReturnTime(args.requestedReturnTime)) throw Error(`Choose a return time within ${HOURS_LABEL} (London time).`);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestKey)) throw Error("Invalid request.");
    const prior = await ctx.db.query("booking_change_requests")
      .withIndex("by_booking_requestKey", q => q.eq("bookingId", b._id).eq("requestKey", args.requestKey))
      .first();
    const chosen = indexes(b, args.lineItemIndexes);
    if (prior) {
      if (prior.requestedReturnTime !== args.requestedReturnTime || prior.accountId !== a._id || prior.extraDays !== args.extraDays || JSON.stringify(prior.lineItemIndexes) !== JSON.stringify(chosen) || prior.baseLines !== args.expectedBase || prior.priceDelta !== args.expectedAmount || !!prior.useAccountCredit !== !!args.useAccountCredit) throw Error("Request contents changed.");
      return { ok: true, requestId: prior._id };
    }
    await mutableRental(ctx, b);
    const [extensionRows, renterRows] = await Promise.all([
      ctx.db.query("booking_change_requests").withIndex("by_booking", q => q.eq("bookingId", b._id)).order("desc").take(RENTAL_REQUEST_HISTORY_LIMIT + 1),
      ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", b._id)).order("desc").take(RENTAL_REQUEST_HISTORY_LIMIT + 1),
    ]);
    const requestSummary = summarizeBookingChangeRequests(renterRows, extensionRows);
    if (!requestSummary.ready) throw Error("This rental has a long request history. Ask the team to review the earlier requests before requesting another change.");
    if (requestSummary.any) throw Error("You already have an open change request for this rental.");
    const q = await quoteFor(ctx, b, args.extraDays, chosen, a, args.requestedReturnTime);
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
    const requestedAt = Date.now();
    const creditExpiresAt = requestedAt + 25 * 3600000;
    const requestId = await ctx.db.insert("booking_change_requests", { bookingId: b._id, accountId: a._id, type: "extend", requestedReturnTime: args.requestedReturnTime, requestKey: args.requestKey, lineItemIndexes: chosen, extraDays: args.extraDays, baseLines: baseLines(b), quoteItems: q.items, priceDelta: q.priceDelta, benefitKind: q.benefitKind, benefitLabel: q.benefitLabel, benefitSaving: q.benefitSaving, status: "pending", ...(args.useAccountCredit&&q.priceDelta>0?{useAccountCredit:true,expiresAt:creditExpiresAt}:{}),createdAt: requestedAt });
    if(args.useAccountCredit&&q.priceDelta>0){
      const credit=await reserveRentalCredit(ctx,{accountId:a._id,bookingId:b._id,operationType:"extension",operationId:String(requestId),requestedPence:Math.round(q.priceDelta*100),expiresAt:creditExpiresAt});
      if(!credit)throw Error("No account credit is currently available.");
      await ctx.db.patch(requestId,{creditReservationId:credit._id,creditAppliedPence:credit.amountPence,cardDuePence:Math.max(0,Math.round(q.priceDelta*100)-credit.amountPence)});
    }else await ctx.db.patch(requestId,{cardDuePence:Math.round(q.priceDelta*100)});
    const thread = await rentalThread(ctx, a._id, b._id);
    const escalationAt=Date.now();
    if (thread) await ctx.db.patch(thread._id, { escalated: true, ...(!thread.escalated?{escalatedAt:escalationAt,lastHumanActivityAt:undefined,tgMessageId:undefined}:{}) });
    else await ctx.db.insert("chat_threads", { accountId: a._id, bookingId: b._id, escalated: true, escalatedAt:escalationAt, updatedAt: escalationAt, unreadOwner: 0, unreadRenter: 0 });
    await scheduleGafferAutoResume(ctx,a._id,b._id);
    await postRentalMessage(ctx, { accountId: a._id, bookingId: b._id, sender: "renter", text: `Extension request · awaiting team approval. Original return times stay in place until approval${q.priceDelta > 0 ? " and payment" : ""}.`, meta: { kind: "extension_request", requestId, amount: q.priceDelta, extraDays: args.extraDays, returnTime: args.requestedReturnTime, benefitSaving: q.benefitSaving, benefitLabel: q.benefitLabel, items: chatItems } });
    await ctx.scheduler.runAfter(0, internal.notify.renterChat, { email: a.email, bookingId: b._id, text: "Rental extension requested — owner approval required." });
    return { ok: true, requestId };
  },
});

export const state = query({
  args: { token: v.string(), bookingId: v.id("bookings"), admin: v.optional(v.boolean()) },
  handler: async (ctx, { token, bookingId, admin }) => {
    let renterAccountId: any;
    if (admin) { if (!checkAdminToken(token)) return null; }
    else renterAccountId = (await customer(ctx, token, bookingId)).a._id;
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const rows = await ctx.db.query("booking_change_requests").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc").take(20);
    const items = await Promise.all(b.lineItems.map(async (li, i) => {
      const listing = await ctx.db.get(li.listingId);
      return { index: i, listingId: li.listingId, slug: listing?.slug ?? null, title: li.title, qty: li.qty, start: li.start, end: li.end, returnTime: li.returnTime === undefined ? b.returnTime ?? null : li.returnTime, imageSources: listingRentalImages(listing) };
    }));
    return { status: b.status, actionReady: renterRentalActionReady(b), locked: !!(b.activeAdditionId || b.activeDeliveryQuoteId || b.activeExtensionId || b.activePriceAdjustmentId || b.activeItemSwapId || b.returnDecision || b.cancellationDecision), pickupTime: b.pickupTime ?? null, returnTime: b.returnTime ?? null, items, requests: rows.filter(r => r.type === "extend" && (admin || r.accountId === renterAccountId)).map(r => ({ id: r._id, status: r.status, items: r.quoteItems ?? [], amount: r.priceDelta ?? null,creditAppliedPence:r.creditAppliedPence??0,cardDuePence:r.cardDuePence??Math.round((r.priceDelta??0)*100), useAccountCredit:!!r.useAccountCredit, benefitKind: r.benefitKind, benefitLabel: r.benefitLabel, benefitSaving: r.benefitSaving ?? 0, days: r.extraDays, requestedReturnTime: r.requestedReturnTime, approvedReturnTime: r.approvedReturnTime, url: r.status === "awaiting_payment" ? r.paymentLinkUrl : undefined, expiresAt: r.expiresAt, reason: r.approvalReason, createdAt: r.createdAt })), paymentsEnabled: process.env.RENTAL_CHECKOUT_ENABLED === "true" || /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "") };
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
    if (r.adminLateTerms) throw Error("Late-extension payments are not enabled yet.");
    if (["approved", "awaiting_payment", "applied"].includes(r.status)) return r;
    if (r.status !== "pending") throw Error("This request is closed.");
    if (r.creditReservationId && (r.expiresAt ?? 0) <= Date.now()) {
      const now = Date.now();
      await expirePendingCreditRequest(ctx, r._id, now);
      return { ...r, status: "expired", resolvedAt: now };
    }
    const returnTime = approvedReturnTime ?? r.requestedReturnTime;
    if (!returnTime || !isAllowedReturnTime(returnTime)) throw Error(`Choose a return time within ${HOURS_LABEL} (London time).`);
    if (reason.trim().length < 5 || reason.length > 500) throw Error("Record an approval reason.");
    const b = await ctx.db.get(r.bookingId);
    await mutableRental(ctx, b);
    if (b?.depositHoldAmount && ((b.depositHoldExpiresAt ?? 0) <= Date.now() + 25 * 3600000 || ["starting", "requires_action", "failed"].includes(b.depositHoldRenewalStatus ?? ""))) throw Error("Renew or resolve the existing security hold before approving an extension.");
    if (!r.baseLines || r.baseLines !== baseLines(b)) throw Error("The rental changed. Decline this request and ask for a new quote.");
    const account = await ctx.db.get(r.accountId);
    const q = await quoteFor(ctx, b, r.extraDays!, r.lineItemIndexes, account, returnTime);
    if (q.benefitKind !== (r.benefitKind ?? "none") || q.benefitSaving !== (r.benefitSaving ?? 0)) throw Error("The member benefit changed. Decline this request and ask the renter to review a fresh quote.");
    if (q.priceDelta !== r.priceDelta || quoteIdentity(q.items) !== quoteIdentity(r.quoteItems ?? [])) throw Error("The price changed because the listing price or extension quote changed. Decline this request and ask the renter to review a fresh quote.");
    const proposed=bookingStockLines(b!).map((li,index)=>q.items.some(item=>item.lineIndex===index)?{...li,end:q.items.find(item=>item.lineIndex===index)!.end,returnTime}:li);
    await assertRentalInventory(ctx,proposed,b!._id);
    const expiresAt = Date.now() + DAY;
    if (r.creditReservationId) {
      const reservation = await reservationForOperation(ctx, "extension", String(r._id));
      if (!reservation || reservation._id !== r.creditReservationId || reservation.accountId !== r.accountId || reservation.bookingId !== r.bookingId || reservation.amountPence !== r.creditAppliedPence || reservation.state !== "reserved")
        throw Error("The extension account-credit reservation no longer matches its pending request.");
      await ctx.db.patch(reservation._id, { expiresAt, updatedAt: Date.now() });
    }
    for (const item of q.items) {
      const original=bookingStockLines(b!)[item.lineIndex],extended=proposed[item.lineIndex];
      // Reserve continuously from the previous agreed return, including the
      // remainder of that day, through the newly approved return clock.
      const start=stockWindow(original,true).end,end=stockWindow(extended,true).end;
      const listing = await ctx.db.get(item.listingId as Id<"listings">);
      const components = await storedBookingComponents(ctx, original, b!._id) ?? listing!.components;
      for (const comp of components) await ctx.db.insert("reservations", { bookingId: b!._id, extensionRequestId: requestId, listingId: item.listingId, inventoryUnitId: comp.inventoryUnitId, qty: comp.qty * item.qty, start,end,endExclusive:true,turnaroundBufferMinutes:60, source: "site", status: "hold", holdExpiresAt: expiresAt });
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
    const late = r.adminLateTerms;
    if (late) adminLateBillingLines(await ctx.db.get(r.bookingId), r);
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
    await postRentalMessage(ctx, { accountId: r.accountId, bookingId: r.bookingId, sender: "system", text: `Extension approved · ${r.creditAppliedPence?`£${(r.creditAppliedPence/100).toFixed(2)} account credit used; `:""}£${((r.cardDuePence??Math.round((r.priceDelta??0)*100))/100).toFixed(2)} to pay. Your original return times stay in place until payment succeeds. Link expires in 24 hours.`, meta: { kind: "extension_payment", requestId, url, amount: (r.cardDuePence??Math.round((r.priceDelta??0)*100))/100, grossAmount:r.priceDelta,creditAppliedPence:r.creditAppliedPence??0, extraDays: r.extraDays, returnTime: r.approvedReturnTime, benefitSaving: r.benefitSaving ?? 0, benefitLabel: r.benefitLabel, items: chatItems, ...(late ? {lateBreakdown:{latePence:late.latePence,extensionPence:late.extensionPence,discountPence:late.discountPence,...(late.customFee ? {customFee:late.customFee} : {})}} : {}) } });
  },
});

export const decline = mutation({
  args: { token: v.string(), requestId: v.id("booking_change_requests"), reason: v.string() },
  handler: async (ctx, { token, requestId, reason }) => {
    await assertAdmin(ctx, token, "rentalExtensions.decline");
    const r = await ctx.db.get(requestId);
    if (!r || r.status !== "pending") throw Error("Only an unapproved request can be declined.");
    if (reason.trim().length < 5 || reason.length > 500) throw Error("Record a reason for declining.");
    await releaseRentalCredit(ctx,"extension",String(r._id));
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
    await releaseRentalCredit(ctx,"extension",String(r._id));
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
    const creditAppliedPence=r.creditAppliedPence??0;
    const cardDuePence=r.cardDuePence??Math.round((r.priceDelta??0)*100);
    if(cardDuePence!==Math.max(0,Math.round((r.priceDelta??0)*100)-creditAppliedPence))throw Error("The saved extension credit allocation is invalid.");
    if (approvedZero) {
      if (amountPence !== 0 || cardDuePence !== 0 || r.stripePaymentLinkId) {
        throw Error("Only an approved zero-balance extension can settle without Stripe.");
      }
    } else if (!sessionId || !paymentIntentId || r.stripePaymentLinkId !== sessionId || cardDuePence !== amountPence) {
      throw Error("Extension payment does not match its approved quote.");
    }
    if (r.status === "applied") {
      if (approvedZero ? !["approved_zero","account_credit"].includes(r.settlementKind ?? "") : r.paymentIntentId !== paymentIntentId) {
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
    const lateCharges = r.adminLateTerms ? adminLateBillingLines(b, r) : null;
    await assertFreshSharedStock(ctx);
    try { await mutableRental(ctx, b, requestId); }
    catch { return { ok: false, closed: true, bookingId: r.bookingId }; }
    if (approvedZero) {
      const account = await ctx.db.get(r.accountId);
      const currentQuote = await quoteFor(ctx, b, r.extraDays!, r.lineItemIndexes, account, r.approvedReturnTime);
      if (currentQuote.priceDelta !== r.priceDelta || cardDuePence !== 0
        || currentQuote.benefitKind !== (r.benefitKind ?? "none")
        || currentQuote.benefitSaving !== (r.benefitSaving ?? 0)
        || quoteIdentity(currentQuote.items) !== quoteIdentity(r.quoteItems)) {
        throw Error("The zero-balance extension quote changed. Review the request again before applying it.");
      }
    }
    const byIndex = new Map(r.quoteItems.map(i => [i.lineIndex, i]));
    const lines = bookingStockLines(b).map((li, i) => byIndex.has(i) ? { ...li, end: byIndex.get(i)!.end, returnTime: r.approvedReturnTime } : { ...li, returnTime: li.returnTime === undefined ? b.returnTime ?? null : li.returnTime });
    // External reservations or calendar blocks may have changed while approval was being recorded.
    const extensionWindows = r.quoteItems.map((item: any) => ({ start: item.start, end: item.end }));
    try { await assertRenterExposure(ctx, b, lines, extensionWindows); await assertRentalInventory(ctx, lines, b._id); }
    catch { return { ok: false, closed: true, bookingId: r.bookingId }; }
    if (r.creditAppliedPence) {
      const reservation = await reservationForOperation(ctx, "extension", String(r._id));
      if (!reservation || reservation.accountId !== r.accountId || reservation.bookingId !== r.bookingId || reservation.amountPence !== r.creditAppliedPence || !["reserved", "consumed"].includes(reservation.state))
        throw Error("The extension account-credit reservation no longer matches its approved quote.");
    }
    await consumeRentalCredit(ctx,"extension",String(r._id));
    const reservations = await ctx.db.query("reservations").withIndex("by_booking", q => q.eq("bookingId", b._id)).collect();
    for (const res of reservations) if (["confirmed", "active", "hold"].includes(res.status)) await ctx.db.patch(res._id, { status: "cancelled" });
    for (const li of lines) {
      const listing = await ctx.db.get(li.listingId);
      const components = await storedBookingComponents(ctx, li, b._id) ?? listing!.components;
      for (const comp of components) await ctx.db.insert("reservations", { bookingId: b._id, listingId: li.listingId, inventoryUnitId: comp.inventoryUnitId, ...stockWindow(li, true), qty: comp.qty * li.qty, source: "site", status: b.status === "active" ? "active" : "confirmed" });
    }
    const charges = lateCharges ?? r.quoteItems.map(i => ({ requestId, returnTime: r.approvedReturnTime, title: `${i.title} · approved extension`, start: i.start, end: i.end, qty: i.qty, lineTotal: i.lineTotal }));
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
        ? { settlementKind: creditAppliedPence>0?"account_credit":"approved_zero", settledAt: now }
        : { settlementKind: "stripe", paymentIntentId, cardPaidPence:amountPence, paidAt: now, settledAt: now }),
      resolvedAt: now,
    });
    const settlementText = approvedZero
      ? creditAppliedPence ? `Extension confirmed · £${(creditAppliedPence / 100).toFixed(2)} account credit used; no card payment due.` : "Extension confirmed · no additional payment due."
      : `Extension confirmed · £${r.priceDelta!.toFixed(2)} total; £${(creditAppliedPence / 100).toFixed(2)} account credit${creditAppliedPence ? " used" : ""}; £${(amountPence / 100).toFixed(2)} paid by card.`;
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

export const expirePendingCreditRequests = internalMutation({
  args: {},
  handler: async ctx => {
    const now = Date.now();
    const expired = await ctx.db.query("booking_change_requests")
      .withIndex("by_status_expiry", q => q.eq("status", "pending").lte("expiresAt", now))
      .order("asc")
      .take(100);
    let count = 0;
    for (const request of expired) if (await expirePendingCreditRequest(ctx, request._id, now)) count++;
    return { expired: count, checked: expired.length };
  },
});
