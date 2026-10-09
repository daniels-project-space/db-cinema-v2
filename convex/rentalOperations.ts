import {assertDateSelection} from "./lib/rentalDateSelection";
import {rescheduledLines} from "../shared/rentalReschedule";
import {stockWindow} from "./lib/stockWindows";
import {schedulePickupHold} from "./pickupSecurity";
import {bookingStockLines,rentalWindow} from "../shared/rentalWindow";
import { assertRentalAllocation } from "./lib/rentalAllocation";
import { accountForRental } from "./lib/rentalAccount";
import { listingImages } from "./lib/catalogImages";
import { requiresDroneLicence, droneLicenceStatusForRental } from "./lib/droneVerification";
import { assertVerificationArchive } from "./verificationArchive";
import { rentalPaymentSources } from "./lib/rentalPaymentSources";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { assertRenterExposure } from "./lib/rentalExposure";
import { assertRentalInventory } from "./lib/rentalInventory";
import { postRentalMessage } from "./lib/rentalChat";
import { rentalCancellationStart, bookingCancelKind, londonStartOfDay } from "../src/lib/cancellationPolicy";
import { approvedRequest, finishRequest, rescheduleRequestKey } from "./lib/rentalRequestExecution";

/** Minimal server-only address lookup: a linked rental never falls back to a reused mailbox. */
export const changeRecipient = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) return null;
    const account = await accountForRental(ctx, booking);
    const email = booking.accountId ? account?.email : account?.email ?? booking.guestEmail;
    return email ? { email, bookingId } : null;
  },
});

