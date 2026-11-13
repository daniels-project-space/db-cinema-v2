import {depositRefundProjection} from "../shared/depositRefundStatus";
import {rentalControlsSnapshot} from "./lib/rentalControlsSnapshot";
import { query, mutation, internalQuery, type QueryCtx, type MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { checkAdminToken, assertAdmin } from "./adminAuth";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { lateFeeQuote } from "./lib/lateFee";
import { returnInspectionSchedule } from "./lib/returnInspection";
import { inspectionInput } from "./lib/returnInspectionFields";
import { normalizeReturnInspection, sameReturnInspection } from "../shared/returnInspection";
import { listingRentalImages } from "./lib/catalogImages";
import { accountForRental } from "./lib/rentalAccount";
import { archiveRetention } from "./verificationArchive";
import { archiveCaseConversation } from "./lib/chatCaseArchive";
import { adminSessionMigrationReady, assertAdminScopeSession } from "./adminAccountSessionV2";
import type { InspectionItem } from "../shared/returnInspection";
import { bumpVerificationRetentionRevision } from "./lib/verificationRetentionRevision";

async function caseAdminRead(ctx:QueryCtx,token:string) {
  if(process.env.ADMIN_SESSION_RENTAL_CASES_V2==="enabled") {
    if(!adminSessionMigrationReady())throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx,token,"rentals:read");
  } else if(!checkAdminToken(token))throw Error("unauthorized");
}
async function caseAdminWrite(ctx:MutationCtx,token:string,fn:string) {
  if(process.env.ADMIN_SESSION_RENTAL_CASES_V2==="enabled") {
    if(!adminSessionMigrationReady())throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx,token,"rentals:write");
    await ctx.db.insert("admin_audit_log",{at:Date.now(),success:true,limited:false,fn});
  } else await assertAdmin(ctx,token,fn);
}

/** Presentation only: a kit's photograph cannot stand in for one component.
 * Keep the reserved/frozen equipment identity separate from editable photos. */
async function inspectionDisplay(ctx: any, booking: any, items: InspectionItem[]) {
  const listings = new Map<string, any>();
  for (const line of booking.lineItems ?? []) {
    if (line.listingId && !listings.has(String(line.listingId))) listings.set(String(line.listingId), await ctx.db.get(line.listingId));
  }
  return items.map(item => {
    let listing: any;
    if (item.inventoryUnitId) {
      const name = item.title.replace(/ · item \d+ of \d+$/, "").trim().toLowerCase();
      listing = [...listings.values()].find(l => l?.isPackage !== true && l?.title?.trim().toLowerCase() === name && l?.components?.length === 1 && l.components[0].qty === 1 && String(l.components[0].inventoryUnitId) === String(item.inventoryUnitId));
    } else if (item.key.startsWith("legacy:")) {
      const line = booking.lineItems?.[Number(item.key.split(":")[1])];
      listing = line && listings.get(String(line.listingId));
    }
    return { ...item, imageSources: listingRentalImages(listing) };
  });
}

export const validate = internalQuery({ args: { bookingId: v.id("bookings"), inspection: v.array(inspectionInput), damage: v.number() }, handler: async (ctx, args) => {
  const booking = await ctx.db.get(args.bookingId);
  if (!booking) throw Error("Rental not found");
  const inspection = normalizeReturnInspection(await returnInspectionSchedule(ctx, booking), args.inspection, args.damage);
  if (booking.returnDecision && !sameReturnInspection(booking.returnDecision.inspection, inspection)) throw Error("Resume the saved item inspection; its decision cannot be changed during settlement.");
  return inspection;
} });

