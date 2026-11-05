import {depositReturnReceipt} from "./lib/depositReturnReceipt";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { rentalControlsSnapshot } from "./lib/rentalControlsSnapshot";
import { stockWindow } from "./lib/stockWindows";
import { schedulePickupHold } from "./pickupSecurity";
import { bookingStockLines, londonRentalInstant, RENTAL_TIME_SLOTS, rentalWindow } from "../shared/rentalWindow";
import { handoverScheduleFingerprint, pickupScheduleFingerprint, queueRentalEmail, refreshQueuedVerificationEmail } from "./lib/rentalEmailQueue";
import { assertRentalAllocation } from "./lib/rentalAllocation";
import { accountForRental } from "./lib/rentalAccount";
import { listingImages } from "./lib/catalogImages";
import {
  requiresDroneLicence,
  droneLicenceStatusForRental,
} from "./lib/droneVerification";
import { assertVerificationArchive } from "./verificationArchive";
import { rentalPaymentSources } from "./lib/rentalPaymentSources";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { assertRenterExposure } from "./lib/rentalExposure";
import { assertRentalInventory } from "./lib/rentalInventory";
import { postRentalMessage } from "./lib/rentalChat";
import {
  rentalCancellationStart,
  bookingCancelKind,
  londonStartOfDay,
} from "../src/lib/cancellationPolicy";
import {
  approvedRequest,
  finishRequest,
  rescheduleRequestKey,
} from "./lib/rentalRequestExecution";

/** Minimal server-only address lookup: a linked rental never falls back to a reused mailbox. */
export const changeRecipient = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) return null;
    const account = await accountForRental(ctx, booking);
    const email = booking.accountId
      ? account?.email
      : (account?.email ?? booking.guestEmail);
    return email ? { email, bookingId } : null;
  },
});