export const details = query({
  args: { token: v.string(), bookingId: v.id("bookings"), refreshKey: v.optional(v.number()) },
  handler: async (ctx, { token, bookingId }) => {
    if (!checkAdminToken(token)) return null;
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    let verificationArchiveReady = false;
    if (b.idVerifyStatus === "verified") { try { await assertVerificationArchive(ctx, b); verificationArchiveReady = true; } catch {} }
    const refunds = await ctx.db
      .query("rental_refunds")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    const account = await accountForRental(ctx, b);
    return {
      ...b,
      customer: account ? { name: account.name ?? null, email: account.email, phone: account.phone ?? null } : null,
      requiresDroneLicence: await requiresDroneLicence(ctx, b),
      droneLicenceStatus: await droneLicenceStatusForRental(ctx, b),
      verificationArchiveReady,
      lineItems: await Promise.all(bookingStockLines(b).map(async (line) => {
        const listing = await ctx.db.get(line.listingId);
        const imageSources = listingImages(listing);
        return { ...line, heroImage: imageSources[0] ?? null, imageSources };
      })),
      rentalRefunds: refunds,
      cancellationKind: bookingCancelKind(b, Date.now()),
    };
  },
});
/** Availability preview uses the same exact-time stock checks as the final date update. */
export const reschedulePreview = query({
 args:{token:v.string(),bookingId:v.id("bookings"),start:v.number(),end:v.optional(v.number()),pickupTime:v.optional(v.string()),returnTime:v.optional(v.string()),changeRequestId:v.optional(v.id("rental_change_requests")),refreshKey:v.optional(v.number())},
 handler:async(ctx,{token,bookingId,start,end,pickupTime,returnTime,changeRequestId})=>{
  if(!checkAdminToken(token))return null;
  const b=await ctx.db.get(bookingId);
  try{
   if(!b||b.status!=="confirmed")throw Error("Only an upcoming rental can be rescheduled.");
   if(b.cancellationDecision||b.activeAdditionId||b.activeExtensionId||b.returnDecision)throw Error("Finish the open rental operation first.");
   if(!Number.isSafeInteger(start)||start%86400000!==0||start<londonStartOfDay(Date.now()))throw Error("Choose a future start date.");
   if(end!==undefined&&(!Number.isSafeInteger(end)||end%86400000!==0||end<start))throw Error("Choose a valid return date.");
   const refunds=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
   if(refunds.some(r=>["prepared","pending"].includes(r.status)))throw Error("Wait for the open refund to settle first.");
   const reservations=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).collect();
   if(reservations.some(r=>r.source!=="site"||r.status==="hold"))throw Error("Resolve stock holds or manage this rental through its original platform.");
   await assertRentalAllocation(ctx,b,reservations);
   const request=await approvedRequest(ctx,b,changeRequestId,"reschedule","reschedule-preview");
   assertDateSelection(request?.dateSelection,b,start,end,pickupTime,returnTime);
   const {lines}=rescheduledLines(b,start,end,pickupTime,returnTime);
   await assertRenterExposure(ctx,b,lines);await assertRentalInventory(ctx,lines,bookingId);
   return {available:true,reason:null};
  }catch(e:any){return {available:false,reason:e.message??"Unable to check these dates."};}
 }
});
export const reschedule = mutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    start: v.number(),
    end: v.optional(v.number()),
    keepAgreedPrice: v.optional(v.boolean()),
    pickupTime:v.optional(v.string()),returnTime:v.optional(v.string()),
    reason: v.string(),
    changeRequestId: v.optional(v.id("rental_change_requests")),
  },
  handler: async (ctx, { token, bookingId, start, end, pickupTime, returnTime, keepAgreedPrice, reason, changeRequestId }) => {
    await assertAdmin(ctx, token, "rentalOperations.reschedule");
    const b = await ctx.db.get(bookingId);
    const operationKey = rescheduleRequestKey(start, end, keepAgreedPrice, reason, pickupTime, returnTime);
    const request = await approvedRequest(ctx, b, changeRequestId, "reschedule", operationKey);
    if (request?.execution?.status === "applied") return { ok: true };
    if(b)assertDateSelection(request?.dateSelection,b,start,end,pickupTime,returnTime);
    if (!b || b.status !== "confirmed")
      throw Error("Only an upcoming rental can be rescheduled");
    if (b.cancellationDecision || (b.activeAdditionId || b.activeExtensionId) || b.returnDecision)
      throw Error("Finish the open cancellation, item addition or approved extension first");
    const refunds = await ctx.db.query("rental_refunds").withIndex("by_booking", q => q.eq("bookingId", bookingId)).collect();
    if (refunds.some(r => ["prepared", "pending"].includes(r.status))) throw Error("Wait for the open refund to settle first.");
    if (reason.trim().length < 5)
      throw Error("Record the reason for the change");
    if (
      !Number.isSafeInteger(start) ||
      start % 86400000 !== 0 ||
      start < londonStartOfDay(Date.now())
    )
      throw Error("Choose a future start date");
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    if (reservations.some((r) => r.source !== "site"))
      throw Error("Manage this rental through its original booking platform");
    if (reservations.some(r => r.status === "hold")) throw Error("Resolve the open stock hold before changing this rental.");
    const allocationMode=await assertRentalAllocation(ctx, b, reservations);
    if (end !== undefined && (!Number.isSafeInteger(end) || end % 86400000 !== 0 || end < start)) throw Error("Choose a valid return date on or after the start.");
    const {lines,endShift}=rescheduledLines(b,start,end,pickupTime,returnTime);
    if (endShift !== 0 && keepAgreedPrice !== true) throw Error("Confirm that the changed duration keeps the agreed charges; extra days are complimentary.");
    await assertRenterExposure(ctx, b, lines);
    await assertRentalInventory(ctx, lines, bookingId);
    const clockPatch={...(pickupTime!==undefined?{pickupTime}:{}),...(returnTime!==undefined?{returnTime}:{})};
    await schedulePickupHold(ctx,{...b,...clockPatch,lineItems:lines});
    await ctx.db.patch(bookingId, { lineItems: lines, ...clockPatch, cancellationPolicyStart: start });
    for (const r of reservations) if (["confirmed","hold"].includes(r.status)) await ctx.db.patch(r._id,{status:"cancelled"});
    for(const li of lines){
      const listing=await ctx.db.get(li.listingId);
      const clockChange=pickupTime!==undefined||returnTime!==undefined;
      const window=allocationMode==="legacy"&&!clockChange?{start:li.start,end:li.end}:stockWindow(li,clockChange||allocationMode==="precise");
      for(const comp of listing!.components)await ctx.db.insert("reservations",{inventoryUnitId:comp.inventoryUnitId,listingId:li.listingId,bookingId,...window,qty:comp.qty*li.qty,source:"site",status:"confirmed"});
    }
    const a = await accountForRental(ctx, b);
    const detail = `${new Date(start).toISOString().slice(0, 10)} → ${new Date(Math.max(...lines.map((li) => li.end))).toISOString().slice(0, 10)}${pickupTime!==undefined?` · Collection ${pickupTime} London time`:""}${returnTime!==undefined?` · Return ${returnTime} London time`:""}`;
    if (a)
      await postRentalMessage(ctx, {
        accountId: a._id,
        bookingId,
        sender: "system",
        text: `The team rescheduled your rental to ${detail}. Agreed charges and security are unchanged${endShift > 0 ? "; the additional days have no extra rental charge" : ""}. Any eligible refund is recorded separately. ${reason.trim()}`,
        ...(changeRequestId ? { meta: { type: "rental_change_applied", changeRequestId } } : {}),
      });
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId,
      kind: "rescheduled",
      detail,
    });
    await queueRmv2Sync(ctx, bookingId);
    await finishRequest(ctx, b, changeRequestId, "reschedule", operationKey, `Rental dates updated to ${detail}. Agreed charges are unchanged; any eligible refund is recorded separately.`);
    return { ok: true };
  },
});