export const schedule = query({ args: { token: v.string(), bookingId: v.id("bookings") }, handler: async (ctx, args) => {
  await caseAdminRead(ctx,args.token);
  const booking = await ctx.db.get(args.bookingId);
  if (!booking) throw Error("Rental not found");
  const items = await returnInspectionSchedule(ctx, booking);
  return { items: await inspectionDisplay(ctx, booking, items), legacy: items.some(i => i.key.startsWith("legacy:")), inspection: booking.returnDecision?.inspection ?? [], cases: await ctx.db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", args.bookingId)).collect() };
} });
async function assertCaseRetentionAvailable(ctx: any, booking: any) {
  const links = await ctx.db.query("verification_archive_links").withIndex("by_booking", (q:any) => q.eq("bookingId", booking._id)).take(31);
  if (links.length > 30) throw Error("Verification archive links need manual review before opening this case.");
  const sourceIds = [...new Set([String(booking._id), ...(booking.verificationReusedFrom ? [String(booking.verificationReusedFrom)] : []), ...links.map((link:any) => String(link.sourceBookingId))])];
  let retainedArchive = false;
  for (const sourceId of sourceIds) {
    const archives = await ctx.db.query("verification_archives").withIndex("by_booking", (q:any) => q.eq("bookingId", sourceId)).take(31);
    if (archives.length > 30) throw Error("Verification archives need manual review before opening this case.");
    for (const archive of archives) if (archive.status !== "deleted") {
      const retention = await archiveRetention(ctx, archive);
      if ("needsReview" in retention && retention.needsReview) throw Error("Verification retention needs manual review before opening this case.");
      if (!retention.viewable) throw Error("Verification retention has already expired. Review document deletion before opening this case; expired copies cannot be revived.");
      retainedArchive = true;
    }
  }
  if (booking.status === "returned" && !retainedArchive && (!Number.isFinite(booking.returnedAt) || booking.returnedAt <= Date.now() - 90 * 86400000)) throw Error("Verification retention has already expired or its closure date is unknown. Review this case before opening it; expired copies cannot be revived.");
}
export const openCase = mutation({ args: { token: v.string(), bookingId: v.id("bookings"), itemKey: v.string(), caseType:v.optional(v.union(v.literal("damage"),v.literal("loss"),v.literal("theft"),v.literal("insurance_follow_up"),v.literal("other"))), details: v.string(), requestId: v.string(), confirmed: v.boolean(), reviewedMatches:v.optional(v.array(v.object({id:v.id("rental_damage_cases"),status:v.union(v.literal("open"),v.literal("closed")),openedAt:v.number()}))) }, handler: async (ctx, args) => {
  await caseAdminWrite(ctx, args.token, "returnInspections.openCase");
  const details = args.details.trim();
  const caseType=args.caseType??"damage";
  if (!args.confirmed || details.length < 10 || details.length > 2000 || !/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId)) throw Error("Review the item and record an issue of 10–2000 characters before confirming.");
  const prior = await ctx.db.query("rental_damage_cases").withIndex("by_booking_request", q => q.eq("bookingId", args.bookingId).eq("requestId", args.requestId)).unique();
  if (prior) {
    if (prior.itemKey !== args.itemKey || prior.details !== details || (prior.caseType??"damage")!==caseType) throw Error("This case request belongs to different details.");
    await archiveCaseConversation(ctx, prior);
    return prior._id;
  }
  const records=await ctx.db.query("rental_damage_cases").withIndex("by_booking_item",q=>q.eq("bookingId",args.bookingId).eq("itemKey",args.itemKey)).take(101);
  if(records.length>100)throw Error("This item's case history needs team review before another case can be opened.");
  const matching=records.filter(record=>record.details.trim()===details).sort((left,right)=>String(left._id).localeCompare(String(right._id)));
  const reviewed=[...(args.reviewedMatches??[])].sort((left,right)=>String(left.id).localeCompare(String(right.id)));
  if(new Set(reviewed.map(record=>String(record.id))).size!==reviewed.length||matching.length!==reviewed.length||matching.some((record,index)=>String(record._id)!==String(reviewed[index].id)||record.status!==reviewed[index].status||record.openedAt!==reviewed[index].openedAt))throw new ConvexError({code:"CASE_MATCH_REVIEW",matches:matching.map(record=>({id:record._id,status:record.status,openedAt:record.openedAt}))});
  const booking = await ctx.db.get(args.bookingId);
  if (!booking || !["confirmed", "active", "returned"].includes(booking.status)) throw Error("Only a confirmed, active or returned rental can have an internal case.");
  const item = (await returnInspectionSchedule(ctx, booking)).find(value => value.key === args.itemKey);
  if (!item) throw Error("The selected rental item is no longer available for a case.");
  await assertCaseRetentionAvailable(ctx,booking);
  const account = await accountForRental(ctx, booking);
  const openedAt = Date.now();
  const id = await ctx.db.insert("rental_damage_cases", { bookingId: booking._id, ...(account ? { accountId: account._id } : {}), itemKey: item.key, title: item.title, ...(item.inventoryUnitId ? { inventoryUnitId: item.inventoryUnitId as any } : {}), caseType, details, status: "open", openedAt, requestId: args.requestId });
  await bumpVerificationRetentionRevision(ctx,booking);
  await archiveCaseConversation(ctx, { _id: id, bookingId: booking._id, ...(account ? { accountId: account._id } : {}), openedAt });
  await queueRmv2Sync(ctx, booking._id);
  return id;
} });
export const closeCase = mutation({ args: { token: v.string(), caseId: v.id("rental_damage_cases"), resolution: v.string(), bookingId: v.id("bookings"), confirmed: v.boolean(), expectedVersion:v.optional(v.number()) }, handler: async (ctx, args) => {
  await caseAdminWrite(ctx, args.token, "returnInspections.closeCase");
  const resolution=args.resolution.trim();
  if (!args.confirmed || resolution.length < 10 || resolution.length > 2000) throw Error("Review and confirm a resolution of 10–2000 characters.");
  const record = await ctx.db.get(args.caseId);
  if (!record) throw Error("Case not found");
  if (record.bookingId !== args.bookingId) throw Error("Case does not belong to this rental");
  if(!Number.isSafeInteger(record.lifecycleVersion??0)||(record.lifecycleVersion??0)<0)throw Error("Case lifecycle needs review.");
  if((record.lifecycleVersion??0)!==(args.expectedVersion??0))throw Error("This case changed. Review its current status before closing.");
  if (record.status === "closed") {if(record.resolution!==resolution)throw Error("This case was already closed with a different resolution.");return;}
  await ctx.db.patch(record._id, { status: "closed", resolution, closedAt: Date.now() });
  await bumpVerificationRetentionRevision(ctx,await ctx.db.get(record.bookingId));
  await queueRmv2Sync(ctx, record.bookingId);
} });

