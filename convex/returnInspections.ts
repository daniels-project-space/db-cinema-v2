import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken, assertAdmin } from "./adminAuth";
import { lateFeeQuote } from "./lib/lateFee";
import { returnInspectionSchedule } from "./lib/returnInspection";
import { inspectionInput } from "./lib/returnInspectionFields";
import { normalizeReturnInspection } from "../shared/returnInspection";

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
  return { items, legacy: items.some(i => i.key.startsWith("legacy:")), inspection: booking.returnDecision?.inspection ?? [], cases: await ctx.db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", args.bookingId)).collect() };
} });
export const closeCase = mutation({ args: { token: v.string(), caseId: v.id("rental_damage_cases"), resolution: v.string() }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "returnInspections.closeCase");
  if (args.resolution.trim().length < 10) throw Error("Record how the case was resolved.");
  const record = await ctx.db.get(args.caseId);
  if (!record) throw Error("Case not found");
  if (record.status === "closed") return;
  await ctx.db.patch(record._id, { status: "closed", resolution: args.resolution.trim().slice(0, 2000), closedAt: Date.now() });
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
    settlementEmailStatus:b.lateFeeReceiptEmailStatus??null,
    lateQuote:lateFeeQuote(b.lineItems,b.returnTime??null,args.actualReturnedAt??b.returnDecision?.actualReturnedAt??Date.now()),
    items,legacy:items.some(i=>i.key.startsWith("legacy:")),cases:await ctx.db.query("rental_damage_cases").withIndex("by_booking",q=>q.eq("bookingId",b._id)).collect()};
} });