/** Amend fulfilment, preserving captured charges and a permanent invoice audit trail.
 * Refunds use the existing provider-backed refund control; security settles separately. */
export const removeItem = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), requestId: v.string(),
    changeRequestId:v.optional(v.id("rental_change_requests")),removeQty:v.optional(v.number()),keepAgreedCharges:v.optional(v.boolean()),
    lineIndex: v.number(), listingId: v.id("listings"), expectedQty: v.number(), expectedStart: v.number(), expectedEnd: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.token, "rentalOperations.removeItem");
    const b = await ctx.db.get(args.bookingId);
    if (!b) throw Error("Rental unavailable.");
    const removeQty=args.removeQty??args.expectedQty;
    if((args.changeRequestId||args.removeQty!==undefined)&&args.keepAgreedCharges!==true)throw Error("Confirm that agreed charges and security remain unchanged; any eligible refund is recorded separately.");
    if(!Number.isSafeInteger(removeQty)||removeQty<1||removeQty>args.expectedQty)throw Error("Choose a valid quantity to remove.");
    const operationKey=JSON.stringify(["kit_removal",args.requestId,args.lineIndex,args.listingId,args.expectedQty,args.expectedStart,args.expectedEnd,removeQty,args.reason.trim()]);
    const request=await approvedRequest(ctx,b,args.changeRequestId,"kit_removal",operationKey);
    const selection=request?.kitSelection;
    if(selection&&(selection.lineIndex!==args.lineIndex||selection.quantity!==removeQty||selection.source?.listingId!==args.listingId||selection.source?.qty!==args.expectedQty||selection.source?.start!==args.expectedStart||selection.source?.end!==args.expectedEnd))throw Error("The removal does not match the approved item, quantity and dates.");
    const prior = b.removedItems?.find(l => l.requestId === args.requestId);
    if (prior) {
      if (prior.listingId !== args.listingId || (prior.sourceQty??prior.qty) !== args.expectedQty || prior.qty!==removeQty || prior.start !== args.expectedStart || prior.end !== args.expectedEnd || prior.reason !== args.reason.trim()||prior.changeRequestId!==args.changeRequestId) throw Error("Removal request has changed.");
      await finishRequest(ctx,b,args.changeRequestId,"kit_removal",operationKey,`${prior.qty}× ${prior.title} removed from the kit. Agreed charges and security are unchanged; any eligible refund is recorded separately.`);
      return { ok: true };
    }
    if(request?.execution)throw Error("The saved removal receipt needs review before another update.");
    if (b.status !== "confirmed") throw Error("Only an unstarted confirmed rental can have kit removed.");
    if (b.cancellationDecision || (b.activeAdditionId || b.activeExtensionId) || b.returnDecision) throw Error("Finish the open rental operation first.");
    const refunds = await ctx.db.query("rental_refunds").withIndex("by_booking", q => q.eq("bookingId", b._id)).collect();
    if (refunds.some(r => ["prepared", "pending"].includes(r.status))) throw Error("Wait for the open refund to settle first.");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId) || args.reason.trim().length < 5 || args.reason.trim().length > 400) throw Error("Record a valid removal request and reason.");
    if (!Number.isSafeInteger(args.lineIndex) || args.lineIndex < 0) throw Error("Invalid item.");
    const line = b.lineItems[args.lineIndex];
    if (!line || line.listingId !== args.listingId || line.qty !== args.expectedQty || line.start !== args.expectedStart || line.end !== args.expectedEnd) throw Error("The kit changed. Refresh and choose the item again.");
    if (b.lineItems.length < 2&&removeQty===line.qty) throw Error("Use Cancel rental to remove the last item.");
    const reservations = await ctx.db.query("reservations").withIndex("by_booking", q => q.eq("bookingId", b._id)).collect();
    if (reservations.some(r => r.source !== "site" || r.status === "active")) throw Error("Manage external or already collected kit through its original rental flow.");
    if (reservations.some(r => r.status === "hold")) throw Error("Resolve the open stock hold before changing this rental.");
    await assertRentalAllocation(ctx, b, reservations);
    const removedTotal=Math.round(line.lineTotal*100*removeQty/line.qty)/100;
    const lines = bookingStockLines(b).flatMap((item, i) => i!==args.lineIndex?[item]:removeQty===item.qty?[]:[{...item,qty:item.qty-removeQty,lineTotal:Math.round((item.lineTotal-removedTotal)*100)/100,...(item.dailyRate===undefined?{}:{dailyRate:item.dailyRate*(item.qty-removeQty)/item.qty})}]);
    await assertRentalInventory(ctx, lines, b._id);
    for (const r of reservations) if (["hold", "confirmed"].includes(r.status)) await ctx.db.patch(r._id, { status: "cancelled" });
    for (const remaining of lines) {
      const listing = await ctx.db.get(remaining.listingId);
      for (const component of listing!.components) await ctx.db.insert("reservations", { bookingId: b._id, listingId: remaining.listingId, inventoryUnitId: component.inventoryUnitId, ...stockWindow(remaining,true), qty: component.qty * remaining.qty, source: "site", status: "confirmed" });
    }
    const { dailyRate: _, ...removed } = line;
    await ctx.db.patch(b._id, { lineItems: lines, cancellationPolicyStart: rentalCancellationStart(b), removedItems: [...(b.removedItems ?? []), { ...removed,qty:removeQty,lineTotal:removedTotal,sourceQty:line.qty,changeRequestId:args.changeRequestId, removedAt: Date.now(), reason: args.reason.trim(), requestId: args.requestId }] });
    const account = await accountForRental(ctx, b);
    const detail = `${removeQty}× ${line.title} removed from your kit. Agreed charges and security are unchanged; any eligible refund is recorded separately. ${args.reason.trim()}`;
    if (account) await postRentalMessage(ctx, { accountId: account._id, bookingId: b._id, sender: "system", text: detail,...(args.changeRequestId?{meta:{type:"rental_change_applied",changeRequestId:args.changeRequestId}}:{}) });
    await finishRequest(ctx,b,args.changeRequestId,"kit_removal",operationKey,detail);
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, { bookingId: b._id, kind: "kit updated", detail });
    await queueRmv2Sync(ctx, b._id);
    return { ok: true };
  },
});

