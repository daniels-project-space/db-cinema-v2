import {depositReturnReceipt} from "./lib/depositReturnReceipt";
import { assertSwapStockReconciled } from "./lib/swapStockFence";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { rentalControlsSnapshot } from "./lib/rentalControlsSnapshot";
import { stockWindow } from "./lib/stockWindows";
import { schedulePickupHold } from "./pickupSecurity";
import { bookingStockLines, londonRentalInstant, RENTAL_TIME_SLOTS, rentalWindow } from "../shared/rentalWindow";
import { handoverScheduleFingerprint, pickupScheduleFingerprint, queueRentalEmail, refreshQueuedVerificationEmail } from "./lib/rentalEmailQueue";
import { assertRentalAllocation } from "./lib/rentalAllocation";
import { accountForRental } from "./lib/rentalAccount";
import { queueOwnerNotification } from "./lib/adminPush";
import { listingImages, listingRentalImages } from "./lib/catalogImages";
import { renterRentalActionReady } from "./lib/renterRentalActionGate";
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
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import {
  rentalCancellationStart,
  bookingCancelKind,
  londonStartOfDay,
} from "../src/lib/cancellationPolicy";
import {
  approvedRequest,
  finishRequest,
  handoverRequestKey,
  rescheduleRequestKey,
} from "./lib/rentalRequestExecution";
import { RENTAL_REQUEST_HISTORY_LIMIT, summarizeRentalRequests } from "./lib/rentalRequestStatus";

async function assertNoOpenRentalRequests(ctx: any, bookingId: any, ignoreId?: any) {
  const rows = await ctx.db.query("rental_change_requests").withIndex("by_booking", (q: any) => q.eq("bookingId", bookingId)).order("desc").take(RENTAL_REQUEST_HISTORY_LIMIT + 1);
  const summary = summarizeRentalRequests(rows, ignoreId);
  if (!summary.ready) throw Error("This rental has a long request history. Review earlier requests before changing it.");
  if (summary.any) throw Error("A renter request is still awaiting a decision or completion. Review it before changing this rental.");
}

/** Minimal server-only address lookup: a linked rental never falls back to a reused mailbox. */
export const changeRecipient = internalQuery({
  args: { bookingId: v.id("bookings"), expectedAccountId: v.optional(v.id("accounts")), expectedRecipientEmail: v.optional(v.string()) },
  handler: async (ctx, { bookingId, expectedAccountId, expectedRecipientEmail }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) return null;
    const account = await accountForRental(ctx, booking);
    if (expectedAccountId && account?._id !== expectedAccountId) return null;
    const email = booking.accountId
      ? account?.email
      : (account?.email ?? booking.guestEmail);
    if (expectedRecipientEmail !== undefined && (!email || email.trim().toLowerCase() !== expectedRecipientEmail)) return null;
    return email ? { email, bookingId } : null;
  },
});

export const alertRefundContactChange = internalMutation({
  args: { bookingId: v.id("bookings"), refundId: v.id("rental_refunds") },
  handler: async (ctx, { bookingId, refundId }) => {
    const refund = await ctx.db.get(refundId);
    if (!refund || refund.bookingId !== bookingId || (!refund.expectedAccountId && refund.expectedRecipientEmail === undefined)) throw Error("Refund notification binding unavailable.");
    await queueOwnerNotification(ctx,{eventKey:`refund-email-contact-changed:${refundId}`,kind:"checkout_failure",bookingId,title:"Refund email needs review",body:"A refund email was not sent because the rental contact changed or is unavailable. Check the payment and contact before notifying the renter."});
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
          const imageSources = listingRentalImages(listing);
          return { ...line, heroImage: imageSources[0] ?? null, imageSources };
        }),
      ),
      rentalRefunds: refunds,
      controlsSnapshot: rentalControlsSnapshot(b, refunds),
      cancellationKind: bookingCancelKind(b, Date.now()),
      cancellationTermsVersion: b.agreementDocs?.find((doc: { kind: string; version: string }) => doc.kind === "cancellation")?.version ?? "2026-10-v10",
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
  await assertSwapStockReconciled(ctx, bookingId);
  if (
    b.cancellationDecision ||
    b.activeAdditionId ||
    b.activeDeliveryQuoteId ||
    b.activeItemSwapId ||
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

export const renterReschedulePreview = query({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    start: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, { token, bookingId, start, reason }) => {
    const account = await accountForToken(ctx, token, true);
    if (!account) throw Error("Please sign in to check this rental.");
    const booking = await ownedBooking(ctx, account, bookingId);
    if (!renterRentalActionReady(booking)) return { ok: false, reason: "Rental changes are available after payment and Didit verification are complete." };
    try {
      const proposal = await qualifyReschedule(ctx, booking, { start, reason });
      return {
        ok: true,
        start,
        end: Math.max(...proposal.lines.map((line: any) => line.end)),
        controlsSnapshot: proposal.controlsSnapshot,
      };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Availability could not be checked.",
      };
    }
  },
});