export const details = query({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, { token, bookingId }) => {
    if (!checkAdminToken(token)) return null;
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    let verificationArchiveReady = false;
    if (b.idVerifyStatus === "verified") {
      try {
        await assertVerificationArchive(ctx, b);
        verificationArchiveReady = true;
      } catch {}
    }
    const refunds = await ctx.db
      .query("rental_refunds")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    return {
      ...b,
      documentAccountId: (await accountForRental(ctx,b))?._id ?? null,
      requiresDroneLicence: await requiresDroneLicence(ctx, b),
      droneLicenceStatus: await droneLicenceStatusForRental(ctx, b),
      verificationArchiveReady,
      lineItems: await Promise.all(
        bookingStockLines(b).map(async (line) => {
          const listing = await ctx.db.get(line.listingId);
          const imageSources = listingImages(listing);
          return { ...line, heroImage: imageSources[0] ?? null, imageSources };
        }),
      ),
      rentalRefunds: refunds,
      controlsSnapshot: rentalControlsSnapshot(b, refunds),
      cancellationKind: bookingCancelKind(b, Date.now()),
    };
  },
});
async function qualifyReschedule(
  ctx: QueryCtx,
  b: Doc<"bookings"> | null,
  args: {
    start: number;
    end?: number;
    keepAgreedPrice?: boolean;
    reason: string;
    expectedSnapshot?: string;
    pickupChange?: {lineIndex:number;time:string};
    handoverChange?: {lineIndexes:number[];time:string;kind:"pickup"|"return"};
  },
) {
  const { start, end, keepAgreedPrice, reason, expectedSnapshot, pickupChange, handoverChange } = args;
  const activeReturn=b?.status==="active"&&handoverChange?.kind==="return";
  if (!b || b.status !== "confirmed" && !activeReturn)
    throw Error("Only an upcoming rental or an active rental return can change this time");
  const bookingId = b._id;
  if (
    b.cancellationDecision ||
    b.activeAdditionId ||
    b.activeDeliveryQuoteId ||
    b.activeExtensionId ||
      b.activePriceAdjustmentId ||
    b.returnDecision
  )
    throw Error(
      "Finish the open cancellation, item addition or approved extension first",
    );
  const refunds = await ctx.db
    .query("rental_refunds")
    .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
    .collect();
  if (
    expectedSnapshot &&
    expectedSnapshot !== rentalControlsSnapshot(b, refunds)
  )
    throw Error("The rental changed. Refresh and review the dates again.");
  if (refunds.some((r) => ["prepared", "pending"].includes(r.status)))
    throw Error("Wait for the open refund to settle first.");
  if (reason.trim().length < 5) throw Error("Record the reason for the change");
  if (
    !Number.isSafeInteger(start) ||
    start % 86400000 !== 0 ||
    !activeReturn && start < londonStartOfDay(Date.now())
  )
    throw Error("Choose a future start date");
  const reservations = await ctx.db
    .query("reservations")
    .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
    .collect();
  if (reservations.some((r) => r.source !== "site"))
    throw Error("Manage this rental through its original booking platform");
  if (reservations.some((r) => r.status === "hold"))
    throw Error("Resolve the open stock hold before changing this rental.");
  if(activeReturn&&reservations.some(r=>r.status==="returned"||r.extensionRequestId&&["confirmed","active"].includes(r.status)))
    throw Error("This rental has returned or extended items. Reconcile the physical allocation before changing its return time.");
  const allocationMode = await assertRentalAllocation(ctx, b, reservations);
  const previous = Math.min(...b.lineItems.map((li) => li.start));
  const shift = start - previous;
  const previousEnd = Math.max(...b.lineItems.map((li) => li.end));
  if (
    end !== undefined &&
    (!Number.isSafeInteger(end) || end % 86400000 !== 0 || end < start)
  )
    throw Error("Choose a valid return date on or after the start.");
  const endShift = end === undefined ? 0 : end - (previousEnd + shift);
  if (endShift !== 0 && keepAgreedPrice !== true)
    throw Error(
      "Confirm that the changed duration keeps the agreed charges; extra days are complimentary.",
    );
  const lines = bookingStockLines(b).map((li,index) => ({
    ...li,
    start: li.start + shift,
    end: li.end + shift + endShift,
    ...(pickupChange?.lineIndex===index ? {pickupTime:pickupChange.time} : {}),
    ...(handoverChange?.lineIndexes.includes(index) ? handoverChange.kind === "pickup" ? {pickupTime:handoverChange.time} : {returnTime:handoverChange.time} : {}),
  }));
  if(pickupChange){
    if(!Number.isSafeInteger(pickupChange.lineIndex)||!lines[pickupChange.lineIndex]||!RENTAL_TIME_SLOTS.includes(pickupChange.time))throw Error("Choose a valid item and available pickup time.");
    const selected=lines[pickupChange.lineIndex];
    rentalWindow(selected);
    if(londonRentalInstant(selected.start,pickupChange.time)<=Date.now())throw Error("Choose a future pickup time.");
  }
  if(handoverChange){
    const {lineIndexes,time,kind}=handoverChange;
    if(!lineIndexes.length||lineIndexes.length>lines.length||new Set(lineIndexes).size!==lineIndexes.length||lineIndexes.some(index=>!Number.isSafeInteger(index)||!lines[index])||!RENTAL_TIME_SLOTS.includes(time))throw Error("Choose valid items and an available time.");
    for(const index of lineIndexes){const line=lines[index];rentalWindow(line);if(londonRentalInstant(kind==="pickup"?line.start:line.end,time)<=Date.now())throw Error("Choose a future handover time.");}
  }
  await assertRenterExposure(ctx, b, lines);
  await assertRentalInventory(ctx, lines, bookingId);
  return {
    lines,
    reservations,
    allocationMode,
    endShift,
    controlsSnapshot: rentalControlsSnapshot(b, refunds),
  };
}

export const previewReschedule = query({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    start: v.number(),
    end: v.optional(v.number()),
    keepAgreedPrice: v.optional(v.boolean()),
    reason: v.string(),
  },
  handler: async (ctx, { token, bookingId, ...args }) => {
    if (!checkAdminToken(token)) throw Error("Unauthorized");
    const booking = await ctx.db.get(bookingId);
    try {
      const proposal = await qualifyReschedule(ctx, booking, args);
      return {
        ok: true,
        controlsSnapshot: proposal.controlsSnapshot,
        start: args.start,
        end:
          args.end ?? Math.max(...proposal.lines.map((line: any) => line.end)),
        total: booking!.total,
        depositHoldAmount: booking!.depositHoldAmount ?? 0,
      };
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : "The date change could not be checked.",
      };
    }
  },
});

