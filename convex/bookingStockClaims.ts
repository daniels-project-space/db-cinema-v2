import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { swapAuthorityAvailable } from "./lib/rentalSwapAuthority";
import { bookingClaimItems, bookingReadyForStockClaim } from "./lib/bookingStockClaim";
import { queueOwnerNotification } from "./lib/adminPush";

export const bookingClaimEnabled=()=>swapAuthorityAvailable() && process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL==="true";
const enabled=bookingClaimEnabled;
const find=(ctx:any,bookingId:any)=>ctx.db.query("booking_stock_claims").withIndex("by_booking",(query:any)=>query.eq("bookingId",bookingId)).unique();
async function notifyReview(ctx:any,claim:any){
  await queueOwnerNotification(ctx,{eventKey:`booking-stock-claim-review:${claim._id}`,kind:"checkout_failure",bookingId:claim.bookingId,title:"Booking stock needs review",body:"A booking stock claim could not be reconciled. Check the booking and Rental Manager before changing or releasing stock."});
}
export async function reviewOutstandingBookingClaim(ctx:any,bookingId:any){
  const claim=await find(ctx,bookingId);
  if(!claim||claim.state==="applied"||claim.state==="review")return;
  await ctx.db.patch(claim._id,{state:"review",leaseToken:undefined,leaseUntil:undefined,updatedAt:Date.now()});
  await notifyReview(ctx,claim);
}

export async function assertBookingClaimExecution(ctx:any,booking:any,paymentIntentId?:string){
  const claim=await find(ctx,booking._id);
  if(!claim||claim.state!=="executed"||!claim.managerRequestId||!claim.fingerprint||!bookingReadyForStockClaim(booking,claim.sessionId,paymentIntentId)||claim.paymentIntentId!==paymentIntentId||JSON.stringify(await bookingClaimItems(ctx,booking))!==JSON.stringify(claim.items))throw Error("Booking stock execution needs reconciliation.");
  return claim;
}

export async function recordBookingStockApplication(ctx:any,bookingId:any,claim:any){
  const booking=await ctx.db.get(bookingId),allocations=await ctx.db.query("reservations").withIndex("by_booking",(query:any)=>query.eq("bookingId",bookingId)).collect();
  if(!booking||!Number.isSafeInteger(booking.rmv2Revision)||booking.status!=="confirmed")throw Error("Booking stock application needs reconciliation.");
  const windows=[];
  for(const allocation of allocations.filter((row:any)=>row.source==="site"&&row.status==="confirmed")){
    const unit=await ctx.db.get(allocation.inventoryUnitId);
    if(!unit?.rmv2ItemId||allocation.endExclusive!==true||allocation.turnaroundBufferMinutes!==60||!Number.isSafeInteger(allocation.start)||!Number.isSafeInteger(allocation.end)||!Number.isSafeInteger(allocation.qty)||allocation.qty<1)throw Error("Booking stock allocation needs reconciliation.");
    windows.push({reservationId:allocation._id,inventoryUnitId:allocation.inventoryUnitId,managerItemId:unit.rmv2ItemId,start:allocation.start,end:allocation.end,quantity:allocation.qty,endExclusive:true,turnaroundBufferMinutes:60});
  }
  const totals=(rows:any[])=>{const result=new Map<string,number>();for(const row of rows){const key=JSON.stringify([row.itemId,row.start,row.end]);result.set(key,(result.get(key)??0)+row.quantity);}return [...result].sort(([left],[right])=>left.localeCompare(right));};
  const expected=claim.items.map((item:any)=>({itemId:item.itemId,start:item.start,end:item.returnAt+3600000,quantity:item.quantity}));
  const actual=windows.map((window:any)=>({itemId:window.managerItemId,start:window.start,end:window.end,quantity:window.quantity}));
  if(!windows.length||windows.length>256||JSON.stringify(totals(expected))!==JSON.stringify(totals(actual)))throw Error("Booking stock allocation does not match its claim.");
  await ctx.db.patch(claim._id,{state:"applied",bookingRevision:booking.rmv2Revision,appliedAt:Date.now(),windows,updatedAt:Date.now()});
}