export const caseUpdates = query({args:{token:v.string(),bookingId:v.id("bookings"),caseId:v.id("rental_damage_cases")},handler:async(ctx,args)=>{
  await caseAdminRead(ctx,args.token);
  const record=await ctx.db.get(args.caseId);if(!record||record.bookingId!==args.bookingId)throw Error("Case unavailable.");
  const updates=await ctx.db.query("rental_case_updates").withIndex("by_case",q=>q.eq("caseId",args.caseId)).take(101);
  if(updates.length>100)throw Error("Case update history needs review.");
  return updates;
}});

export const caseReopens = query({args:{token:v.string(),bookingId:v.id("bookings"),caseId:v.id("rental_damage_cases")},handler:async(ctx,args)=>{
  await caseAdminRead(ctx,args.token);
  const record=await ctx.db.get(args.caseId);if(!record||record.bookingId!==args.bookingId)throw Error("Case unavailable.");
  const events=await ctx.db.query("rental_case_reopens").withIndex("by_case",q=>q.eq("caseId",args.caseId)).take(101);
  if(events.length>100)throw Error("Case reopening history needs review.");
  return events;
}});

export const exportCaseSummary = mutation({args:{token:v.string(),bookingId:v.id("bookings"),caseId:v.id("rental_damage_cases"),expectedVersion:v.number(),confirmed:v.boolean()},handler:async(ctx,args)=>{
  await caseAdminWrite(ctx,args.token,"returnInspections.exportCaseSummary");
  if(!args.confirmed)throw Error("Confirm that this private case summary will be downloaded.");
  const record=await ctx.db.get(args.caseId);if(!record||record.bookingId!==args.bookingId)throw Error("Case unavailable.");
  if(!Number.isSafeInteger(args.expectedVersion)||args.expectedVersion<0||(record.lifecycleVersion??0)!==args.expectedVersion)throw Error("This case changed. Review it before downloading.");
  const updates=await ctx.db.query("rental_case_updates").withIndex("by_case",q=>q.eq("caseId",args.caseId)).take(101);
  const reopens=await ctx.db.query("rental_case_reopens").withIndex("by_case",q=>q.eq("caseId",args.caseId)).take(101);
  if(updates.length>100||reopens.length>100)throw Error("Case history needs review before exporting.");
  const timestamp=(value:number|undefined)=>value!==undefined&&Number.isFinite(value)&&Number.isFinite(new Date(value).getTime())&&value>0?new Date(value).toISOString():"Missing or invalid";
  const history=[...updates.map(update=>({at:update.addedAt,text:`Update (${timestamp(update.addedAt)}):\n${update.details}`})),...reopens.map(event=>({at:event.reopenedAt,text:`Reopened (${timestamp(event.reopenedAt)}):\n${event.reason}\nPrevious resolution (${timestamp(event.previousClosedAt)}):\n${event.previousResolution}`}))].sort((left,right)=>left.at-right.at);
  const caseType=record.caseType??"damage";
  const caseLabel=caseType==="insurance_follow_up"?"Insurance follow-up (internal)":caseType.charAt(0).toUpperCase()+caseType.slice(1);
  const report=["DB CINEMA RENTALS — PRIVATE INTERNAL CASE SUMMARY","This is not an insurer claim. Identity documents and chat attachments are not included.",`Rental ID: ${args.bookingId}`,`Case ID: ${args.caseId}`,`Case type: ${caseLabel}`,`Item: ${record.title}`,`Status: ${record.status}`,`Opened: ${timestamp(record.openedAt)}`,`Issue:\n${record.details}`,record.status==="closed"?`Closed: ${timestamp(record.closedAt)}\nResolution:\n${record.resolution??"Not recorded"}`:"",...history.map(item=>item.text),`Generated: ${timestamp(Date.now())}`].filter(Boolean).join("\n\n");
  return {report};
}});

