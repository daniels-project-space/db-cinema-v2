import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { queueOwnerNotification } from "./lib/adminPush";
import { accountForRental } from "./lib/rentalAccount";
const LEASE_MS=10*60_000, MAX_ATTEMPTS=8;

async function current(ctx: QueryCtx | MutationCtx, row: Doc<"rental_email_deliveries">) {
  const b=await ctx.db.get(row.bookingId); if(!b)return false;
  const account=await accountForRental(ctx,b);
  const recipient=account?.email ?? (b.accountId ? null : b.guestEmail);
  if(!recipient || (row.recipientEmail && row.recipientEmail!==recipient)) return false;
  if(row.kind === "cancellation")return b.status === "cancelled";
  if(row.kind === "verification") {
    const latest=(await ctx.db.query("rental_email_deliveries").withIndex("by_booking_kind",q=>q.eq("bookingId",b._id).eq("kind","verification")).order("desc").take(1))[0];
    return latest?._id===row._id && b.idVerifyStatus === row.verificationStatus && ["confirmed","active"].includes(b.status);
  }
  if(row.kind === "payment")return ["confirmed","active"].includes(b.status);
  // A payment receipt remains useful after a paid rental is returned/cancelled.
  return ["confirmed","active","returned","cancelled"].includes(b.status) && !!(b.stripePaymentIntentId || b.total === 0);
}
async function flagFailure(ctx:MutationCtx,row:Doc<"rental_email_deliveries">) {
 const booking=await ctx.db.get(row.bookingId),account=await accountForRental(ctx,booking);
 if(account)await queueOwnerNotification(ctx,{eventKey:`rental-email-failed:${row._id}`,kind:"email_failure",accountId:account._id,bookingId:row.bookingId,
  title:"Booking email needs attention",body:`The ${row.kind} notice could not be sent after ${row.attempts} attempts. Open this rental to follow up with the renter.`});
}
async function dispatch(ctx:MutationCtx,id:Id<"rental_email_deliveries">) {
  const row=await ctx.db.get(id),now=Date.now();
  if(!row || !["pending","sending"].includes(row.state) || row.dueAt>now)return false;
  if(!await current(ctx,row)){await ctx.db.patch(id,{state:"skipped",updatedAt:now,lastError:"Notice no longer applicable"});return false;}
  if(row.attempts>=MAX_ATTEMPTS){await ctx.db.patch(id,{state:"failed",updatedAt:now,lastError:"Delivery attempts exhausted; requires support"});await flagFailure(ctx,row);return false;}
  const generation=row.generation+1;
  await ctx.db.patch(id,{state:"sending",attempts:row.attempts+1,generation,dueAt:now+LEASE_MS,updatedAt:now});
  await ctx.scheduler.runAfter(0,internal.rentalEmailMail.deliver,{deliveryId:id,generation});return true;
}
export const dispatchOne=internalMutation({args:{deliveryId:v.id("rental_email_deliveries")},handler:async(ctx,a)=>dispatch(ctx,a.deliveryId)});
export const dispatchDue=internalMutation({args:{},handler:async ctx=>{
  let dispatched=0;
  for(const state of ["pending","sending"] as const){
    const rows=await ctx.db.query("rental_email_deliveries").withIndex("by_state_due",q=>q.eq("state",state).lte("dueAt",Date.now())).take(20);
    for(const row of rows)if(await dispatch(ctx,row._id))dispatched++;
  }return {dispatched};
}});
export const ready=internalQuery({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number()},handler:async(ctx,a)=>{
  const row=await ctx.db.get(a.deliveryId);
  return row && row.state === "sending" && row.generation===a.generation && row.dueAt>Date.now() && await current(ctx,row) ? row : null;
}});
export const finish=internalMutation({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number(),result:v.union(v.literal("sent"),v.literal("retry"),v.literal("skipped"))},handler:async(ctx,a)=>{
  const row=await ctx.db.get(a.deliveryId);
  if(!row || row.state!=="sending" || row.generation!==a.generation || row.dueAt<=Date.now())return false;
  const now=Date.now(),failed=a.result==="retry" && row.attempts>=MAX_ATTEMPTS;
  await ctx.db.patch(row._id,{state:a.result==="retry"?(failed?"failed":"pending"):a.result,
    updatedAt:now,sentAt:a.result==="sent"?now:undefined,
    dueAt:a.result==="retry"?now+Math.min(6*60,2**(row.attempts-1))*60_000:now,
    lastError:a.result==="retry"?(failed?"Delivery attempts exhausted; requires support":"Transport did not accept email"):undefined});
  if(failed)await flagFailure(ctx,row);
  return true;
}});

/** Attach the immutable prepared message before any provider send. */
export const prepare=internalMutation({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number(),storageId:v.id("_storage"),recipientEmail:v.string()},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.deliveryId);
 if(!row || row.state!=="sending" || row.generation!==a.generation || row.dueAt<=Date.now() || !await current(ctx,row))return null;
 const booking=await ctx.db.get(row.bookingId),account=await accountForRental(ctx,booking);
 if(a.recipientEmail!==(account?.email ?? (booking?.accountId ? null : booking?.guestEmail)))return null;
 if(row.payloadStorageId)return row.payloadStorageId;
 await ctx.db.patch(row._id,{payloadStorageId:a.storageId,recipientEmail:a.recipientEmail,updatedAt:Date.now()});return a.storageId;
}});