export const prepareRefund = internalMutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    requestId: v.string(),
    amountPence: v.optional(v.number()),
    reason: v.string(),
  },
  handler: async (
    ctx,
    { token, bookingId, requestId, amountPence, reason },
  ) => {
    await assertAdmin(ctx, token, "rentalOperations.refund");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))
      throw Error("Invalid refund request");
    const prior = await ctx.db
      .query("rental_refunds")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .first();
    if (prior) {
      if (prior.bookingId !== bookingId)
        throw Error("Refund request belongs to another rental");
      return prior;
    }
    const b = await ctx.db.get(bookingId);
    if (!b || b.status !== "confirmed" || !b.stripePaymentIntentId)
      throw Error("Only a paid upcoming rental can receive a rental refund");
    if (b.cancellationDecision || (b.activeAdditionId || b.activeExtensionId) || b.returnDecision)
      throw Error("Finish the open cancellation, item addition or approved extension first");
    if (
      bookingCancelKind(b, Date.now()) !==
      "full_refund"
    )
      throw Error(
        "The rental cash refund window has closed. Cancel to issue account credit instead. Security payment is settled separately on return or cancellation.",
      );
    if (reason.trim().length < 5) throw Error("Record the refund reason");
    const previous = await ctx.db
      .query("rental_refunds")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    if (previous.some((r) => r.status === "prepared" || r.status === "pending"))
      throw Error(
        "A refund is still processing. Wait for its bank result before another refund or cancellation.",
      );
    const remaining = Math.max(
      0,
      Math.round((b.total - b.depositAmount) * 100) -
        previous.reduce(
          (sum, r) =>
            sum +
            (r.parts
              ? r.parts
                  .filter((p) => p.status === "succeeded")
                  .reduce((n, p) => n + p.amountPence, 0)
              : r.status === "succeeded"
                ? r.amountPence
                : 0),
          0,
        ),
    );
    const amount = amountPence ?? remaining;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining)
      throw Error("Refund must be within the remaining rental payment");
    const id = await ctx.db.insert("rental_refunds", {
      bookingId,
      requestId,
      amountPence: amount,
      reason: reason.trim().slice(0, 400),
      status: "prepared",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return (await ctx.db.get(id))!;
  },
});
export const refundContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => ctx.db.get(bookingId),
});
export const recordRefund = internalMutation({
  args: {
    id: v.id("rental_refunds"),
    stripeRefundId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("succeeded"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, { id, stripeRefundId, status }) => {
    const r = await ctx.db.get(id);
    if (!r) return;
    if (
      r.status === "succeeded" ||
      (r.status === status && r.stripeRefundId === stripeRefundId)
    )
      return;
    if (r.stripeRefundId && r.stripeRefundId !== stripeRefundId)
      throw Error("Refund identity mismatch");
    await ctx.db.patch(id, { stripeRefundId, status, updatedAt: Date.now() });
    const b = await ctx.db.get(r.bookingId);
    if (!b) return;
    const a = await accountForRental(ctx, b);
    if (a)
      await postRentalMessage(ctx, {
        accountId: a._id,
        bookingId: b._id,
        sender: "system",
        text: `Rental refund £${(r.amountPence / 100).toFixed(2)}: ${status === "succeeded" ? "confirmed by the payment provider" : status === "failed" ? "failed; the team is checking it" : "processing with the payment provider"}. ${r.reason}`,
      });
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId: b._id,
      kind: "rental refund",
      detail: `£${(r.amountPence / 100).toFixed(2)} · ${status}. ${r.reason}`,
    });
  },
});