export const prepare=internalMutation({args:{bookingId:v.id("bookings"),sessionId:v.string(),paymentIntentId:v.optional(v.string())},handler:async(ctx,args)=>{
  if(!enabled())throw Error("Shared stock authority is not enabled.");
  const booking=await ctx.db.get(args.bookingId);
  if(!bookingReadyForStockClaim(booking,args.sessionId,args.paymentIntentId))return {ready:false};
  const items=await bookingClaimItems(ctx,booking),old=await find(ctx,args.bookingId);
  if(old){
    if(old.sessionId!==args.sessionId||old.paymentIntentId!==args.paymentIntentId||JSON.stringify(old.items)!==JSON.stringify(items))throw Error("The original booking stock claim needs reconciliation.");
    return {ready:true,id:old._id};
  }
  const now=Date.now(),id=await ctx.db.insert("booking_stock_claims",{bookingId:args.bookingId,sessionId:args.sessionId,...(args.paymentIntentId?{paymentIntentId:args.paymentIntentId}:{}),items,state:"acquiring",attempts:0,retryAt:now+60000,createdAt:now,updatedAt:now});
  return {ready:true,id};
}});

export const lease=internalMutation({args:{id:v.id("booking_stock_claims"),token:v.string()},handler:async(ctx,args)=>{
  const claim=await ctx.db.get(args.id);
  if(!claim||!enabled())throw Error("Booking stock claim is unavailable.");
  if(["executed","applied","review"].includes(claim.state))return {status:claim.state};
  if((claim.leaseUntil??0)>Date.now())return {status:"busy"};
  const booking=await ctx.db.get(claim.bookingId);
  if(!bookingReadyForStockClaim(booking,claim.sessionId,claim.paymentIntentId)||JSON.stringify(await bookingClaimItems(ctx,booking))!==JSON.stringify(claim.items)){
    await ctx.db.patch(claim._id,{state:"review",updatedAt:Date.now()});await notifyReview(ctx,claim);return {status:"review"};
  }
  const acquire=claim.state==="acquiring";
  if(!acquire&&(!claim.managerRequestId||!claim.fingerprint))throw Error("Booking stock claim identity needs reconciliation.");
  const request=acquire?{operation:"acquire" as const,args:{requestId:`booking_${claim.bookingId}`,items:claim.items}}:{operation:"beginExecution" as const,args:{id:claim.managerRequestId!,fingerprint:claim.fingerprint!,executionKey:`booking_execution_${claim.bookingId}`}};
  await ctx.db.patch(claim._id,{state:acquire?"acquiring":"executing",leaseToken:args.token,leaseUntil:Date.now()+60000,retryAt:Date.now()+60000,updatedAt:Date.now()});
  return {status:"leased",request};
}});

export const record=internalMutation({args:{id:v.id("booking_stock_claims"),token:v.string(),receipt:v.any()},handler:async(ctx,args)=>{
  const claim=await ctx.db.get(args.id);
  if(!claim||claim.leaseToken!==args.token)return {status:"stale"};
  const receipt=args.receipt,acquire=claim.state==="acquiring";
  if(acquire?(!receipt||typeof receipt.requestId!=="string"||typeof receipt.fingerprint!=="string"||!["prepared","execution_started"].includes(receipt.state)):(claim.state!=="executing"||receipt?.state!=="execution_started"))throw Error("Booking stock receipt needs reconciliation.");
  await ctx.db.patch(claim._id,{state:acquire?"prepared":"executed",...(acquire?{managerRequestId:receipt.requestId,fingerprint:receipt.fingerprint}:{}),leaseToken:undefined,leaseUntil:undefined,attempts:0,retryAt:Date.now()+60000,updatedAt:Date.now()});
  return {status:acquire?"prepared":"executed"};
}});