export const changePickupTime = mutation({
  args:{token:v.string(),bookingId:v.id("bookings"),requestId:v.string(),lineIndex:v.number(),pickupTime:v.string(),expectedSnapshot:v.string(),reason:v.string()},
  handler:async(ctx,args)=>{
    await assertAdmin(ctx,args.token,"rentalOperations.changePickupTime");
    if(!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId))throw Error("Invalid change request.");
    if(!args.expectedSnapshot.trim())throw Error("The rental changed. Refresh and review the pickup time.");
    const fingerprint=JSON.stringify([args.lineIndex,args.pickupTime,args.expectedSnapshot,args.reason.trim()]);
    const prior=await ctx.db.query("rental_time_changes").withIndex("by_request",q=>q.eq("bookingId",args.bookingId).eq("requestId",args.requestId)).unique();
    if(prior){if(prior.fingerprint!==fingerprint)throw Error("This request was already used for a different change.");return {ok:true,detail:prior.detail};}
    const booking=await ctx.db.get(args.bookingId);
    if(!booking||!booking.lineItems.length)throw Error("Rental not found.");
    const oldLines=bookingStockLines(booking),oldLine=oldLines[args.lineIndex];
    if(!oldLine)throw Error("Choose an item from this rental.");
    if(oldLine.pickupTime===args.pickupTime)throw Error("Choose a different pickup time.");
    const start=Math.min(...oldLines.map(line=>line.start));
    const {lines,reservations,allocationMode}=await qualifyReschedule(ctx,booking,{start,reason:args.reason,expectedSnapshot:args.expectedSnapshot,pickupChange:{lineIndex:args.lineIndex,time:args.pickupTime}});
    const earliest=lines.reduce((best,line)=>line.start<best.start||line.start===best.start&&(line.pickupTime??"00:00")<(best.pickupTime??"00:00")?line:best);
    const updated={...booking,lineItems:lines,pickupTime:earliest.pickupTime ?? undefined};
    await schedulePickupHold(ctx,updated);
    await ctx.db.patch(args.bookingId,{lineItems:lines,pickupTime:updated.pickupTime});
    await refreshQueuedVerificationEmail(ctx,args.bookingId);
    for(const reservation of reservations)if(["confirmed","hold"].includes(reservation.status))await ctx.db.patch(reservation._id,{status:"cancelled"});
    for(const line of lines){
      const listing=await ctx.db.get(line.listingId);
      const window=allocationMode==="legacy"?{start:line.start,end:line.end}:stockWindow(line,allocationMode==="precise");
      for(const component of listing!.components)await ctx.db.insert("reservations",{inventoryUnitId:component.inventoryUnitId,listingId:line.listingId,bookingId:args.bookingId,...window,qty:component.qty*line.qty,source:"site",status:"confirmed"});
    }
    const day=(value:number)=>new Date(value).toISOString().slice(0,10);
    const schedule=lines.map(line=>`${line.qty}× ${line.title}: ${day(line.start)} at ${line.pickupTime ?? "time to be confirmed"}`).join("; ");
    const detail=`${oldLine.title} pickup on ${day(oldLine.start)} changed from ${oldLine.pickupTime ?? "time to be confirmed"} to ${args.pickupTime}. Current pickup schedule: ${schedule}.`;
    const account=await accountForRental(ctx,booking);
    if(account)await postRentalMessage(ctx,{accountId:account._id,bookingId:args.bookingId,sender:"system",text:`${detail} All times are London local time. Agreed charges and security are unchanged. ${args.reason.trim()}`});
    await queueRentalEmail(ctx,args.bookingId,"time_change",{changeDetail:detail,changeSchedule:pickupScheduleFingerprint(updated)});
    await queueRmv2Sync(ctx,args.bookingId);
    await ctx.db.insert("rental_time_changes",{bookingId:args.bookingId,requestId:args.requestId,fingerprint,detail,createdAt:Date.now()});
    return {ok:true,detail};
  },
});