export const paymentSources = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    return b ? await rentalPaymentSources(ctx, b) : [];
  },
});
export const bindRefundAllocations = internalMutation({
  args: {
    id: v.id("rental_refunds"),
    allocations: v.array(
      v.object({ paymentIntentId: v.string(), amountPence: v.number() }),
    ),
  },
  handler: async (ctx, { id, allocations }) => {
    const r = await ctx.db.get(id);
    if (!r) throw Error("Refund missing");
    if (r.allocations) return r.allocations;
    if (
      new Set(allocations.map((p) => p.paymentIntentId)).size !==
        allocations.length ||
      allocations.some(
        (p) => !Number.isSafeInteger(p.amountPence) || p.amountPence <= 0,
      ) ||
      allocations.reduce((sum, p) => sum + p.amountPence, 0) !== r.amountPence
    )
      throw Error("Invalid refund allocation");
    await ctx.db.patch(id, { allocations });
    return allocations;
  },
});
export const recordRefundPart = internalMutation({
  args: {
    id: v.id("rental_refunds"),
    paymentIntentId: v.string(),
    stripeRefundId: v.string(),
    status: v.string(),
  },
  handler: async (ctx, { id, paymentIntentId, stripeRefundId, status }) => {
    const r = await ctx.db.get(id);
    if (!r) return;
    const allocation = r.allocations?.find(
      (p) => p.paymentIntentId === paymentIntentId,
    );
    if (!allocation) throw Error("Unknown refund payment source");
    const existing = r.parts?.find(
      (p) => p.paymentIntentId === paymentIntentId,
    );
    if (existing?.status === "succeeded") return;
    if (existing && existing.stripeRefundId !== stripeRefundId)
      throw Error("Refund identity mismatch");
    const parts = [
      ...(r.parts ?? []).filter((p) => p.paymentIntentId !== paymentIntentId),
      {
        paymentIntentId,
        stripeRefundId,
        status,
        amountPence: allocation.amountPence,
      },
    ];
    const aggregate =
      parts.length !== r.allocations!.length
        ? "prepared"
        : parts.every((p) => p.status === "succeeded")
          ? "succeeded"
          : parts.some((p) => p.status === "pending")
            ? "pending"
            : "failed";
    await ctx.db.patch(id, { parts, status: aggregate, updatedAt: Date.now() });
    if (aggregate !== "prepared" && aggregate !== r.status) {
      const b = await ctx.db.get(r.bookingId);
      if (!b) return;
      const a = await accountForRental(ctx, b);
      if (a)
        await postRentalMessage(ctx, {
          accountId: a._id,
          bookingId: b._id,
          sender: "system",
          text: `Rental refund £${(r.amountPence / 100).toFixed(2)}: ${aggregate}. ${r.reason}`,
        });
      await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
        bookingId: b._id,
        kind: "rental refund",
        detail: `£${(r.amountPence / 100).toFixed(2)} · ${aggregate}. ${r.reason}`,
      });
    }
  },
});