export const reopenCase = mutation({args:{token:v.string(),bookingId:v.id("bookings"),caseId:v.id("rental_damage_cases"),requestId:v.string(),reason:v.string(),expectedClosedAt:v.number(),expectedResolution:v.string(),expectedVersion:v.number(),confirmed:v.boolean()},handler:async(ctx,args)=>{
  await caseAdminWrite(ctx,args.token,"returnInspections.reopenCase");
  const reason=args.reason.trim();if(!args.confirmed||reason.length<10||reason.length>2000||!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId))throw Error("Review and confirm a reopening reason of 10–2000 characters.");
  const record=await ctx.db.get(args.caseId);if(!record||record.bookingId!==args.bookingId)throw Error("Case unavailable.");
  const prior=await ctx.db.query("rental_case_reopens").withIndex("by_case_request",q=>q.eq("caseId",args.caseId).eq("requestId",args.requestId)).unique();
  if(prior){if(prior.bookingId!==args.bookingId||prior.reason!==reason||prior.previousClosedAt!==args.expectedClosedAt||prior.previousResolution!==args.expectedResolution||prior.previousVersion!==args.expectedVersion)throw Error("This reopening request belongs to different details.");await archiveCaseConversation(ctx,record);return {status:"replayed" as const};}
  if(record.status!=="closed"||record.closedAt!==args.expectedClosedAt||record.resolution!==args.expectedResolution||(record.lifecycleVersion??0)!==args.expectedVersion)throw Error("This case changed. Review its current status before reopening.");
  if(!Number.isSafeInteger(args.expectedVersion)||args.expectedVersion<0||args.expectedVersion>=Number.MAX_SAFE_INTEGER)throw Error("Case lifecycle needs review.");
  if(!Number.isFinite(record.openedAt)||record.openedAt<=0||!Number.isFinite(record.closedAt)||record.closedAt!<record.openedAt||record.closedAt!>Date.now()||!record.resolution)throw Error("Case closure needs review before reopening.");
  const booking=await ctx.db.get(args.bookingId);if(!booking||!["confirmed","active","returned"].includes(booking.status))throw Error("This rental cannot have a reopened case.");
  await assertCaseRetentionAvailable(ctx,booking);
  const history=await ctx.db.query("rental_case_reopens").withIndex("by_case",q=>q.eq("caseId",args.caseId)).take(100);if(history.length>=100)throw Error("Case reopening history needs review.");
  await archiveCaseConversation(ctx,record);
  await ctx.db.insert("rental_case_reopens",{caseId:args.caseId,bookingId:args.bookingId,requestId:args.requestId,reason,previousClosedAt:record.closedAt!,previousResolution:record.resolution,previousVersion:args.expectedVersion,reopenedAt:Date.now()});
  await ctx.db.patch(record._id,{status:"open",closedAt:undefined,resolution:undefined,lifecycleVersion:(record.lifecycleVersion??0)+1});
  await bumpVerificationRetentionRevision(ctx,booking);
  await queueRmv2Sync(ctx,record.bookingId);
  return {status:"reopened" as const};
}});