export const changeHandoverTimes = mutation({
  args:{token:v.string(),bookingId:v.id("bookings"),requestId:v.string(),lineIndexes:v.array(v.number()),kind:v.union(v.literal("pickup"),v.literal("return")),time:v.string(),expectedSnapshot:v.string(),reason:v.string()},
  handler:async(ctx,args)=>{
    await assertAdmin(ctx,args.token,"rentalOperations.changeHandoverTimes");
    if(!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId))throw Error("Invalid change request.");
    if(!args.expectedSnapshot.trim())throw Error("The rental changed. Refresh and review the time.");
    const lineIndexes=[...args.lineIndexes].sort((left,right)=>left-right);
    const fingerprint=JSON.stringify([lineIndexes,args.kind,args.time,args.expectedSnapshot,args.reason.trim()]);
    const prior=await ctx.db.query("rental_time_changes").withIndex("by_request",q=>q.eq("bookingId",args.bookingId).eq("requestId",args.requestId)).unique();
    if(prior){if(prior.fingerprint!==fingerprint)throw Error("This request was already used for a different change.");return {ok:true,detail:prior.detail};}
    const booking=await ctx.db.get(args.bookingId);
    if(!booking?.lineItems.length)throw Error("Rental not found.");
    const oldLines=bookingStockLines(booking);
    if(lineIndexes.every(index=>oldLines[index]&&(args.kind==="pickup"?oldLines[index].pickupTime:oldLines[index].returnTime)===args.time))throw Error("Choose a different time for at least one selected item.");
    const start=Math.min(...oldLines.map(line=>line.start));
    const {lines,reservations,allocationMode}=await qualifyReschedule(ctx,booking,{start,reason:args.reason,expectedSnapshot:args.expectedSnapshot,handoverChange:{lineIndexes,kind:args.kind,time:args.time}});
    const activeUpdates:Array<{id:typeof reservations[number]["_id"];start:number;end:number;turnaroundBufferMinutes?:number}>=[];
    if(booking.status==="active")for(const reservation of reservations.filter(row=>["confirmed","active"].includes(row.status))){
      const matches=oldLines.map((line,index)=>({line,index})).filter(({line})=>{
        if(String(line.listingId)!==String(reservation.listingId))return false;
        const window=allocationMode==="legacy"?{start:line.start,end:line.end}:stockWindow(line,allocationMode==="precise");
        const normalizedEnd=reservation.end+(reservation.endExclusive&&reservation.turnaroundBufferMinutes!==60?3600000:0);
        return window.start===reservation.start&&window.end===normalizedEnd;
      });
      const windows=matches.map(({index})=>allocationMode==="legacy"?{start:lines[index].start,end:lines[index].end}:stockWindow(lines[index],allocationMode==="precise"));
      if(!windows.length||new Set(windows.map(window=>JSON.stringify([window.start,window.end]))).size!==1)throw Error("The affected items share an ambiguous physical allocation. Reconcile it before changing the return time.");
      activeUpdates.push({id:reservation._id,start:windows[0].start,end:windows[0].end,...(reservation.endExclusive?{turnaroundBufferMinutes:60}:{})});
    }
    const earliest=lines.reduce((best,line)=>line.start<best.start||line.start===best.start&&(line.pickupTime??"00:00")<(best.pickupTime??"00:00")?line:best);
    const latest=lines.reduce((best,line)=>line.end>best.end||line.end===best.end&&(line.returnTime??"23:59")>(best.returnTime??"23:59")?line:best);
    const updated={...booking,lineItems:lines,pickupTime:earliest.pickupTime??undefined,returnTime:latest.returnTime??undefined};
    if(args.kind==="pickup")await schedulePickupHold(ctx,updated);
    await ctx.db.patch(args.bookingId,{lineItems:lines,pickupTime:updated.pickupTime,returnTime:updated.returnTime});
    if(args.kind==="pickup")await refreshQueuedVerificationEmail(ctx,args.bookingId);
    if(booking.status==="active")for(const {id,...window} of activeUpdates)await ctx.db.patch(id,window);
    else {
      for(const reservation of reservations)if(["confirmed","hold"].includes(reservation.status))await ctx.db.patch(reservation._id,{status:"cancelled"});
      for(const line of lines){const listing=await ctx.db.get(line.listingId);const window=allocationMode==="legacy"?{start:line.start,end:line.end}:stockWindow(line,allocationMode==="precise");for(const component of listing!.components)await ctx.db.insert("reservations",{inventoryUnitId:component.inventoryUnitId,listingId:line.listingId,bookingId:args.bookingId,...window,qty:component.qty*line.qty,source:"site",status:"confirmed"});}
    }
    const day=(value:number)=>new Date(value).toISOString().slice(0,10);
    const detail=lineIndexes.map(index=>{const before=oldLines[index],after=lines[index],previous=args.kind==="pickup"?before.pickupTime:before.returnTime;return `${before.qty}× ${before.title} ${args.kind} on ${day(args.kind==="pickup"?after.start:after.end)} changed from ${previous??"time to be confirmed"} to ${args.time}`;}).join("; ")+".";
    const account=await accountForRental(ctx,booking);
    if(account)await postRentalMessage(ctx,{accountId:account._id,bookingId:args.bookingId,sender:"system",text:`${detail} All times are London local time. Agreed charges and security are unchanged. ${args.reason.trim()}`});
    await queueRentalEmail(ctx,args.bookingId,"time_change",{changeDetail:detail,changeSchedule:handoverScheduleFingerprint(updated),changeKind:args.kind});
    await queueRmv2Sync(ctx,args.bookingId);
    await ctx.db.insert("rental_time_changes",{bookingId:args.bookingId,requestId:args.requestId,fingerprint,detail,createdAt:Date.now()});
    return {ok:true,detail};
  },
});

