import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken, assertAdmin } from "./adminAuth";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { lateFeeQuote } from "./lib/lateFee";
import { returnInspectionSchedule } from "./lib/returnInspection";
import { inspectionInput } from "./lib/returnInspectionFields";
import { normalizeReturnInspection } from "../shared/returnInspection";
import { listingImages } from "./lib/catalogImages";
import type { InspectionItem } from "../shared/returnInspection";

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
      listing = [...listings.values()].find(l => l?.isPackage !== true && l?.title?.trim().toLowerCase() === name && l?.components?.length === 1 && l.components[0].qty === 1 && String(l.components[0].inventoryUnitId) === String(item.inventoryUnitId) && listingImages(l).length);
    } else if (item.key.startsWith("legacy:")) {
      const line = booking.lineItems?.[Number(item.key.split(":")[1])];
      listing = line && listings.get(String(line.listingId));
    }
    return { ...item, imageSources: listingImages(listing) };
  });
}

export const validate = internalQuery({ args: { bookingId: v.id("bookings"), inspection: v.array(inspectionInput), damage: v.number() }, handler: async (ctx, args) => {
  const booking = await ctx.db.get(args.bookingId);
  if (!booking) throw Error("Rental not found");
  const inspection = normalizeReturnInspection(await returnInspectionSchedule(ctx, booking), args.inspection, args.damage);
  if (booking.returnDecision && JSON.stringify(booking.returnDecision.inspection ?? null) !== JSON.stringify(inspection)) throw Error("Resume the saved item inspection; its decision cannot be changed during settlement.");
  return inspection;
} });

export const schedule = query({ args: { token: v.string(), bookingId: v.id("bookings") }, handler: async (ctx, args) => {
  if (!checkAdminToken(args.token)) throw Error("unauthorized");
  const booking = await ctx.db.get(args.bookingId);
  if (!booking) throw Error("Rental not found");
  const items = await returnInspectionSchedule(ctx, booking);
  return { items: await inspectionDisplay(ctx, booking, items), legacy: items.some(i => i.key.startsWith("legacy:")), inspection: booking.returnDecision?.inspection ?? [], cases: await ctx.db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", args.bookingId)).collect() };
} });
export const closeCase = mutation({ args: { token: v.string(), caseId: v.id("rental_damage_cases"), resolution: v.string(), bookingId: v.optional(v.id("bookings")) }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "returnInspections.closeCase");
  if (args.resolution.trim().length < 10) throw Error("Record how the case was resolved.");
  const record = await ctx.db.get(args.caseId);
  if (!record) throw Error("Case not found");
  if (args.bookingId && record.bookingId !== args.bookingId) throw Error("Case does not belong to this rental");
  if (record.status === "closed") return;
  await ctx.db.patch(record._id, { status: "closed", resolution: args.resolution.trim().slice(0, 2000), closedAt: Date.now() });
  await queueRmv2Sync(ctx, record.bookingId);
} });

/** Safe cross-app admin inspection context; Stripe identifiers stay server-side. */
export const context = query({ args: {token:v.string(),bookingId:v.id("bookings"),actualReturnedAt:v.optional(v.number())}, handler:async(ctx,args)=>{
  if(!checkAdminToken(args.token))throw Error("unauthorized");
  const b=await ctx.db.get(args.bookingId);if(!b)throw Error("Rental not found");
  const items=await returnInspectionSchedule(ctx,b);
  return {bookingId:b._id,status:b.status,guestName:b.guestName??null,lineItems:b.lineItems,returnTime:b.returnTime??null,
    depositAmount:b.depositAmount,depositHoldAmount:b.depositHoldAmount??0,depositHoldStatus:b.depositHoldStatus??null,
    depositRefunded:b.depositRefunded??false,depositRefundAmount:b.depositRefundAmount??0,depositKept:b.depositKept??0,
    returnDecision:b.returnDecision??null,returnStatement:b.returnStatement??null,
    settlementEmailStatus:b.returnStatementEmailStatus??null,
    lateQuote:lateFeeQuote(b.lineItems,b.returnTime??null,args.actualReturnedAt??b.returnDecision?.actualReturnedAt??Date.now()),
    items:await inspectionDisplay(ctx,b,items),legacy:items.some(i=>i.key.startsWith("legacy:")),cases:await ctx.db.query("rental_damage_cases").withIndex("by_booking",q=>q.eq("bookingId",b._id)).collect()};
} });