export const releaseLease=internalMutation({args:{id:v.id("booking_stock_claims"),token:v.string()},handler:async(ctx,args)=>{
  const claim=await ctx.db.get(args.id);if(!claim||claim.leaseToken!==args.token)return;
  const attempts=claim.attempts+1;
  await ctx.db.patch(claim._id,{state:attempts>=8?"review":claim.state,attempts,leaseToken:undefined,leaseUntil:undefined,retryAt:attempts>=8?undefined:Date.now()+Math.min(60,2**attempts)*60000,updatedAt:Date.now()});
  if(attempts>=8)await notifyReview(ctx,claim);
}});

export const due=internalQuery({args:{},handler:async(ctx)=>{
  const rows=[];
  for(const state of ["acquiring","prepared","executing","executed"] as const)rows.push(...await ctx.db.query("booking_stock_claims").withIndex("by_state_due",q=>q.eq("state",state).lte("retryAt",Date.now())).take(10));
  return rows;
}});

export const finishRecoveryAttempt=internalMutation({args:{id:v.id("booking_stock_claims"),expectedState:v.union(v.literal("acquiring"),v.literal("prepared"),v.literal("executing"),v.literal("executed")),expectedRetryAt:v.number(),expectedAttempts:v.number()},handler:async(ctx,args)=>{
  const claim=await ctx.db.get(args.id);if(!claim||claim.state!==args.expectedState||claim.retryAt!==args.expectedRetryAt||claim.attempts!==args.expectedAttempts||(claim.leaseUntil??0)>Date.now())return;
  const booking=await ctx.db.get(claim.bookingId);
  if(!bookingReadyForStockClaim(booking,claim.sessionId,claim.paymentIntentId)){
    await reviewOutstandingBookingClaim(ctx,claim.bookingId);return;
  }
  const attempts=claim.attempts+1,review=attempts>=8;
  await ctx.db.patch(claim._id,{state:review?"review":claim.state,attempts,retryAt:review?undefined:Date.now()+Math.min(60,2**attempts)*60000,updatedAt:Date.now()});
  if(review)await notifyReview(ctx,claim);
}});

export const reconcile=internalAction({args:{},handler:async(ctx):Promise<void>=>{
  if(!enabled())return;
  const refs=internal as any,rows=await ctx.runQuery(refs.bookingStockClaims.due,{});
  for(const claim of rows){
    if(typeof claim.retryAt!=="number")continue;
    const snapshot={id:claim._id,expectedState:claim.state,expectedRetryAt:claim.retryAt,expectedAttempts:claim.attempts};
    try{
      const result=await ctx.runAction(refs.bookingStockClaims.advance,{id:claim._id});
      if(result.status==="executed")await ctx.runAction(internal.checkout.confirmAfterVerification,{bookingId:claim.bookingId,attempt:0});
    }catch{}
    await ctx.runMutation(refs.bookingStockClaims.finishRecoveryAttempt,snapshot);
  }
}});

export const advance=internalAction({args:{id:v.id("booking_stock_claims")},handler:async(ctx,args):Promise<{status:string}>=>{
  if(!enabled())return {status:"offline"};
  const refs=internal as any;
  for(let step=0;step<2;step++){
    const token=crypto.randomUUID(),lease:any=await ctx.runMutation(refs.bookingStockClaims.lease,{id:args.id,token});
    if(lease.status!=="leased")return {status:lease.status};
    try{
      const result=await ctx.runAction(internal.sharedStockBridge.send,{request:lease.request});
      if(result.status!=="confirmed")return {status:result.status};
      const recorded=await ctx.runMutation(refs.bookingStockClaims.record,{id:args.id,token,receipt:result.result});
      if(recorded.status!=="prepared")return recorded;
    }finally{await ctx.runMutation(refs.bookingStockClaims.releaseLease,{id:args.id,token});}
  }
  return {status:"executed"};
}});