export const reschedule = mutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    start: v.number(),
    end: v.optional(v.number()),
    keepAgreedPrice: v.optional(v.boolean()),
    reason: v.string(),
    expectedSnapshot: v.optional(v.string()),
    changeRequestId: v.optional(v.id("rental_change_requests")),
  },
  handler: async (
    ctx,
    {
      token,
      bookingId,
      start,
      end,
      keepAgreedPrice,
      reason,
      expectedSnapshot,
      changeRequestId,
    },
  ) => {
    await assertAdmin(ctx, token, "rentalOperations.reschedule");
    const b = await ctx.db.get(bookingId);
    const operationKey = rescheduleRequestKey(
      start,
      end,
      keepAgreedPrice,
      reason,
    );
    const request = await approvedRequest(
      ctx,
      b,
      changeRequestId,
      "reschedule",
      operationKey,
    );
    if (request?.execution?.status === "applied") return { ok: true };
    const { lines, reservations, allocationMode, endShift } =
      await qualifyReschedule(ctx, b, {
        start,
        end,
        keepAgreedPrice,
        reason,
        expectedSnapshot,
      });
    await ctx.db.patch(bookingId, {
      lineItems: lines,
      cancellationPolicyStart: start,
    });
    await refreshQueuedVerificationEmail(ctx,bookingId);
    await schedulePickupHold(ctx, { ...b, lineItems: lines });
    for (const r of reservations)
      if (["confirmed", "hold"].includes(r.status))
        await ctx.db.patch(r._id, { status: "cancelled" });
    for (const li of lines) {
      const listing = await ctx.db.get(li.listingId);
      const window =
        allocationMode === "legacy"
          ? { start: li.start, end: li.end }
          : stockWindow(li, allocationMode === "precise");
      for (const comp of listing!.components)
        await ctx.db.insert("reservations", {
          inventoryUnitId: comp.inventoryUnitId,
          listingId: li.listingId,
          bookingId,
          ...window,
          qty: comp.qty * li.qty,
          source: "site",
          status: "confirmed",
        });
    }
    const a = await accountForRental(ctx, b);
    const detail = `${new Date(start).toISOString().slice(0, 10)} → ${new Date(Math.max(...lines.map((li) => li.end))).toISOString().slice(0, 10)}`;
    if (a)
      await postRentalMessage(ctx, {
        accountId: a._id,
        bookingId,
        sender: "system",
        text: `The team rescheduled your rental to ${detail}. Agreed charges and security are unchanged${endShift > 0 ? "; the additional days have no extra rental charge" : ""}. Any eligible refund is recorded separately. ${reason.trim()}`,
        ...(changeRequestId
          ? { meta: { type: "rental_change_applied", changeRequestId } }
          : {}),
      });
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId,
      kind: "rescheduled",
      detail,
    });
    await queueRmv2Sync(ctx, bookingId);
    await finishRequest(
      ctx,
      b,
      changeRequestId,
      "reschedule",
      operationKey,
      `Rental dates updated to ${detail}. Agreed charges are unchanged; any eligible refund is recorded separately.`,
    );
    return { ok: true };
  },
});