/** Live, renter-owned availability check for a pickup or return-time request. */
export const renterHandoverPreview = query({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    lineIndexes: v.array(v.number()),
    kind: v.union(v.literal("pickup"), v.literal("return")),
    time: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { token, bookingId, lineIndexes, kind, time, reason }) => {
    const account = await accountForToken(ctx, token, true);
    if (!account) throw Error("Please sign in to check this rental.");
    const booking = await ownedBooking(ctx, account, bookingId);
    if (!renterRentalActionReady(booking)) return { ok: false, reason: "Rental changes are available after payment and Didit verification are complete." };
    const indexes = [...lineIndexes].sort((left, right) => left - right);
    try {
      const proposal = await qualifyReschedule(ctx, booking, {
        start: Math.min(...booking.lineItems.map((line: any) => line.start)),
        reason,
        handoverChange: { lineIndexes: indexes, kind, time },
      });
      return { ok: true, controlsSnapshot: proposal.controlsSnapshot, lineIndexes: indexes, kind, time };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "That handover time could not be checked." };
    }
  },
});

/** Admin-side approval recheck; it intentionally does not accept renter sessions. */
export const previewHandoverTimes = query({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    lineIndexes: v.array(v.number()),
    kind: v.union(v.literal("pickup"), v.literal("return")),
    time: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { token, bookingId, lineIndexes, kind, time, reason }) => {
    if (!checkAdminToken(token)) throw Error("Unauthorized");
    const booking = await ctx.db.get(bookingId);
    if (!booking) return { ok: false, reason: "Rental not found." };
    const indexes = [...lineIndexes].sort((left, right) => left - right);
    try {
      const proposal = await qualifyReschedule(ctx, booking, {
        start: Math.min(...booking.lineItems.map((line: any) => line.start)),
        reason,
        handoverChange: { lineIndexes: indexes, kind, time },
      });
      return { ok: true, controlsSnapshot: proposal.controlsSnapshot, lineIndexes: indexes, kind, time };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "That handover time could not be checked." };
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
    await assertNoOpenRentalRequests(ctx,args.bookingId);
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
  args:{token:v.string(),bookingId:v.id("bookings"),requestId:v.string(),changeRequestId:v.optional(v.id("rental_change_requests")),lineIndexes:v.array(v.number()),kind:v.union(v.literal("pickup"),v.literal("return")),time:v.string(),expectedSnapshot:v.string(),reason:v.string()},
  handler:async(ctx,args)=>{
    await assertAdmin(ctx,args.token,"rentalOperations.changeHandoverTimes");
    if(!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId))throw Error("Invalid change request.");
    if(!args.expectedSnapshot.trim())throw Error("The rental changed. Refresh and review the time.");
    const lineIndexes=[...args.lineIndexes].sort((left,right)=>left-right);
    const fingerprint=JSON.stringify([lineIndexes,args.kind,args.time,args.expectedSnapshot,args.reason.trim()]);
    const booking=await ctx.db.get(args.bookingId);
    if(!booking?.lineItems.length)throw Error("Rental not found.");
    const operationKey=handoverRequestKey(lineIndexes,args.kind,args.time,args.expectedSnapshot);
    const approved=await approvedRequest(ctx,booking,args.changeRequestId,"handover",operationKey);
    if(approved){
      if(approved.requestId!==args.requestId)throw Error("Use the approved time-change request for this rental.");
      const proposal=approved.requestedHandover;
      if(!proposal||approved.requestedSnapshot!==args.expectedSnapshot||proposal.kind!==args.kind||proposal.time!==args.time||JSON.stringify([...proposal.lineIndexes].sort((left,right)=>left-right))!==JSON.stringify(lineIndexes))throw Error("Use the exact pickup or return time the renter requested.");
      if(approved.execution?.status==="applied")return {ok:true,detail:approved.execution.detail};
    }
    const prior=await ctx.db.query("rental_time_changes").withIndex("by_request",q=>q.eq("bookingId",args.bookingId).eq("requestId",args.requestId)).unique();
    if(prior){if(prior.fingerprint!==fingerprint)throw Error("This request was already used for a different change.");return {ok:true,detail:prior.detail};}
    await assertNoOpenRentalRequests(ctx,args.bookingId,approved?approved._id:undefined);
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
    if(approved)await finishRequest(ctx,booking,args.changeRequestId,"handover",operationKey,detail);
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
    await assertNoOpenRentalRequests(ctx, bookingId, request?._id);
    if (request?.requestedStart !== undefined) {
      if (start !== request.requestedStart || end !== undefined || !request.requestedSnapshot || expectedSnapshot !== request.requestedSnapshot || request.requestedEnd === undefined)
        throw Error("Use the exact dates the renter requested. Ask them to send a new request to change them.");
    }
    const { lines, reservations, allocationMode, endShift } =
      await qualifyReschedule(ctx, b, {
        start,
        end,
        keepAgreedPrice,
        reason,
        expectedSnapshot,
      });
    if (request?.requestedStart !== undefined && Math.max(...lines.map((line) => line.end)) !== request.requestedEnd)
      throw Error("The rental dates changed after the request. Ask the renter to send a fresh date request.");
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

/** @deprecated Use the renter-approved equipment-change flow for any item removal. */
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
    throw Error("Standalone item removal is disabled because it does not settle the rental price. Use the renter-approved equipment change flow.");
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
    await assertSwapStockReconciled(ctx, bookingId);
    if (
      b.cancellationDecision ||
      b.activeAdditionId ||
      b.activeDeliveryQuoteId ||
      b.activeItemSwapId ||
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
    const recipient = await accountForRental(ctx, b);
    const recipientEmail = (b.accountId ? recipient?.email : recipient?.email ?? b.guestEmail)?.trim().toLowerCase() ?? "";
    const id = await ctx.db.insert("rental_refunds", {
      bookingId,
      ...(recipient ? { expectedAccountId: recipient._id } : {}),
      expectedRecipientEmail: recipientEmail,
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
    const email = (b.accountId ? a?.email : a?.email ?? b.guestEmail)?.trim().toLowerCase() ?? "";
    if ((r.expectedAccountId && a?._id !== r.expectedAccountId) || (r.expectedRecipientEmail !== undefined && (!email || email !== r.expectedRecipientEmail))) {
      await queueOwnerNotification(ctx,{eventKey:`refund-owner-changed:${r._id}`,kind:"checkout_failure",bookingId:r.bookingId,title:"Refund contact needs review",body:"The rental contact changed while a refund was settling. Check the payment and contact before notifying the renter."});
      return;
    }
    if (a)
      await postRentalMessage(ctx, {
        accountId: a._id,
        bookingId: b._id,
        sender: "system",
        text: `Rental refund £${(r.amountPence / 100).toFixed(2)}: ${status === "succeeded" ? "confirmed by the payment provider" : status === "failed" ? "failed; the team is checking it" : "processing with the payment provider"}. ${r.reason}`,
      });
    const bound=!!r.expectedAccountId||r.expectedRecipientEmail!==undefined;
    const equipmentChange=typeof r.requestId==="string"&&r.requestId.startsWith("swap-");
    if(status==="succeeded"&&bound&&!equipmentChange&&!r.refundAmbiguity){
      await queueRentalEmail(ctx,b._id,"refund_invoice",{refundId:r._id});
    }else if(status!=="succeeded"||!bound){
      await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
        bookingId: b._id,
        ...(r.expectedAccountId ? { expectedAccountId:r.expectedAccountId } : {}),
        ...(r.expectedRecipientEmail !== undefined ? { expectedRecipientEmail:r.expectedRecipientEmail } : {}),
        ...(bound ? { refundId:r._id } : {}),
        kind: "rental refund",
        detail: `£${(r.amountPence / 100).toFixed(2)} · ${status}. ${r.reason}`,
      });
    }
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
function supersedingSwapRefundRetry(refund: any, paymentIntentId: string, stripeRefundId: string, attemptKey: string | undefined, attemptedAt: number) {
  if (!refund.requestId?.startsWith("swap-")) return null;
  for (const retry of refund.retryHistory ?? []) {
    if (retry.startedAt <= attemptedAt) continue;
    const later = retry.failedParts?.find((part: any) =>
      part.paymentIntentId === paymentIntentId && part.failedRefundId === stripeRefundId && part.attemptKey !== attemptKey,
    );
    if (later) return later;
  }
  return null;
}

async function flagAmbiguousSwapRefund(ctx: any, refund: any, evidence: {
  paymentIntentId: string; successfulRefundId: string; successfulAttemptKey?: string; retryAttemptKey: string;
}) {
  if (!refund.requestId?.startsWith("swap-")) return;
  const now = Date.now();
  const ambiguity = refund.refundAmbiguity ?? { ...evidence, detectedAt: now };
  if (!refund.refundAmbiguity) await ctx.db.patch(refund._id, { refundAmbiguity: ambiguity, updatedAt: now });

  const swap = await ctx.db.get(refund.requestId.slice("swap-".length) as any);
  if (swap?.bookingId !== refund.bookingId) return;
  if (swap) {
    const booking = await ctx.db.get(swap.bookingId);
    if (booking && (booking.activeItemSwapId == null || booking.activeItemSwapId === swap._id)) {
      await ctx.db.patch(booking._id, { activeItemSwapId: swap._id });
    }
    if (swap.status !== "review") {
      await ctx.db.patch(swap._id, {
        status: "review",
        reconcileError: "Stripe reported success for an earlier refund after a retry began.",
        reconcileAfter: undefined,
        reconcileAttempts: 0,
        updatedAt: now,
      });
    }
  }
  await queueOwnerNotification(ctx, {
    eventKey: `swap-refund-ambiguity:${refund._id}:${evidence.paymentIntentId}:${evidence.successfulRefundId}`,
    kind: "checkout_failure",
    bookingId: refund.bookingId,
    title: "Equipment refund attempts need review",
    body: "Stripe confirmed an earlier refund after a retry began. The equipment change is locked. Compare both Stripe receipts before resolving it; no further refund or equipment update will be started automatically.",
  });
}

export const recordRefundPart = internalMutation({
  args: {
    id: v.id("rental_refunds"),
    paymentIntentId: v.string(),
    stripeRefundId: v.string(),
    status: v.string(),
    attemptKey: v.optional(v.string()),
  },
  handler: async (ctx, { id, paymentIntentId, stripeRefundId, status, attemptKey }) => {
    const r = await ctx.db.get(id);
    if (!r) return;
    const previousRefundStatus = r.status;
    const allocation = r.allocations?.find(
      (p) => p.paymentIntentId === paymentIntentId,
    );
    if (!allocation) throw Error("Unknown refund payment source");
    const existing = r.parts?.find(
      (p) => p.paymentIntentId === paymentIntentId,
    );

    const receipts = (r.refundReceipts ?? []).filter((row) => row.paymentIntentId === paymentIntentId);
    const latestReceipt = receipts.sort((a, b) => b.attemptedAt - a.attemptedAt)[0];
    if (latestReceipt && latestReceipt.attemptKey !== attemptKey) {
      if (status === "succeeded") {
        const historical = receipts.find(row => row.attemptKey === attemptKey && row.stripeRefundId === stripeRefundId);
        const retry = supersedingSwapRefundRetry(r, paymentIntentId, stripeRefundId, attemptKey, historical?.attemptedAt ?? Math.max(0, latestReceipt.attemptedAt - 1));
        if (retry) await flagAmbiguousSwapRefund(ctx, r, {
          paymentIntentId,
          successfulRefundId: stripeRefundId,
          ...(attemptKey ? { successfulAttemptKey: attemptKey } : {}),
          retryAttemptKey: retry.attemptKey,
        });
        if (!retry) await queueOwnerNotification(ctx, {
          eventKey: `refund-stale-attempt-success:${r._id}:${paymentIntentId}:${attemptKey ?? "original"}`,
          kind: "checkout_failure",
          bookingId: r.bookingId,
          title: "Refund attempts need review",
          body: "An earlier refund attempt succeeded after a later retry began. Check both Stripe receipts before closing this equipment change.",
        });
      }
      return { ignored: true, staleAttempt: true };
    }
    if (existing && existing.attemptKey === attemptKey && existing.stripeRefundId !== stripeRefundId)
      throw Error("Refund identity mismatch");
    const receiptForAttempt = receipts.find((row) => row.attemptKey === attemptKey && row.stripeRefundId === stripeRefundId);
    // A successful receipt is authoritative even if an older webhook handler
    // later reports the same attempt as failed. Conversely, never regress a
    // terminal failure back to a pending snapshot.
    const reconciledStatus = receiptForAttempt?.status === "succeeded"
      ? "succeeded"
      : receiptForAttempt?.status === "failed" && status === "pending"
        ? "failed"
        : status;
    if (existing && existing.attemptKey === attemptKey && existing.stripeRefundId === stripeRefundId && existing.status === "succeeded" && reconciledStatus !== "succeeded") return { ignored: true, terminalStatus: true };
    if (existing && existing.attemptKey === attemptKey && existing.stripeRefundId === stripeRefundId && existing.status === "failed" && reconciledStatus === "pending") return { ignored: true, terminalStatus: true };
    const parts = [
      ...(r.parts ?? []).filter((p) => p.paymentIntentId !== paymentIntentId),
      {
        paymentIntentId,
        stripeRefundId,
        status: reconciledStatus,
        amountPence: allocation.amountPence,
        ...(attemptKey ? { attemptKey } : {}),
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
    if (aggregate !== "prepared" && aggregate !== previousRefundStatus && !r.refundAmbiguity) {
      const b = await ctx.db.get(r.bookingId);
      if (!b) return;
      const a = await accountForRental(ctx, b);
      const email = (b.accountId ? a?.email : a?.email ?? b.guestEmail)?.trim().toLowerCase() ?? "";
      if ((r.expectedAccountId && a?._id !== r.expectedAccountId) || (r.expectedRecipientEmail !== undefined && (!email || email !== r.expectedRecipientEmail))) {
        await queueOwnerNotification(ctx,{eventKey:`refund-owner-changed:${r._id}`,kind:"checkout_failure",bookingId:r.bookingId,title:"Refund contact needs review",body:"The rental account changed while a refund was settling. Check the payment and contact before notifying the renter."});
        return;
      }
      const equipmentChange = typeof r.requestId === "string" && r.requestId.startsWith("swap-");
      if (equipmentChange) {
        // The swap workflow owns renter-facing settlement updates: it must
        // commit the new basket and shared-stock receipt before saying the
        // change is complete. The generic refund notice could announce success
        // while the old equipment was still on the rental, then duplicate the
        // swap completion/reconciliation message. Only surface a pending state
        // here; success and failure are reported by rentalSwapState.
        if (aggregate === "pending" && a)
          await postRentalMessage(ctx, {
            accountId: a._id,
            bookingId: b._id,
            sender: "system",
            text: `Your £${(r.amountPence / 100).toFixed(2)} equipment-change refund is processing. Your rental still shows the original equipment until the refund settles and the change is applied.`,
          });
      } else {
        if (a)
          await postRentalMessage(ctx, {
            accountId: a._id,
            bookingId: b._id,
            sender: "system",
            text: `Rental refund £${(r.amountPence / 100).toFixed(2)}: ${aggregate}. ${r.reason}`,
          });
        const bound=!!r.expectedAccountId||r.expectedRecipientEmail!==undefined;
        if(aggregate==="succeeded"&&bound){
          await queueRentalEmail(ctx,b._id,"refund_invoice",{refundId:r._id});
        }else{
          await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
            bookingId: b._id,
            ...(r.expectedAccountId ? { expectedAccountId: r.expectedAccountId } : {}),
            ...(r.expectedRecipientEmail !== undefined ? { expectedRecipientEmail: r.expectedRecipientEmail } : {}),
            ...(bound ? { refundId: r._id } : {}),
            kind: "rental refund",
            detail: `£${(r.amountPence / 100).toFixed(2)} · ${aggregate}. ${r.reason}`,
          });
        }
      }
    }
    return { status: aggregate };
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
export const recordRefundReceipt=internalMutation({args:{id:v.id("rental_refunds"),receipt:depositReturnReceipt},handler:async(ctx,{id,receipt})=>{
  const r=await ctx.db.get(id);if(!r)throw Error("Refund missing");
  const allocation=r.allocations?.find(p=>p.paymentIntentId===receipt.paymentIntentId);
  if(!allocation||allocation.amountPence!==receipt.amountPence)throw Error("Refund receipt allocation mismatch");
  if(receipt.attemptKey){
    const retry=r.retryHistory?.find(row=>row.startedAt===receipt.attemptedAt&&row.failedParts.some(part=>part.paymentIntentId===receipt.paymentIntentId&&part.attemptKey===receipt.attemptKey));
    if(!retry)throw Error("Refund retry receipt is not linked to an authorized attempt");
  }else if(receipt.attemptedAt!==r.createdAt)throw Error("Original refund receipt identity cannot be replaced");
  const rows=r.refundReceipts??[],index=rows.findIndex(p=>p.paymentIntentId===receipt.paymentIntentId&&p.attemptKey===receipt.attemptKey),old=index>=0?rows[index]:undefined;
  if(old&&(old.attemptedAt!==receipt.attemptedAt||old.amountPence!==receipt.amountPence||(old.stripeRefundId&&old.stripeRefundId!==receipt.stripeRefundId)||(old.approvalRequestId&&old.approvalRequestId!==receipt.approvalRequestId)))throw Error("Refund attempt identity cannot be replaced");
  if(old&&(old.status==="succeeded"&&receipt.status!=="succeeded"||old.status==="failed"&&receipt.status==="pending"))return {ignored:true,terminalStatus:true};
  const updated=old?{...old,...receipt,...(old.stripeRefundId&&!receipt.stripeRefundId?{stripeRefundId:old.stripeRefundId}:{}),...(old.approvalRequestId&&!receipt.approvalRequestId?{approvalRequestId:old.approvalRequestId}:{}),...(old.approvalUrl&&!receipt.approvalUrl?{approvalUrl:old.approvalUrl}:{})}:receipt;
  await ctx.db.patch(id,{refundReceipts:old?rows.map((row,i)=>i===index?updated:row):[...rows,updated]});
  if (updated.status === "succeeded" && updated.stripeRefundId) {
    const retry = supersedingSwapRefundRetry(r, updated.paymentIntentId, updated.stripeRefundId, updated.attemptKey, updated.attemptedAt);
    if (retry) await flagAmbiguousSwapRefund(ctx, r, {
      paymentIntentId: updated.paymentIntentId,
      successfulRefundId: updated.stripeRefundId,
      ...(updated.attemptKey ? { successfulAttemptKey: updated.attemptKey } : {}),
      retryAttemptKey: retry.attemptKey,
    });
  }
}});

export const resolveSwapRefundAmbiguity=internalMutation({args:{id:v.id("rental_refunds"),paymentIntentId:v.string(),attempts:v.array(v.object({stripeRefundId:v.string(),status:v.string(),attemptKey:v.optional(v.string())})),reason:v.string()},handler:async(ctx,args)=>{
  const refund=await ctx.db.get(args.id),reason=args.reason.trim();
  if(!refund||!refund.requestId?.startsWith("swap-")||refund.refundAmbiguity?.paymentIntentId!==args.paymentIntentId||reason.length<5||reason.length>400)throw Error("The equipment refund ambiguity is not ready to resolve.");
  const receipts=refund.refundReceipts??[],known=receipts.filter((row:any)=>row.paymentIntentId===args.paymentIntentId);
  if(!known.length||known.length!==args.attempts.length||new Set(args.attempts.map(row=>row.stripeRefundId)).size!==args.attempts.length)throw Error("The Stripe receipt list changed. Sync the attempts again.");
  const checked=known.map((receipt:any)=>{
    const result=args.attempts.find(row=>row.stripeRefundId===receipt.stripeRefundId&&row.attemptKey===receipt.attemptKey);
    if(!result||!( ["succeeded","failed"].includes(result.status))||!receipt.stripeRefundId)throw Error("Every Stripe refund attempt must have a terminal, matching receipt before resolution.");
    return {...receipt,status:result.status};
  });
  const successes=checked.filter((row:any)=>row.status==="succeeded");
  if(successes.length!==1||successes[0].stripeRefundId!==refund.refundAmbiguity.successfulRefundId||successes[0].attemptKey!==refund.refundAmbiguity.successfulAttemptKey)throw Error("The receipts do not confirm exactly one successful refund. Keep the equipment change locked and review Stripe.");
  const winner=successes[0],allocation=refund.allocations?.find((row:any)=>row.paymentIntentId===args.paymentIntentId);
  if(!allocation||allocation.amountPence!==winner.amountPence)throw Error("The successful Stripe refund does not match its original payment allocation.");
  const updatedReceipts=receipts.map((row:any)=>row.paymentIntentId===args.paymentIntentId?checked.find((attempt:any)=>attempt.stripeRefundId===row.stripeRefundId&&attempt.attemptKey===row.attemptKey)??row:row);
  const parts=[...(refund.parts??[]).filter((row:any)=>row.paymentIntentId!==args.paymentIntentId),{paymentIntentId:args.paymentIntentId,stripeRefundId:winner.stripeRefundId,status:"succeeded",amountPence:allocation.amountPence,...(winner.attemptKey?{attemptKey:winner.attemptKey}:{})}];
  const aggregate=parts.length!==(refund.allocations??[]).length?"prepared":parts.every((part:any)=>part.status==="succeeded")?"succeeded":parts.some((part:any)=>part.status==="pending")?"pending":"failed";
  const resolvedAt=Date.now();
  await ctx.db.patch(refund._id,{refundReceipts:updatedReceipts,parts,status:aggregate,refundAmbiguity:undefined,refundAmbiguityResolution:{resolvedAt,reason,successfulRefundId:winner.stripeRefundId,...(winner.attemptKey?{successfulAttemptKey:winner.attemptKey}:{})},updatedAt:resolvedAt});
  return {status:aggregate,successfulRefundId:winner.stripeRefundId};
}});