export const addCaseUpdate = mutation({args:{token:v.string(),bookingId:v.id("bookings"),caseId:v.id("rental_damage_cases"),details:v.string(),requestId:v.optional(v.string()),confirmed:v.boolean()},handler:async(ctx,args)=>{
  await caseAdminWrite(ctx,args.token,"returnInspections.addCaseUpdate");
  const details=args.details.trim();if(!args.confirmed||details.length<10||details.length>2000||(args.requestId!==undefined&&!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId)))throw Error("Review and confirm an update of 10–2000 characters.");
  const record=await ctx.db.get(args.caseId);if(!record||record.bookingId!==args.bookingId)throw Error("Case unavailable.");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(details));
  const fingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
  const prior=args.requestId ? await ctx.db.query("rental_case_updates").withIndex("by_case_request",q=>q.eq("caseId",args.caseId).eq("requestId",args.requestId)).unique() : (await ctx.db.query("rental_case_updates").withIndex("by_case_fingerprint",q=>q.eq("caseId",args.caseId).eq("fingerprint",fingerprint)).take(101)).find(update=>!update.requestId);
  if(prior){if(prior.details!==details||prior.bookingId!==args.bookingId)throw Error("Case update needs review.");return prior._id;}
  if(record.status!=="open")throw Error("Only an open case can receive a new update.");
  const existing=await ctx.db.query("rental_case_updates").withIndex("by_case",q=>q.eq("caseId",args.caseId)).take(101);
  if(existing.length>=100)throw Error("Case update history needs review before adding more.");
  return ctx.db.insert("rental_case_updates",{caseId:args.caseId,bookingId:args.bookingId,details,fingerprint,...(args.requestId?{requestId:args.requestId}:{}),addedAt:Date.now()});
}});

/** Safe cross-app admin inspection context; Stripe identifiers stay server-side. */
export const context = query({ args: {token:v.string(),bookingId:v.id("bookings"),actualReturnedAt:v.optional(v.number())}, handler:async(ctx,args)=>{
  if(process.env.ADMIN_SESSION_RETURN_CONTEXT_V2==="enabled") {
    if(!adminSessionMigrationReady())throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx,args.token,"rentals:read");
    await assertAdminScopeSession(ctx,args.token,"payments:read");
  } else if(!checkAdminToken(args.token))throw Error("unauthorized");
  const b=await ctx.db.get(args.bookingId);if(!b)throw Error("Rental not found");
  const items=await returnInspectionSchedule(ctx,b);
  const refunds=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",b._id)).take(101);if(refunds.length>100)throw Error("Refund history requires review.");
  return {bookingId:b._id,status:b.status,guestName:b.guestName??null,lineItems:b.lineItems,returnTime:b.returnTime??null,
    securityPolicyVersion:b.securityPolicyVersion??null,savedCardLimit:b.savedCardLimit??0,
    replacementValue:b.lineItems.reduce((sum,line)=>sum+(b.replacementValues?.find(value=>value.listingId===line.listingId)?.unitPence??0)*line.qty/100,0),
    depositAmount:b.depositAmount,depositHoldAmount:b.depositHoldAmount??0,depositHoldStatus:b.depositHoldStatus??null,
    depositRefunded:b.depositRefunded??false,depositRefundAmount:b.depositRefundAmount??0,depositKept:b.depositKept??0,
    depositSettlement:{...depositRefundProjection(b),snapshot:rentalControlsSnapshot(b,refunds)},
    returnDecision:b.returnDecision??null,returnStatement:b.returnStatement??null,
    settlementEmailStatus:b.returnStatementEmailStatus??null,
    lateQuote:lateFeeQuote(b.lineItems,b.returnTime??null,args.actualReturnedAt??b.returnDecision?.actualReturnedAt??Date.now()),
    items:await inspectionDisplay(ctx,b,items),legacy:items.some(i=>i.key.startsWith("legacy:")),cases:await ctx.db.query("rental_damage_cases").withIndex("by_booking",q=>q.eq("bookingId",b._id)).collect()};
} });