/** Amend fulfilment, preserving captured charges and a permanent invoice audit trail.
 * Refunds use the existing provider-backed refund control; security settles separately. */
export const removeItem = mutation({
  args: {
    expectedSnapshot:v.optional(v.string()),
    token: v.string(),
    bookingId: v.id("bookings"),
    requestId: v.string(),
    lineIndex: v.number(),
    listingId: v.id("listings"),
    expectedQty: v.number(),
    expectedStart: v.number(),
    expectedEnd: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.token, "rentalOperations.removeItem");
    const b = await ctx.db.get(args.bookingId);
    if (!b) throw Error("Rental unavailable.");
    const prior = b.removedItems?.find((l) => l.requestId === args.requestId);
    if (prior) {
      if (
        prior.listingId !== args.listingId ||
        prior.qty !== args.expectedQty ||
        prior.start !== args.expectedStart ||
        prior.end !== args.expectedEnd ||
        prior.reason !== args.reason.trim()
      )
        throw Error("Removal request has changed.");
      return { ok: true };
    }
    if (b.status !== "confirmed")
      throw Error("Only an unstarted confirmed rental can have kit removed.");
    if (
      b.cancellationDecision ||
      b.activeAdditionId ||
      b.activeDeliveryQuoteId ||
      b.activeExtensionId ||
      b.activePriceAdjustmentId ||
      b.returnDecision
    )
      throw Error("Finish the open rental operation first.");
    const refunds = await ctx.db
      .query("rental_refunds")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    if(args.expectedSnapshot && args.expectedSnapshot!==rentalControlsSnapshot(b,refunds))
      throw new ConvexError({code:"EQUIPMENT_REVIEW_STALE",message:"The rental changed. Review the removal again."});
    if (refunds.some((r) => ["prepared", "pending"].includes(r.status)))
      throw Error("Wait for the open refund to settle first.");
    if (
      !/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId) ||
      args.reason.trim().length < 5 ||
      args.reason.trim().length > 400
    )
      throw Error("Record a valid removal request and reason.");
    if (!Number.isSafeInteger(args.lineIndex) || args.lineIndex < 0)
      throw Error("Invalid item.");
    const line = b.lineItems[args.lineIndex];
    if (
      !line ||
      line.listingId !== args.listingId ||
      line.qty !== args.expectedQty ||
      line.start !== args.expectedStart ||
      line.end !== args.expectedEnd
    )
      throw Error("The kit changed. Refresh and choose the item again.");
    if (b.lineItems.length < 2)
      throw Error("Use Cancel rental to remove the last item.");
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    if (reservations.some((r) => r.source !== "site" || r.status === "active"))
      throw Error(
        "Manage external or already collected kit through its original rental flow.",
      );
    if (reservations.some((r) => r.status === "hold"))
      throw Error("Resolve the open stock hold before changing this rental.");
    await assertRentalAllocation(ctx, b, reservations);
    const lines = bookingStockLines(b).filter((_, i) => i !== args.lineIndex);
    await assertRentalInventory(ctx, lines, b._id);
    for (const r of reservations)
      if (["hold", "confirmed"].includes(r.status))
        await ctx.db.patch(r._id, { status: "cancelled" });
    for (const remaining of lines) {
      const listing = await ctx.db.get(remaining.listingId);
      for (const component of listing!.components)
        await ctx.db.insert("reservations", {
          bookingId: b._id,
          listingId: remaining.listingId,
          inventoryUnitId: component.inventoryUnitId,
          ...stockWindow(remaining, true),
          qty: component.qty * remaining.qty,
          source: "site",
          status: "confirmed",
        });
    }
    const { dailyRate: _, ...removed } = line;
    await ctx.db.patch(b._id, {
      lineItems: lines,
      cancellationPolicyStart: rentalCancellationStart(b),
      removedItems: [
        ...(b.removedItems ?? []),
        {
          ...removed,
          removedAt: Date.now(),
          reason: args.reason.trim(),
          requestId: args.requestId,
        },
      ],
    });
    const account = await accountForRental(ctx, b);
    const detail = `${line.qty}× ${line.title} removed from your kit. Agreed charges and security are unchanged; any eligible refund is recorded separately. ${args.reason.trim()}`;
    if (account)
      await postRentalMessage(ctx, {
        accountId: account._id,
        bookingId: b._id,
        sender: "system",
        text: detail,
      });
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId: b._id,
      kind: "kit updated",
      detail,
    });
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
    expectedSnapshot: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { token, bookingId, requestId, amountPence, reason, expectedSnapshot },
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
      if (amountPence !== undefined && prior.amountPence !== amountPence) throw Error("Refund request amount changed");
      if (prior.reason !== reason.trim().slice(0,400)) throw Error("Refund request reason changed");
      return prior;
    }
    const b = await ctx.db.get(bookingId);
    if (!b || !["confirmed","active"].includes(b.status) || !b.stripePaymentIntentId)
      throw Error("Only a paid rental can receive a rental refund");
    if (
      b.cancellationDecision ||
      b.activeAdditionId ||
      b.activeDeliveryQuoteId ||
      b.activeExtensionId ||
      b.activePriceAdjustmentId ||
      b.returnDecision
    )
      throw Error(
        "Finish the open cancellation, item addition or approved extension first",
      );
    if (reason.trim().length < 5) throw Error("Record the refund reason");
    const previous = await ctx.db
      .query("rental_refunds")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .take(101);
    if(previous.length>100) throw Error("Refund history needs review");
    if(expectedSnapshot && rentalControlsSnapshot(b,previous)!==expectedSnapshot) throw Error("The rental changed after price review. Review again.");
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
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) =>
        q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()),
      )
      .first();
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
      const a = await ctx.db
        .query("accounts")
        .withIndex("by_email", (q) =>
          q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()),
        )
        .first();
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

/** On-demand bounded catalog for the operator equipment picker, never a subscription scan. */
export const equipmentCatalog = query({
  args:{token:v.string(),search:v.optional(v.string())},
  handler:async(ctx,{token,search})=>{
    if(!checkAdminToken(token)) throw Error("unauthorized");
    const term=(search??"").trim().toLowerCase();
    if(term.length>120) throw Error("Search is too long.");
    const rows=await ctx.db.query("listings").withIndex("by_active",q=>q.eq("active",true)).take(501);
    if(rows.length>500) throw Error("The equipment catalog needs a paginated review.");
    return rows.filter(l=>!l.suppressed && !l.marketingOnly && l.components.length && l.title.toLowerCase().includes(term))
      .sort((a,b)=>a.title.localeCompare(b.title)).slice(0,24)
      .map(l=>({listingId:l._id,title:l.title,imageSources:listingImages(l),daily:l.pricing.daily}));
  },
});

export const refundJob=internalQuery({args:{id:v.id("rental_refunds")},handler:async(ctx,{id})=>ctx.db.get(id)});
export const recordRefundReceipt=internalMutation({args:{id:v.id("rental_refunds"),receipt:depositReturnReceipt},handler:async(ctx,{id,receipt})=>{const r=await ctx.db.get(id);if(!r)throw Error("Refund missing");const a=r.allocations?.find(p=>p.paymentIntentId===receipt.paymentIntentId);if(!a||a.amountPence!==receipt.amountPence||receipt.attemptedAt!==r.createdAt)throw Error("Refund receipt allocation mismatch");const rows=r.refundReceipts??[],old=rows.find(p=>p.paymentIntentId===receipt.paymentIntentId);if(old&&(old.attemptedAt!==receipt.attemptedAt||(old.stripeRefundId&&old.stripeRefundId!==receipt.stripeRefundId)||(old.approvalRequestId&&old.approvalRequestId!==receipt.approvalRequestId)))throw Error("Original refund identity cannot be replaced");await ctx.db.patch(id,{refundReceipts:[...rows.filter(p=>p.paymentIntentId!==receipt.paymentIntentId),receipt]});}});
